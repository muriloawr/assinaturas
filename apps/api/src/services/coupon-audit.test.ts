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

describe("auditSubscription", () => {
  it("aponta cupom herdado quando a assinatura não tem produtos e o pedido de origem teve desconto", () => {
    const finding = auditSubscription(
      { status: "ACTIVE", hasProducts: false, products: [], valueCents: 8000 },
      [],
      { discountCents: 2000, subTotalCents: 10000 },
    );
    expect(finding).toMatchObject({ kind: "coupon_inherited", severity: "high", lossPerCycleCents: 2000 });
  });

  it("não aponta nada quando a assinatura sem produtos veio de um pedido sem desconto", () => {
    expect(
      auditSubscription(
        { status: "ACTIVE", hasProducts: false, products: [], valueCents: 10000 },
        [],
        { discountCents: 0, subTotalCents: 10000 },
      ),
    ).toBeNull();
  });

  it("marca como pendente quando o pedido de origem ainda não foi sincronizado", () => {
    expect(
      auditSubscription({ status: "ACTIVE", hasProducts: false, products: [], valueCents: 1 }, [], null),
    ).toMatchObject({ kind: "inherited_value_unknown_origin", severity: "low" });
  });

  it("aponta cobrança recorrente abaixo do catálogo", () => {
    const finding = auditSubscription(
      { status: "ACTIVE", hasProducts: true, products: [product(5000, 2)], valueCents: 10000 },
      [
        { cycle: 0, status: "paid", valueCents: 8000 },
        { cycle: 1, status: "paid", valueCents: 8000 },
      ],
      { discountCents: 2000, subTotalCents: 10000 },
    );
    expect(finding).toMatchObject({ kind: "charged_below_catalog", lossPerCycleCents: 2000 });
  });

  it("ignora desconto só no primeiro ciclo (o comportamento correto)", () => {
    expect(
      auditSubscription(
        { status: "ACTIVE", hasProducts: true, products: [product(10000)], valueCents: 10000 },
        [
          { cycle: 0, status: "paid", valueCents: 8000 },
          { cycle: 1, status: "paid", valueCents: 10000 },
        ],
        { discountCents: 2000, subTotalCents: 10000 },
      ),
    ).toBeNull();
  });

  it("ignora diferenças de arredondamento e cobranças não pagas", () => {
    expect(
      auditSubscription(
        { status: "ACTIVE", hasProducts: true, products: [product(9990)], valueCents: 9990 },
        [
          { cycle: 1, status: "paid", valueCents: 9989 },
          { cycle: 2, status: "failed", valueCents: 5000 },
        ],
        null,
      ),
    ).toBeNull();
  });

  it("ignora assinaturas canceladas ou finalizadas", () => {
    expect(
      auditSubscription(
        { status: "CANCELLED", hasProducts: false, products: [], valueCents: 8000 },
        [],
        { discountCents: 2000, subTotalCents: 10000 },
      ),
    ).toBeNull();
  });
});
