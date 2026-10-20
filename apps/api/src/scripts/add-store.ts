// Cadastra uma loja da Appmax.
//
//   APPMAX_CLIENT_ID=... APPMAX_CLIENT_SECRET=... pnpm store:add "Nome da loja" sandbox
//
// As credenciais vêm por variável de ambiente para não ficarem no histórico do
// shell. Gere em: painel da Appmax → API → Credenciais.

import { AppmaxClient } from "@assinaturas/appmax";
import { createDb, stores } from "@assinaturas/db";
import { loadEnv } from "../env.ts";
import { encrypt, webhookToken } from "../lib/crypto.ts";

const [name, environment = "sandbox"] = process.argv.slice(2);
const clientId = process.env.APPMAX_CLIENT_ID;
const clientSecret = process.env.APPMAX_CLIENT_SECRET;

if (!name || (environment !== "sandbox" && environment !== "production") || !clientId || !clientSecret) {
  console.error('Uso: APPMAX_CLIENT_ID=... APPMAX_CLIENT_SECRET=... pnpm store:add "Nome" sandbox|production');
  process.exit(1);
}

const env = loadEnv();

// Valida as credenciais antes de gravar: uma listagem barata do que cobra hoje.
const client = new AppmaxClient({ environment, credentials: { clientId, clientSecret } });
const today = new Date().toISOString().slice(0, 10);
await client.listSubscriptions({ next_charge_from: today, next_charge_to: today });

const { db, sql } = createDb(env.DATABASE_URL);
const [store] = await db
  .insert(stores)
  .values({ name, environment, clientId, clientSecretEncrypted: encrypt(clientSecret, env.ENCRYPTION_KEY) })
  .returning();
await sql.end();

if (!store) throw new Error("Falha ao gravar a loja");
console.log(`Loja cadastrada: ${store.id}`);
console.log("Cadastre esta URL em: painel da Appmax → API → Webhooks");
console.log(`${env.API_PUBLIC_URL}/webhooks/appmax/${store.id}?token=${webhookToken(store.id, env.ENCRYPTION_KEY)}`);
console.log('Depois rode a carga inicial pelo painel (botão "Sincronizar tudo").');
