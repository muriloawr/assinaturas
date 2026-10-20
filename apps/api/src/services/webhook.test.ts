import { describe, expect, it } from "vitest";
import { parseWebhook } from "./webhook.ts";

const envelope = (event: string, data: Record<string, unknown>) => ({
  event,
  event_type: "subscription",
  site_id: "site",
  app_id: "app",
  data,
});

describe("parseWebhook", () => {
  it("deduplica cobrança aprovada por assinatura + pedido", () => {
    expect(
      parseWebhook(envelope("subscription_charge_success", { subscription_id: 501, order_id: 9001 })),
    ).toEqual({
      event: "subscription_charge_success",
      eventType: "subscription",
      appmaxSubscriptionId: 501,
      appmaxOrderId: 9001,
      dedupeKey: "subscription_charge_success:501:9001",
    });
  });

  it("não deduplica eventos que podem se repetir com o mesmo pedido", () => {
    for (const event of ["subscription_paused", "subscription_charge_failed", "subscription_cycle_skipped"]) {
      expect(parseWebhook(envelope(event, { subscription_id: 501, order_id: 9001 }))?.dedupeKey).toBeNull();
    }
  });

  it("aceita ids como string", () => {
    const parsed = parseWebhook(envelope("subscription_created", { subscription_id: "501", order_id: "77" }));
    expect(parsed?.appmaxSubscriptionId).toBe(501);
    expect(parsed?.dedupeKey).toBe("subscription_created:501:77");
  });

  it("não procura assinatura em eventos de pedido", () => {
    const parsed = parseWebhook({ event: "order_approved", event_type: "order", data: { order_id: 5 } });
    expect(parsed).toMatchObject({ appmaxSubscriptionId: null, appmaxOrderId: 5, dedupeKey: null });
  });

  it("rejeita payload sem event", () => {
    expect(parseWebhook({ data: {} })).toBeNull();
    expect(parseWebhook("texto")).toBeNull();
  });
});
