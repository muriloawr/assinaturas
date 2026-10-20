import { describe, expect, it } from "vitest";
import { auditSubscription } from "./coupon-audit.ts";

const product = (priceCents: number, quantity = 1) => ({
  name: "Kit",
  priceCents,
  quantity,
  productId: 1,
  shopifyProductId: null,
  variantId: null,
  sku: null,
});

const withProducts = (priceCents: number, freightCents: number | null = null) => ({
  status: "ACTIVE",
  hasProducts: true,
  products: [product(priceCents)],
  valueCents: priceCents,
  freightCents,
});

const noProducts = (valueCents: number, status = "ACTIVE") => ({
  status,
  hasProducts: false,
  products: [],
  valueCents,
  freightCents: null,
});

describe("auditSubscription", () => {
  it("aponta cupom herdado quando a assinatura não tem produtos e o pedido de origem teve desconto", () => {
    const [finding] = auditSubscription(noProducts(8000), [], { discountCents: 2000, subTotalCents: 10000 });
    expect(finding).toMatchObject({ kind: "coupon_inherited", severity: "high", lossPerCycleCents: 2000 });
  });

  it("não aponta nada quando a assinatura sem produtos veio de um pedido sem desconto", () => {
    expect(auditSubscription(noProducts(10000), [], { discountCents: 0, subTotalCents: 10000 })).toEqual([]);
  });

  it("marca como pendente quando o pedido de origem ainda não foi sincronizado", () => {
    expect(auditSubscription(noProducts(1), [], null)).toMatchObject([
      { kind: "inherited_value_unknown_origin", severity: "low" },
    ]);
  });

  // Caso real: produto de R$ 55,57, cupom de R$ 20,24 no 1º pedido, 1ª mensalidade de R$ 35,33.
  it("aponta cobrança recorrente com o mesmo desconto do pedido de origem", () => {
    const [finding] = auditSubscription(
      withProducts(5557),
      [{ cycle: 1, status: "paid", valueCents: 3533 }],
      { discountCents: 2024, subTotalCents: 7026 },
    );
    expect(finding).toMatchObject({ kind: "charged_below_catalog", severity: "high", lossPerCycleCents: 2024 });
    expect(finding?.message).toContain("mesmo desconto do pedido de origem");
  });

  it("reconhece o desconto limitado ao mínimo de R$ 5,00 e conta cobranças em atraso", () => {
    const [finding] = auditSubscription(
      withProducts(7429),
      [{ cycle: 1, status: "overdue", valueCents: 500 }],
      { discountCents: 22010, subTotalCents: 60492 },
    );
    expect(finding).toMatchObject({ kind: "charged_below_catalog", lossPerCycleCents: 6929 });
    expect(finding?.message).toContain("mesmo desconto do pedido de origem");
  });

  it("ignora desconto só no primeiro ciclo (o comportamento correto)", () => {
    expect(
      auditSubscription(withProducts(10000), [{ cycle: 1, status: "paid", valueCents: 10000 }], {
        discountCents: 2000,
        subTotalCents: 10000,
      }),
    ).toEqual([]);
  });

  it("ignora diferenças de arredondamento e cobranças que falharam", () => {
    expect(
      auditSubscription(
        withProducts(9990),
        [
          { cycle: 1, status: "paid", valueCents: 9989 },
          { cycle: 2, status: "failed", valueCents: 5000 },
        ],
        null,
      ),
    ).toEqual([]);
  });

  it("prevê o desconto antes da primeira cobrança recorrente", () => {
    const [finding] = auditSubscription(withProducts(5437), [], { discountCents: 832, subTotalCents: 6269 });
    expect(finding).toMatchObject({ kind: "coupon_expected", severity: "medium", lossPerCycleCents: 832 });
  });

  it("não soma a previsão quando o pedido de origem é dividido entre assinaturas", () => {
    const [finding] = auditSubscription(
      withProducts(4797),
      [],
      { discountCents: 5631, subTotalCents: 16685 },
      { sharedOriginCount: 3 },
    );
    expect(finding).toMatchObject({ kind: "coupon_expected", lossPerCycleCents: null });
    expect(finding?.message).toMatch(/até R\$\s42,97/);
  });

  it("aponta frete cadastrado junto com o desconto", () => {
    const findings = auditSubscription(withProducts(7838, 1997), [], { discountCents: 1997, subTotalCents: 9835 });
    expect(findings.map((f) => f.kind)).toEqual(["coupon_expected", "freight_registered"]);
    expect(findings[1]).toMatchObject({ extraPerCycleCents: 1997, lossPerCycleCents: null });
  });

  it("ignora assinaturas canceladas ou finalizadas", () => {
    expect(
      auditSubscription(noProducts(8000, "CANCELLED"), [], { discountCents: 2000, subTotalCents: 10000 }),
    ).toEqual([]);
  });
});
