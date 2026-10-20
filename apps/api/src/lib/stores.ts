import { AppmaxClient } from "@assinaturas/appmax";
import { stores, type Db, type Store } from "@assinaturas/db";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto.ts";

/**
 * Um cliente por loja e por processo: o limitador de requisições fica dentro
 * do cliente, então criar vários para a mesma loja estouraria o limite da Appmax.
 */
export class StoreRegistry {
  private readonly clients = new Map<string, AppmaxClient>();

  constructor(
    private readonly db: Db,
    private readonly encryptionKey: string,
  ) {}

  async get(storeId: string): Promise<Store | null> {
    const [store] = await this.db.select().from(stores).where(eq(stores.id, storeId));
    return store ?? null;
  }

  async require(storeId: string): Promise<Store> {
    const store = await this.get(storeId);
    if (!store) throw new Error(`Loja ${storeId} não encontrada`);
    return store;
  }

  async list(): Promise<Store[]> {
    return this.db.select().from(stores).orderBy(stores.createdAt);
  }

  async client(storeId: string): Promise<AppmaxClient> {
    const cached = this.clients.get(storeId);
    if (cached) return cached;

    const store = await this.require(storeId);
    const client = new AppmaxClient({
      environment: store.environment,
      credentials: {
        clientId: store.clientId,
        clientSecret: decrypt(store.clientSecretEncrypted, this.encryptionKey),
      },
    });
    this.clients.set(storeId, client);
    return client;
  }
}
