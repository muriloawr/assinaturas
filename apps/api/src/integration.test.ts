// Teste de ponta a ponta contra um Postgres real, com a API da Appmax simulada.
// Roda só quando DATABASE_URL está definida (e as migrações aplicadas).

import { AppmaxClient, type SubscriptionDetail } from "@assinaturas/appmax";
import { createDb, stores, subscriptions, webhookEvents } from "@assinaturas/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import type { Env } from "./env.ts";
import { encrypt, webhookToken } from "./lib/crypto.ts";
import type { StoreRegistry } from "./lib/stores.ts";
import { couponAuditReport } from "./services/reports.ts";
import { SyncService } from "./services/sync.ts";

const DATABASE_URL = process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 7).toString("base64");

function subscription(overrides: Partial<SubscriptionDetail>): SubscriptionDetail {
  return {
    subscription_id: 1,
    status: "ACTIVE",
    products: [],
    value: 80,
    freight_value: 0,
    interval: "month",
    interval_count: 1,
    current_cycle: 2,
    completed_cycles: 1,
    max_cycles: null,
    customer: { name: "Cliente", email: "cliente@exemplo.com", document: null, phone: null },
    payment: { payment_info: { brand: "visa", final: "4242", expiration: null } },
    next_charge_at: "2026-11-10 00:00:00",
    last_charge_at: "10/10/2026",
    charges: [],
    created_at: "2026-09-10 10:00:00",
    canceled_at: null,
    paused_from: null,
    paused_until: null,
    ...overrides,
  };
}

// Assinatura 101: criada sem produtos a partir de um pedido com R$ 20 de cupom (o bug).
// Assinatura 102: criada com produtos, cupom só no ciclo 0 (correta).
const appmax = {
  subscriptions: new Map<number, SubscriptionDetail>([
    [
      101,
      subscription({
        subscription_id: 101,
        charges: [
          { cycle: 0, order_id: 5001, shopify_order_id: null, charged_at: "10/09/2026", value: 80, status: "paid" },
          { cycle: 1, order_id: 5002, shopify_order_id: null, charged_at: "10/10/2026", value: 80, status: "paid" },
        ],
      }),
    ],
    [
      102,
      subscription({
        subscription_id: 102,
        value: 100,
        products: [
          {
            name: "Kit",
            price: 100,
            quantity: 1,
            product_id: 9,
            shopify_product_id: null,
            variant_id: null,
            sku: "KIT",
            image_url: null,
            compare_at_price: null,
          },
        ],
        charges: [
          { cycle: 0, order_id: 6001, shopify_order_id: null, charged_at: "10/09/2026", value: 80, status: "paid" },
          { cycle: 1, order_id: 6002, shopify_order_id: null, charged_at: "10/10/2026", value: 100, status: "paid" },
        ],
      }),
    ],
  ]),
  orders: new Map([
    [5001, { sub_total: 10000, discount: 2000 }],
    [6001, { sub_total: 10000, discount: 2000 }],
  ]),
};

function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  if (url.pathname === "/oauth2/token") return json(200, { access_token: "t", expires_in: 3600 });

  const sub = /^\/v1\/subscriptions\/(\d+)$/.exec(url.pathname);
  if (sub) {
    const found = appmax.subscriptions.get(Number(sub[1]));
    return found ? json(200, { data: found }) : json(404, { errors: { message: "Assinatura não encontrada." } });
  }

  if (url.pathname === "/v1/subscriptions") {
    const status = url.searchParams.get("status");
    const items = [...appmax.subscriptions.values()]
      .filter((s) => s.status === status)
      .map((s) => ({ ...s, next_charge_at: "10/11/2026" }));
    return json(200, {
      data: { subscriptions: items, pagination: { total: items.length, per_page: 10, current_page: 1, last_page: 1 } },
    });
  }

  const order = /^\/v1\/orders\/(\d+)$/.exec(url.pathname);
  if (order) {
    const found = appmax.orders.get(Number(order[1]));
    if (!found) return json(404, { error: { message: "Order not found" } });
    return json(200, {
      data: {
        order: {
          id: Number(order[1]),
          status: "aprovado",
          total_paid: found.sub_total - found.discount,
          amounts: { sub_total: found.sub_total, shipping_value: 0, discount: found.discount, installment_fee: 0 },
          created_at: "2026-09-10 10:00:00",
          updated_at: "2026-09-10 10:00:00",
        },
        customer: { id: 1, name: "Cliente", email: "cliente@exemplo.com", document_number: null },
        payment: null,
      },
    });
  }

  return json(404, { error: { message: `rota simulada inexistente: ${url.pathname}` } });
}

describe.skipIf(!DATABASE_URL)("integração com o banco", () => {
  const { db, sql } = createDb(DATABASE_URL ?? "");
  const client = new AppmaxClient({
    environment: "sandbox",
    credentials: { clientId: "id", clientSecret: "secret" },
    fetch: fakeFetch as typeof fetch,
    requestsPerSecond: 1000,
  });
  let storeId = "";
  const registry = {
    client: async () => client,
    get: async (id: string) => (await db.select().from(stores).where(eq(stores.id, id)))[0] ?? null,
    list: async () => db.select().from(stores),
  } as unknown as StoreRegistry;
  const sync = new SyncService(db, registry);

  beforeAll(async () => {
    const [store] = await db
      .insert(stores)
      .values({
        name: `teste-${Date.now()}`,
        environment: "sandbox",
        clientId: "id",
        clientSecretEncrypted: encrypt("secret", KEY),
      })
      .returning();
    storeId = store!.id;
  });

  afterAll(async () => {
    await sql.end();
  });

  it("reconcilia, sincroniza e aponta só a assinatura com cupom herdado", async () => {
    const enqueued: number[] = [];
    const result = await sync.reconcileStore(storeId, async (_, appmaxId) => {
      enqueued.push(appmaxId);
    });
    expect(result).toEqual({ listed: 2, enqueued: 2 });

    for (const id of enqueued) await sync.syncSubscription(storeId, id);

    // Segunda reconciliação: nada mudou, nada a enfileirar.
    const again = await sync.reconcileStore(storeId, async () => {});
    expect(again).toEqual({ listed: 2, enqueued: 0 });

    const report = await couponAuditReport(db, storeId);
    expect(report.analyzed).toBe(2);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      appmaxId: 101,
      kind: "coupon_inherited",
      originOrderId: 5001,
      originDiscountCents: 2000,
      lossPerCycleCents: 2000,
    });
  });

  it("sincronizar de novo é idempotente e mantém o pedido de origem", async () => {
    const original = appmax.subscriptions.get(101)!;
    // O histórico deixa de trazer o ciclo 0.
    appmax.subscriptions.set(101, { ...original, charges: original.charges.filter((c) => c.cycle > 0) });
    await sync.syncSubscription(storeId, 101);
    appmax.subscriptions.set(101, original);

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.appmaxId, 101));
    expect(row?.originOrderId).toBe(5001);
  });

  it("recebe webhook, deduplica e enfileira a sincronização", async () => {
    const enqueueSync = vi.fn(async () => {});
    const env: Env = {
      DATABASE_URL: DATABASE_URL!,
      ENCRYPTION_KEY: KEY,
      ADMIN_API_TOKEN: "x".repeat(32),
      API_PORT: 0,
      API_PUBLIC_URL: "http://localhost",
    };
    const app = buildApp(
      { env, db, registry, sync, jobs: { enqueueSync, enqueueReconcile: async () => {} } },
      { logger: false },
    );

    const payload = {
      event: "subscription_charge_success",
      event_type: "subscription",
      data: { subscription_id: 101, order_id: 5003, status: "success" },
    };
    const url = `/webhooks/appmax/${storeId}?token=${webhookToken(storeId, KEY)}`;

    const first = await app.inject({ method: "POST", url, payload });
    const second = await app.inject({ method: "POST", url, payload });
    const forged = await app.inject({ method: "POST", url: `/webhooks/appmax/${storeId}?token=errado`, payload });

    expect(first.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });
    expect(forged.statusCode).toBe(404);
    expect(enqueueSync).toHaveBeenCalledTimes(1);
    expect(enqueueSync).toHaveBeenCalledWith({ storeId, appmaxId: 101, originOrderId: null });

    const events = await db.select().from(webhookEvents).where(eq(webhookEvents.storeId, storeId));
    expect(events).toHaveLength(1);

    // A sincronização marca o evento como processado.
    await sync.syncSubscription(storeId, 101);
    const [processed] = await db.select().from(webhookEvents).where(eq(webhookEvents.storeId, storeId));
    expect(processed?.processedAt).not.toBeNull();

    const unauthorized = await app.inject({ method: "GET", url: "/api/stores" });
    expect(unauthorized.statusCode).toBe(401);
    const report = await app.inject({
      method: "GET",
      url: `/api/stores/${storeId}/reports/coupon-audit`,
      headers: { authorization: `Bearer ${env.ADMIN_API_TOKEN}` },
    });
    expect(report.json().rows).toHaveLength(1);

    await app.close();
  });
});
