import type { SubscriptionDetail } from "@assinaturas/appmax";
import { describe, expect, it } from "vitest";
import { mapSubscription } from "./mapping.ts";

// Exemplo da documentação de GET /v1/subscriptions/{id}.
const detail: SubscriptionDetail = {
  subscription_id: 10,
  status: "ACTIVE",
  products: [
    {
      name: "Camiseta Preta",
      shopify_product_id: null,
      variant_id: null,
      product_id: 55,
      sku: "SKU-1",
      quantity: 1,
      price: 199.9,
      image_url: null,
      compare_at_price: null,
    },
  ],
  value: 199.9,
  freight_value: 19.9,
  interval: "month",
  interval_count: 1,
  current_cycle: 3,
  completed_cycles: 2,
  max_cycles: 12,
  customer: {
    name: "Maria Silva",
    email: "Cliente@Exemplo.com",
    document: "12345678909",
    phone: "11999999999",
  },
  payment: { payment_info: { brand: "visa", final: "1234", expiration: "12/2029" } },
  next_charge_at: "2026-08-15 00:00:00",
  last_charge_at: "15/07/2026",
  charges: [
    { cycle: 2, order_id: 12347, shopify_order_id: null, charged_at: "15/07/2026", value: 199.9, status: "paid" },
  ],
  created_at: "2026-06-15 10:00:00",
  canceled_at: null,
  paused_from: null,
  paused_until: null,
};

describe("mapSubscription", () => {
  it("converte valores para centavos e datas para UTC", () => {
    const row = mapSubscription("store", detail, new Date(0));
    expect(row).toMatchObject({
      appmaxId: 10,
      valueCents: 19990,
      freightCents: 1990,
      hasProducts: true,
      customerEmail: "cliente@exemplo.com",
      cardLast4: "1234",
      products: [{ priceCents: 19990, quantity: 1, productId: 55, sku: "SKU-1" }],
    });
    expect(row.nextChargeAt?.toISOString()).toBe("2026-08-15T03:00:00.000Z");
    expect(row.lastChargeAt?.toISOString()).toBe("2026-07-15T03:00:00.000Z");
  });

  it("não inventa pedido de origem quando o ciclo 0 não está no histórico", () => {
    expect(mapSubscription("store", detail, new Date(0)).originOrderId).toBeNull();
    const withOrigin = { ...detail, charges: [...detail.charges, { ...detail.charges[0]!, cycle: 0, order_id: 12345 }] };
    expect(mapSubscription("store", withOrigin, new Date(0)).originOrderId).toBe(12345);
  });

  it("marca assinatura sem produtos", () => {
    expect(mapSubscription("store", { ...detail, products: [] }, new Date(0)).hasProducts).toBe(false);
  });
});
