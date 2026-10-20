import type { Db } from "@assinaturas/db";
import Fastify from "fastify";
import type { Env } from "./env.ts";
import type { Jobs } from "./jobs.ts";
import type { StoreRegistry } from "./lib/stores.ts";
import { adminRoutes } from "./routes/admin.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import type { SyncService } from "./services/sync.ts";

export interface AppDeps {
  env: Env;
  db: Db;
  registry: StoreRegistry;
  sync: SyncService;
  jobs: Pick<Jobs, "enqueueSync" | "enqueueReconcile">;
}

export function buildApp(deps: AppDeps, options: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    // Webhooks de pedido podem trazer listas grandes de produtos.
    bodyLimit: 2 * 1024 * 1024,
  });

  app.get("/health", async () => ({ ok: true }));
  // Cada register cria um escopo próprio: o hook de autenticação do painel
  // não vale para a rota de webhook.
  app.register(async (scope) => webhookRoutes(scope, deps));
  app.register(async (scope) => adminRoutes(scope, deps));

  return app;
}
