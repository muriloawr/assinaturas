import {
  auditLogs,
  orders,
  subscriptionCharges,
  subscriptions,
  webhookEvents,
  type Store,
  type Subscription,
} from "@assinaturas/db";
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type {
  StoreDto,
  StoreSummary,
  SubscriptionDetailDto,
  SubscriptionDto,
  SubscriptionPage,
} from "../contracts.ts";
import { safeEqual, webhookToken } from "../lib/crypto.ts";
import { auditSubscription } from "../services/coupon-audit.ts";
import { couponAuditReport } from "../services/reports.ts";

const PAGE_SIZE = 50;

const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function adminRoutes(app: FastifyInstance, deps: AppDeps) {
  // Autenticação provisória do painel: um token fixo compartilhado com apps/web.
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? "";
    if (!safeEqual(header, `Bearer ${deps.env.ADMIN_API_TOKEN}`)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  const loadStore = async (storeId: string, reply: FastifyReply): Promise<Store | null> => {
    const store = z.uuid().safeParse(storeId).success ? await deps.registry.get(storeId) : null;
    if (!store) reply.code(404).send({ error: "loja não encontrada" });
    return store;
  };

  app.get("/api/stores", async (): Promise<StoreDto[]> => {
    return (await deps.registry.list()).map(toStoreDto);
  });

  app.get<{ Params: { storeId: string } }>("/api/stores/:storeId", async (request, reply) => {
    const store = await loadStore(request.params.storeId, reply);
    if (!store) return;

    const counts = await deps.db
      .select({ status: subscriptions.status, total: count() })
      .from(subscriptions)
      .where(eq(subscriptions.storeId, store.id))
      .groupBy(subscriptions.status);
    const [pending] = await deps.db
      .select({ total: count() })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.storeId, store.id), isNull(webhookEvents.processedAt)));

    const summary: StoreSummary = {
      store: toStoreDto(store),
      webhookUrl: `${deps.env.API_PUBLIC_URL}/webhooks/appmax/${store.id}?token=${webhookToken(store.id, deps.env.ENCRYPTION_KEY)}`,
      countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c.total])),
      pendingWebhooks: pending?.total ?? 0,
    };
    return summary;
  });

  app.get<{ Params: { storeId: string } }>("/api/stores/:storeId/subscriptions", async (request, reply) => {
    const store = await loadStore(request.params.storeId, reply);
    if (!store) return;
    const { status, q, page } = listQuery.parse(request.query);

    const filters = [eq(subscriptions.storeId, store.id)];
    if (status) filters.push(eq(subscriptions.status, status));
    if (q) {
      const term = `%${q}%`;
      const byText = or(
        ilike(subscriptions.customerEmail, term),
        ilike(subscriptions.customerName, term),
        ilike(subscriptions.customerDocument, term),
      );
      if (byText) filters.push(/^\d+$/.test(q) ? or(byText, eq(subscriptions.appmaxId, Number(q)))! : byText);
    }
    const where = and(...filters);

    const [items, [total]] = await Promise.all([
      deps.db
        .select()
        .from(subscriptions)
        .where(where)
        .orderBy(sql`${subscriptions.nextChargeAt} asc nulls last`, desc(subscriptions.appmaxId))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      deps.db.select({ total: count() }).from(subscriptions).where(where),
    ]);

    const result: SubscriptionPage = {
      items: items.map(toSubscriptionDto),
      page,
      pageSize: PAGE_SIZE,
      total: total?.total ?? 0,
    };
    return result;
  });

  app.get<{ Params: { storeId: string; appmaxId: string } }>(
    "/api/stores/:storeId/subscriptions/:appmaxId",
    async (request, reply) => {
      const store = await loadStore(request.params.storeId, reply);
      if (!store) return;
      const appmaxId = parseId(request.params.appmaxId);
      if (appmaxId === null) return reply.code(404).send({ error: "assinatura não encontrada" });

      const [subscription] = await deps.db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.storeId, store.id), eq(subscriptions.appmaxId, appmaxId)));
      if (!subscription) return reply.code(404).send({ error: "assinatura não encontrada no espelho" });

      const [charges, [originOrder], events, logs] = await Promise.all([
        deps.db
          .select()
          .from(subscriptionCharges)
          .where(eq(subscriptionCharges.subscriptionId, subscription.id))
          .orderBy(desc(subscriptionCharges.cycle)),
        subscription.originOrderId
          ? deps.db
              .select()
              .from(orders)
              .where(and(eq(orders.storeId, store.id), eq(orders.appmaxOrderId, subscription.originOrderId)))
          : Promise.resolve([]),
        deps.db
          .select()
          .from(webhookEvents)
          .where(and(eq(webhookEvents.storeId, store.id), eq(webhookEvents.appmaxSubscriptionId, appmaxId)))
          .orderBy(desc(webhookEvents.receivedAt))
          .limit(50),
        deps.db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.storeId, store.id), eq(auditLogs.appmaxSubscriptionId, appmaxId)))
          .orderBy(desc(auditLogs.createdAt))
          .limit(50),
      ]);

      const detail: SubscriptionDetailDto = {
        subscription: toSubscriptionDto(subscription),
        charges: charges.map(serialize),
        originOrder: originOrder ? serialize(omit(originOrder, "raw")) : null,
        finding: auditSubscription(subscription, charges, originOrder ?? null),
        events: events.map((e) => serialize(omit(e, "payload"))),
        auditLogs: logs.map(serialize),
      };
      return detail;
    },
  );

  app.post<{ Params: { storeId: string; appmaxId: string } }>(
    "/api/stores/:storeId/subscriptions/:appmaxId/sync",
    async (request, reply) => {
      const store = await loadStore(request.params.storeId, reply);
      if (!store) return;
      const appmaxId = parseId(request.params.appmaxId);
      if (appmaxId === null) return reply.code(404).send({ error: "assinatura não encontrada" });
      const saved = await deps.sync.syncSubscription(store.id, appmaxId);
      if (!saved) return reply.code(404).send({ error: "assinatura não encontrada na Appmax" });
      return toSubscriptionDto(saved);
    },
  );

  app.post<{ Params: { storeId: string } }>("/api/stores/:storeId/reconcile", async (request, reply) => {
    const store = await loadStore(request.params.storeId, reply);
    if (!store) return;
    await deps.jobs.enqueueReconcile(store.id);
    return reply.code(202).send({ ok: true });
  });

  app.get<{ Params: { storeId: string } }>(
    "/api/stores/:storeId/reports/coupon-audit",
    async (request, reply) => {
      const store = await loadStore(request.params.storeId, reply);
      if (!store) return;
      return couponAuditReport(deps.db, store.id);
    },
  );
}

function parseId(value: string): number | null {
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

function toStoreDto(store: Store): StoreDto {
  return serialize(omit(store, "clientSecretEncrypted"));
}

function toSubscriptionDto(subscription: Subscription): SubscriptionDto {
  return serialize(omit(subscription, "raw"));
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

function serialize<T extends object>(value: T): Serialized<T> {
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  ) as Serialized<T>;
}
