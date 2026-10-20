import { createDb } from "@assinaturas/db";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { Jobs } from "./jobs.ts";
import { StoreRegistry } from "./lib/stores.ts";
import { SyncService } from "./services/sync.ts";

// Um processo só para API + worker. Se o volume crescer, dá para separar
// rodando o worker em outro processo com o mesmo código.
const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const registry = new StoreRegistry(db, env.ENCRYPTION_KEY);
const sync = new SyncService(db, registry);
const jobs = new Jobs(env.DATABASE_URL);

await jobs.start();
await jobs.work(sync, registry);

const app = buildApp({ env, db, registry, sync, jobs });
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });

const shutdown = async () => {
  await app.close();
  await jobs.stop();
  await sql.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
