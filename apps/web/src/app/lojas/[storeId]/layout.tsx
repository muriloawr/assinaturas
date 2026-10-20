import type { StoreSummary } from "@assinaturas/api/contracts";
import Link from "next/link";
import { api } from "@/lib/api";

export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const { store } = await api<StoreSummary>(`/api/stores/${storeId}`);
  const base = `/lojas/${storeId}`;

  return (
    <>
      <header className="top">
        <strong>{store.name}</strong>
        {store.environment === "sandbox" && <span className="badge medium">sandbox</span>}
        <nav>
          <Link href={base}>Visão geral</Link>
          <Link href={`${base}/assinaturas`}>Assinaturas</Link>
          <Link href={`${base}/relatorios/cupom`}>Relatório do cupom</Link>
        </nav>
      </header>
      {children}
    </>
  );
}
