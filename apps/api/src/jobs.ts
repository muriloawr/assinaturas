import PgBoss from "pg-boss";
import type { StoreRegistry } from "./lib/stores.ts";
import type { SyncService } from "./services/sync.ts";

export const QUEUES = {
  syncSubscription: "subscription-sync",
  reconcileStore: "store-reconcile",
  reconcileAll: "stores-reconcile-all",
} as const;

export interface SyncSubscriptionJob {
  storeId: string;
  appmaxId: number;
  originOrderId?: number | null;
}

export interface ReconcileStoreJob {
  storeId: string;
}

export class Jobs {
  readonly boss: PgBoss;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
  }

  async start() {
    this.boss.on("error", (error) => console.error("[pg-boss]", error));
    await this.boss.start();
    // "stately": no máximo um job aguardando e um rodando por chave. Uma rajada
    // de webhooks da mesma assinatura vira uma única sincronização, e um evento
    // que chega durante a sincronização ainda gera mais uma.
    await this.boss.createQueue(QUEUES.syncSubscription, {
      name: QUEUES.syncSubscription,
      policy: "stately",
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
    });
    await this.boss.createQueue(QUEUES.reconcileStore, {
      name: QUEUES.reconcileStore,
      policy: "singleton",
      retryLimit: 2,
      retryDelay: 300,
    });
    await this.boss.createQueue(QUEUES.reconcileAll, { name: QUEUES.reconcileAll });
  }

  async enqueueSync(job: SyncSubscriptionJob) {
    await this.boss.send(QUEUES.syncSubscription, job, {
      singletonKey: `${job.storeId}:${job.appmaxId}`,
    });
  }

  async enqueueReconcile(storeId: string) {
    await this.boss.send(QUEUES.reconcileStore, { storeId } satisfies ReconcileStoreJob, {
      singletonKey: storeId,
    });
  }

  async work(sync: SyncService, registry: StoreRegistry) {
    await this.boss.work<SyncSubscriptionJob>(QUEUES.syncSubscription, async ([job]) => {
      if (!job) return;
      await sync.syncSubscription(job.data.storeId, job.data.appmaxId, {
        originOrderId: job.data.originOrderId,
      });
    });

    await this.boss.work<ReconcileStoreJob>(QUEUES.reconcileStore, async ([job]) => {
      if (!job) return;
      const result = await sync.reconcileStore(job.data.storeId, (storeId, appmaxId) =>
        this.enqueueSync({ storeId, appmaxId }),
      );
      console.log(`[reconcile] loja ${job.data.storeId}:`, result);
    });

    await this.boss.work(QUEUES.reconcileAll, async () => {
      for (const store of await registry.list()) await this.enqueueReconcile(store.id);
    });

    // Reconciliação diária às 5h (Brasília), fora do horário de cobranças.
    await this.boss.schedule(QUEUES.reconcileAll, "0 5 * * *", {}, { tz: "America/Sao_Paulo" });
  }

  async stop() {
    await this.boss.stop({ graceful: true });
  }
}
