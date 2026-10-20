import type { StoreDto } from "@assinaturas/api/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export default async function Home() {
  const stores = await api<StoreDto[]>("/api/stores");
  if (stores.length === 1) redirect(`/lojas/${stores[0]!.id}`);

  return (
    <main>
      <h1>Lojas</h1>
      {stores.length === 0 ? (
        <p className="muted">
          Nenhuma loja cadastrada. Rode <code>pnpm store:add</code> (veja o README).
        </p>
      ) : (
        <ul>
          {stores.map((s) => (
            <li key={s.id}>
              <Link href={`/lojas/${s.id}`}>{s.name}</Link> <span className="muted">({s.environment})</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
