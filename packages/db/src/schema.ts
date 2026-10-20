import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Convenções:
// - Valores monetários sempre em centavos (integer).
// - `appmax_*` são os identificadores da Appmax; `id` é o nosso.
// - A Appmax é a fonte de verdade das assinaturas. Estas tabelas são um espelho
//   atualizado por webhook + reconciliação, para o painel não gastar a quota
//   de 100 mil requisições/mês da API.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Uma loja da Appmax e suas credenciais de merchant. */
export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  environment: text("environment", { enum: ["sandbox", "production"] }).notNull(),
  clientId: text("client_id").notNull(),
  /** client_secret criptografado com AES-256-GCM (ver apps/api/src/lib/crypto.ts). */
  clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  lastBackfillAt: timestamp("last_backfill_at", { withTimezone: true }),
  ...timestamps,
});

export interface SubscriptionProductSnapshot {
  name: string;
  priceCents: number;
  quantity: number;
  productId: number | null;
  shopifyProductId: string | null;
  variantId: string | null;
  sku: string | null;
}

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    appmaxId: bigint("appmax_id", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    interval: text("interval"),
    intervalCount: integer("interval_count"),
    /** `value` da Appmax: valor da assinatura sem o frete. */
    valueCents: integer("value_cents").notNull(),
    freightCents: integer("freight_cents"),
    currentCycle: integer("current_cycle"),
    completedCycles: integer("completed_cycles"),
    maxCycles: integer("max_cycles"),
    nextChargeAt: timestamp("next_charge_at", { withTimezone: true }),
    lastChargeAt: timestamp("last_charge_at", { withTimezone: true }),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerDocument: text("customer_document"),
    customerPhone: text("customer_phone"),
    cardBrand: text("card_brand"),
    cardLast4: text("card_last4"),
    products: jsonb("products").$type<SubscriptionProductSnapshot[]>().notNull().default([]),
    /**
     * Assinaturas criadas sem `products` herdam o valor do pedido de origem
     * (com cupom, se houve) e não aceitam os endpoints de produto (404).
     */
    hasProducts: boolean("has_products").notNull(),
    /** Pedido que originou a assinatura (cobrança do ciclo 0). */
    originOrderId: bigint("origin_order_id", { mode: "number" }),
    appmaxCreatedAt: timestamp("appmax_created_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    pausedFrom: timestamp("paused_from", { withTimezone: true }),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    /** Resposta completa do último GET /v1/subscriptions/{id}. */
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_store_appmax_uq").on(t.storeId, t.appmaxId),
    index("subscriptions_store_status_idx").on(t.storeId, t.status),
    index("subscriptions_store_email_idx").on(t.storeId, t.customerEmail),
  ],
);

/** Histórico de cobranças. Cada ciclo gera um pedido novo na Appmax. */
export const subscriptionCharges = pgTable(
  "subscription_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    cycle: integer("cycle").notNull(),
    appmaxOrderId: bigint("appmax_order_id", { mode: "number" }).notNull(),
    shopifyOrderId: text("shopify_order_id"),
    chargedAt: timestamp("charged_at", { withTimezone: true }),
    valueCents: integer("value_cents").notNull(),
    status: text("status").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscription_charges_store_order_uq").on(t.storeId, t.appmaxOrderId),
    index("subscription_charges_subscription_idx").on(t.subscriptionId),
  ],
);

/** Cache dos pedidos de origem, usado para saber se houve cupom. Valores em centavos, como na API. */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    appmaxOrderId: bigint("appmax_order_id", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    subTotalCents: integer("sub_total_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    installmentFeeCents: integer("installment_fee_cents").notNull(),
    totalPaidCents: integer("total_paid_cents").notNull(),
    raw: jsonb("raw").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("orders_store_order_uq").on(t.storeId, t.appmaxOrderId)],
);

/**
 * Todo webhook recebido, guardado antes de qualquer processamento.
 * A Appmax não manda ID de evento nem HMAC, então `dedupeKey` só é preenchida
 * para eventos que disparam efeitos colaterais (criação, cobrança, cancelamento).
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    event: text("event").notNull(),
    eventType: text("event_type"),
    appmaxSubscriptionId: bigint("appmax_subscription_id", { mode: "number" }),
    appmaxOrderId: bigint("appmax_order_id", { mode: "number" }),
    dedupeKey: text("dedupe_key"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("webhook_events_dedupe_uq")
      .on(t.storeId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index("webhook_events_subscription_idx").on(t.storeId, t.appmaxSubscriptionId),
  ],
);

/** Registro de toda alteração feita por nós na Appmax (painel, portal ou automação). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    appmaxSubscriptionId: bigint("appmax_subscription_id", { mode: "number" }),
    request: jsonb("request"),
    response: jsonb("response"),
    success: boolean("success").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_subscription_idx").on(t.storeId, t.appmaxSubscriptionId)],
);

export type Store = typeof stores.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionCharge = typeof subscriptionCharges.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
