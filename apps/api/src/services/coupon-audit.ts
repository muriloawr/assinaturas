import type { Order, Subscription, SubscriptionCharge } from "@assinaturas/db";

// Detecta assinaturas cobradas com valor diferente do combinado: desconto do
// primeiro pedido (cupom) repetido nas cobranças recorrentes e frete cadastrado
// em assinaturas que deveriam ter frete grátis.
//
// O que vimos nos dados reais (loja Shopify, outubro de 2026): a assinatura é
// criada com os produtos e o valor cheio, `discount` vem vazio, mas cada
// cobrança recorrente sai com o mesmo desconto do pedido de origem (limitado ao
// mínimo de R$ 5,00 por cobrança). Quando o pedido gerou várias assinaturas, o
// desconto é dividido em partes iguais entre elas. Isso contradiz a documentação ("o cupom do
// pedido de origem não é herdado").
//
// Causa conhecida na documentação ("Criar assinatura" e "Adicionar produtos"):
// uma assinatura criada sem `products` herda o valor do pedido de origem. Se
// esse pedido teve cupom, o valor com desconto vira o valor de todo ciclo.
//
// O relatório só aponta; não corrige nada. Subir o valor de quem já assina é
// uma decisão comercial e precisa de aviso prévio ao assinante.

export type FindingKind =
  /** Sem produtos e o pedido de origem teve desconto: o cupom está sendo cobrado em todo ciclo. */
  | "coupon_inherited"
  /** Sem produtos, mas ainda não sabemos se o pedido de origem teve desconto. */
  | "inherited_value_unknown_origin"
  /** Com produtos, mas a última cobrança recorrente ficou abaixo do preço de catálogo. */
  | "charged_below_catalog"
  /** Ainda sem cobrança recorrente, e o pedido de origem teve desconto que deve se repetir. */
  | "coupon_expected"
  /** Frete cadastrado na assinatura: a Appmax soma em toda cobrança e não deixa descontar. */
  | "freight_registered";

export interface AuditFinding {
  kind: FindingKind;
  severity: "high" | "medium" | "low";
  message: string;
  /** Estimativa do quanto se deixa de cobrar por ciclo, em centavos. */
  lossPerCycleCents: number | null;
  /** Quanto o assinante paga a mais por ciclo, em centavos. */
  extraPerCycleCents: number | null;
}

export interface AuditContext {
  /** Quantas assinaturas saíram do mesmo pedido de origem (o desconto é dividido entre elas). */
  sharedOriginCount?: number;
}

const OPEN_STATUSES = new Set(["ACTIVE", "PAUSED", "OVERDUE"]);
/** Cobranças geradas com valor definido: pagas ou em retentativa. */
const CHARGED_STATUSES = new Set(["paid", "overdue"]);
/** Diferenças de até R$ 0,05 são arredondamento. */
const TOLERANCE_CENTS = 5;
/** Valor mínimo de cobrança da Appmax. */
const MIN_CHARGE_CENTS = 500;

export function auditSubscription(
  subscription: Pick<Subscription, "status" | "hasProducts" | "products" | "valueCents" | "freightCents">,
  charges: Pick<SubscriptionCharge, "cycle" | "status" | "valueCents">[],
  originOrder: Pick<Order, "discountCents" | "subTotalCents"> | null,
  context: AuditContext = {},
): AuditFinding[] {
  if (!OPEN_STATUSES.has(subscription.status)) return [];

  const findings = [couponFinding(subscription, charges, originOrder, context)];
  if ((subscription.freightCents ?? 0) > 0) {
    findings.push({
      kind: "freight_registered",
      severity: "medium",
      message: `A assinatura tem ${formatBRL(subscription.freightCents!)} de frete cadastrado. A Appmax soma o frete em toda cobrança, sem desconto, e não há como alterá-lo pela API.`,
      lossPerCycleCents: null,
      extraPerCycleCents: subscription.freightCents,
    });
  }
  return findings.filter((f): f is AuditFinding => f !== null);
}

function couponFinding(
  subscription: Pick<Subscription, "hasProducts" | "products" | "valueCents">,
  charges: Pick<SubscriptionCharge, "cycle" | "status" | "valueCents">[],
  originOrder: Pick<Order, "discountCents" | "subTotalCents"> | null,
  context: AuditContext,
): AuditFinding | null {
  if (!subscription.hasProducts) {
    if (!originOrder) {
      return {
        kind: "inherited_value_unknown_origin",
        severity: "low",
        message:
          "Assinatura sem produtos (herda o valor do pedido de origem). Pedido de origem ainda não sincronizado.",
        lossPerCycleCents: null,
        extraPerCycleCents: null,
      };
    }
    if (originOrder.discountCents > TOLERANCE_CENTS) {
      return {
        kind: "coupon_inherited",
        severity: "high",
        message: `O pedido de origem teve ${formatBRL(originOrder.discountCents)} de desconto e a assinatura foi criada sem produtos, então esse desconto se repete em toda cobrança.`,
        lossPerCycleCents: originOrder.discountCents,
        extraPerCycleCents: null,
      };
    }
    return null;
  }

  const catalogCents = subscription.products.reduce((sum, p) => sum + p.priceCents * p.quantity, 0);
  const lastRecurring = charges
    .filter((c) => c.cycle >= 1 && CHARGED_STATUSES.has(c.status))
    .sort((a, b) => b.cycle - a.cycle)[0];

  // Comparamos sem o frete: se a cobrança incluir frete, um desconto menor que
  // o frete passa despercebido, mas não geramos falso positivo.
  if (lastRecurring) {
    const lossCents = catalogCents - lastRecurring.valueCents;
    if (lossCents <= TOLERANCE_CENTS) return null;
    const originDiscount = originOrder ? discountShare(originOrder.discountCents, context) : null;
    const repeatsOrigin =
      originDiscount !== null &&
      Math.abs(expectedLoss(originDiscount, catalogCents) - lossCents) <= TOLERANCE_CENTS;
    return {
      kind: "charged_below_catalog",
      severity: "high",
      message: repeatsOrigin
        ? `Última cobrança recorrente (${formatBRL(lastRecurring.valueCents)}) saiu com o mesmo desconto do pedido de origem (${formatBRL(originDiscount!)}) sobre o preço de catálogo (${formatBRL(catalogCents)}).`
        : `Última cobrança recorrente (${formatBRL(lastRecurring.valueCents)}) abaixo do preço de catálogo dos produtos (${formatBRL(catalogCents)}).`,
      lossPerCycleCents: lossCents,
      extraPerCycleCents: null,
    };
  }

  if (originOrder && originOrder.discountCents > TOLERANCE_CENTS) {
    const share = discountShare(originOrder.discountCents, context);
    const lossCents = expectedLoss(share, catalogCents);
    const shared = (context.sharedOriginCount ?? 1) > 1;
    return {
      kind: "coupon_expected",
      severity: "medium",
      message: shared
        ? `Ainda sem cobrança recorrente. O pedido de origem gerou ${context.sharedOriginCount} assinaturas e teve ${formatBRL(originOrder.discountCents)} de desconto (${formatBRL(share)} para cada); se ele se repetir, a próxima cobrança sai ${formatBRL(lossCents)} abaixo do catálogo (${formatBRL(catalogCents)}).`
        : `Ainda sem cobrança recorrente. O pedido de origem teve ${formatBRL(originOrder.discountCents)} de desconto; se ele se repetir, a próxima cobrança sai ${formatBRL(lossCents)} abaixo do catálogo (${formatBRL(catalogCents)}).`,
      lossPerCycleCents: lossCents,
      extraPerCycleCents: null,
    };
  }

  return null;
}

/** Parte do desconto do pedido de origem que cabe a cada assinatura gerada por ele. */
function discountShare(discountCents: number, context: AuditContext): number {
  return Math.round(discountCents / Math.max(1, context.sharedOriginCount ?? 1));
}

/** Desconto efetivo na cobrança: a Appmax não cobra menos que R$ 5,00. */
function expectedLoss(discountCents: number, catalogCents: number): number {
  return Math.max(0, Math.min(discountCents, catalogCents - MIN_CHARGE_CENTS));
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
