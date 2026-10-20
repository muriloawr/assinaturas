import type { SubscriptionPage } from "@assinaturas/api/contracts";
import Link from "next/link";
import { api } from "@/lib/api";
import { date, intervalLabel, money, STATUS_LABELS, statusLabel } from "@/lib/format";

export default async function SubscriptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { storeId } = await params;
  const { status = "", q = "", page = "1" } = await searchParams;

  const query = new URLSearchParams({ page });
  if (status) query.set("status", status);
  if (q) query.set("q", q);
  const result = await api<SubscriptionPage>(`/api/stores/${storeId}/subscriptions?${query}`);

  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const pageHref = (p: number) => {
    const next = new URLSearchParams(query);
    next.set("page", String(p));
    return `?${next}`;
  };

  return (
    <main>
      <h1>Assinaturas</h1>
      <form className="filters">
        <input type="search" name="q" defaultValue={q} placeholder="E-mail, nome, CPF ou ID da assinatura" />
        <select name="status" defaultValue={status}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit">Filtrar</button>
      </form>

      <p className="muted">{result.total} assinatura(s)</p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Cliente</th>
              <th>Status</th>
              <th>Periodicidade</th>
              <th className="num">Valor</th>
              <th>Próxima cobrança</th>
              <th>Ciclo</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/lojas/${storeId}/assinaturas/${s.appmaxId}`}>#{s.appmaxId}</Link>
                </td>
                <td>
                  {s.customerName}
                  <div className="muted">{s.customerEmail}</div>
                </td>
                <td>
                  <span className={`badge ${s.status === "ACTIVE" ? "ok" : s.status === "OVERDUE" ? "high" : ""}`}>
                    {statusLabel(s.status)}
                  </span>
                </td>
                <td>{intervalLabel(s.interval, s.intervalCount)}</td>
                <td className="num">{money(s.valueCents)}</td>
                <td>{date(s.nextChargeAt)}</td>
                <td>
                  {s.currentCycle ?? "—"}
                  {s.maxCycles ? ` de ${s.maxCycles}` : ""}
                </td>
              </tr>
            ))}
            {result.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nenhuma assinatura encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="pagination">
          {result.page > 1 && <Link href={pageHref(result.page - 1)}>← Anterior</Link>}
          <span className="muted">
            Página {result.page} de {lastPage}
          </span>
          {result.page < lastPage && <Link href={pageHref(result.page + 1)}>Próxima →</Link>}
        </div>
      )}
    </main>
  );
}
