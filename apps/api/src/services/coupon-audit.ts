import type { Order, Subscription, SubscriptionCharge } from "@assinaturas/db";

// Detecta assinaturas em que o desconto do primeiro pedido (cupom) passou a
// valer para todas as cobranças.
//
// Causa conhecida (docs da Appmax, "Criar assinatura" e "Adicionar produtos"):
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
  /** Com produtos, mas a última cobrança recorrente paga ficou abaixo do preço de catálogo. */
  | "charged_below_catalog";

export interface AuditFinding {
  kind: FindingKind;
  severity: "high" | "medium" | "low";
  message: string;
  /** Estimativa do quanto se deixa de cobrar por ciclo, em centavos. */
  lossPerCycleCents: number | null;
}

const OPEN_STATUSES = new Set(["ACTIVE", "PAUSED", "OVERDUE"]);
/** Diferenças de até R$ 0,05 são arredondamento. */
const TOLERANCE_CENTS = 5;

export function auditSubscription(
  subscription: Pick<Subscription, "status" | "hasProducts" | "products" | "valueCents">,
  charges: Pick<SubscriptionCharge, "cycle" | "status" | "valueCents">[],
  originOrder: Pick<Order, "discountCents" | "subTotalCents"> | null,
): AuditFinding | null {
  if (!OPEN_STATUSES.has(subscription.status)) return null;

  if (!subscription.hasProducts) {
    if (!originOrder) {
      return {
        kind: "inherited_value_unknown_origin",
        severity: "low",
        message:
          "Assinatura sem produtos (herda o valor do pedido de origem). Pedido de origem ainda não sincronizado.",
        lossPerCycleCents: null,
      };
    }
    if (originOrder.discountCents > TOLERANCE_CENTS) {
      return {
        kind: "coupon_inherited",
        severity: "high",
        message: `O pedido de origem teve ${formatBRL(originOrder.discountCents)} de desconto e a assinatura foi criada sem produtos, então esse desconto se repete em toda cobrança.`,
        lossPerCycleCents: originOrder.discountCents,
      };
    }
    return null;
  }

  const catalogCents = subscription.products.reduce((sum, p) => sum + p.priceCents * p.quantity, 0);
  const lastRecurring = charges
    .filter((c) => c.cycle >= 1 && c.status === "paid")
    .sort((a, b) => b.cycle - a.cycle)[0];

  // Comparamos sem o frete: se a cobrança incluir frete, um desconto menor que
  // o frete passa despercebido, mas não geramos falso positivo.
  if (lastRecurring && catalogCents - lastRecurring.valueCents > TOLERANCE_CENTS) {
    return {
      kind: "charged_below_catalog",
      severity: "medium",
      message: `Última cobrança recorrente paga (${formatBRL(lastRecurring.valueCents)}) abaixo do preço de catálogo dos produtos (${formatBRL(catalogCents)}). Pode ser um desconto permanente na assinatura.`,
      lossPerCycleCents: catalogCents - lastRecurring.valueCents,
    };
  }

  return null;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
