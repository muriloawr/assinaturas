import {
  AppmaxApiError,
  parseAppmaxDate,
  reaisToCents,
  toAppmaxDay,
  type SubscriptionListItem,
} from "@assinaturas/appmax";
import {
  orders,
  stores,
  subscriptionCharges,
  subscriptions,
  webhookEvents,
  type Db,
  type Subscription,
} from "@assinaturas/db";
import { and, eq, getTableColumns, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { StoreRegistry } from "../lib/stores.ts";
import { mapCharge, mapOrder, mapSubscription } from "./mapping.ts";

export type EnqueueSync = (storeId: string, appmaxId: number) => Promise<void>;

/** Status que a listagem consegue devolver com filtro de próxima cobrança. */
const LISTABLE_STATUSES = ["ACTIVE", "PAUSED", "OVERDUE"] as const;
const FAR_PAST = "2000-01-01";
const FAR_FUTURE = "2100-12-31";

export class SyncService {
  constructor(
    private readonly db: Db,
    private readonly registry: StoreRegistry,
  ) {}

  /**
   * Busca a assinatura na Appmax e grava no espelho (assinatura, cobranças e
   * pedido de origem). Seguro para rodar quantas vezes for preciso.
   */
  async syncSubscription(
    storeId: string,
    appmaxId: number,
    hints: { originOrderId?: number | null } = {},
  ): Promise<Subscription | null> {
    const client = await this.registry.client(storeId);
    const startedAt = new Date();

    let detail;
    try {
      detail = await client.getSubscription(appmaxId);
    } catch (error) {
      // Assinatura de outra loja ou removida: não há o que espelhar.
      if (error instanceof AppmaxApiError && error.status === 404) return null;
      throw error;
    }

    const row = mapSubscription(storeId, detail, startedAt);
    row.originOrderId ??= hints.originOrderId ?? null;

    const saved = await this.db.transaction(async (tx) => {
      const [subscription] = await tx
        .insert(subscriptions)
        .values(row)
        .onConflictDoUpdate({
          target: [subscriptions.storeId, subscriptions.appmaxId],
          set: {
            ...excluded(subscriptions, Object.keys(row).filter((k) => k !== "originOrderId")),
            // A cobrança do ciclo 0 nem sempre vem no histórico: não apagar o que já sabemos.
            originOrderId: sql`coalesce(excluded.origin_order_id, ${subscriptions.originOrderId})`,
          },
        })
        .returning();
      if (!subscription) throw new Error("upsert de assinatura não retornou linha");

      const charges = (detail.charges ?? []).map((c) => mapCharge(storeId, subscription.id, c));
      if (charges.length > 0) {
        await tx
          .insert(subscriptionCharges)
          .values(charges)
          .onConflictDoUpdate({
            target: [subscriptionCharges.storeId, subscriptionCharges.appmaxOrderId],
            set: excluded(subscriptionCharges, ["cycle", "chargedAt", "valueCents", "status", "shopifyOrderId"]),
          });
      }

      await tx
        .update(webhookEvents)
        .set({ processedAt: new Date(), error: null })
        .where(
          and(
            eq(webhookEvents.storeId, storeId),
            eq(webhookEvents.appmaxSubscriptionId, appmaxId),
            isNull(webhookEvents.processedAt),
            lte(webhookEvents.receivedAt, startedAt),
          ),
        );

      return subscription;
    });

    if (saved.originOrderId) await this.ensureOrder(storeId, saved.originOrderId);
    return saved;
  }

  /** Pedidos aprovados não mudam de valor: buscamos uma vez e guardamos. */
  async ensureOrder(storeId: string, appmaxOrderId: number): Promise<void> {
    const [existing] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.storeId, storeId), eq(orders.appmaxOrderId, appmaxOrderId)));
    if (existing) return;

    const client = await this.registry.client(storeId);
    try {
      const detail = await client.getOrder(appmaxOrderId);
      await this.db
        .insert(orders)
        .values(mapOrder(storeId, detail, new Date()))
        .onConflictDoNothing();
    } catch (error) {
      if (error instanceof AppmaxApiError && error.status === 404) return;
      throw error;
    }
  }

  /**
   * Percorre a listagem da Appmax e enfileira a sincronização de toda
   * assinatura nova ou diferente do espelho. Serve como carga inicial e como
   * reconciliação diária (recupera webhooks perdidos: a Appmax desiste depois
   * de 4 tentativas, sem avisar).
   *
   * Custa ~1 requisição a cada 10 assinaturas, mais 1 por assinatura alterada.
   */
  async reconcileStore(storeId: string, enqueue: EnqueueSync) {
    const client = await this.registry.client(storeId);
    const mirror = new Map(
      (
        await this.db
          .select({
            appmaxId: subscriptions.appmaxId,
            status: subscriptions.status,
            valueCents: subscriptions.valueCents,
            currentCycle: subscriptions.currentCycle,
            nextChargeAt: subscriptions.nextChargeAt,
          })
          .from(subscriptions)
          .where(eq(subscriptions.storeId, storeId))
      ).map((s) => [s.appmaxId, s]),
    );

    const seen = new Set<number>();
    let listed = 0;
    let enqueued = 0;

    for (const status of LISTABLE_STATUSES) {
      for (let page = 1; ; page++) {
        const result = await client.listSubscriptions({
          status,
          next_charge_from: FAR_PAST,
          next_charge_to: FAR_FUTURE,
          page,
        });
        for (const item of result.subscriptions) {
          listed++;
          seen.add(item.subscription_id);
          if (differs(item, mirror.get(item.subscription_id))) {
            await enqueue(storeId, item.subscription_id);
            enqueued++;
          }
        }
        if (page >= result.pagination.last_page) break;
      }
    }

    // Abertas no espelho mas fora da listagem: provavelmente canceladas ou
    // finalizadas sem que o webhook tenha chegado.
    for (const [appmaxId, s] of mirror) {
      if (!seen.has(appmaxId) && LISTABLE_STATUSES.includes(s.status as never)) {
        await enqueue(storeId, appmaxId);
        enqueued++;
      }
    }

    await this.db.update(stores).set({ lastBackfillAt: new Date() }).where(eq(stores.id, storeId));
    return { listed, enqueued };
  }
}

function differs(
  item: SubscriptionListItem,
  local: Pick<Subscription, "status" | "valueCents" | "currentCycle" | "nextChargeAt"> | undefined,
): boolean {
  if (!local) return true;
  const nextCharge = parseAppmaxDate(item.next_charge_at);
  return (
    item.status !== local.status ||
    reaisToCents(item.value) !== local.valueCents ||
    item.current_cycle !== local.currentCycle ||
    // A listagem traz só o dia; comparamos no dia.
    (nextCharge && toAppmaxDay(nextCharge)) !== (local.nextChargeAt && toAppmaxDay(local.nextChargeAt))
  );
}

/** `{ coluna: excluded.coluna }` para os campos informados, usado em upserts. */
function excluded<T extends PgTable>(table: T, keys: string[]): Record<string, SQL> {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(
    keys
      .filter((key) => columns[key])
      .map((key) => [key, sql.raw(`excluded."${columns[key]!.name}"`)]),
  );
}
