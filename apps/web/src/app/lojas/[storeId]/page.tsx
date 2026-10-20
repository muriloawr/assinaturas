import type { CouponAuditReport, StoreSummary } from "@assinaturas/api/contracts";
import Link from "next/link";
import { api } from "@/lib/api";
import { dateTime, money, statusLabel } from "@/lib/format";
import { reconcileStore } from "./actions";

const STATUS_ORDER = ["ACTIVE", "OVERDUE", "PAUSED", "CANCELLED", "SUSPENDED", "FINISHED"];

export default async function StoreOverview({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const [summary, report] = await Promise.all([
    api<StoreSummary>(`/api/stores/${storeId}`),
    api<CouponAuditReport>(`/api/stores/${storeId}/reports/coupon-audit`),
  ]);
  const total = Object.values(summary.countsByStatus).reduce((a, b) => a + b, 0);
  const statuses = Object.keys(summary.countsByStatus).sort(
    (a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b),
  );

  return (
    <main>
      <h1>Visão geral</h1>
      <p className="muted">
        Última sincronização completa: {dateTime(summary.store.lastBackfillAt)}
        {summary.pendingWebhooks > 0 && ` · ${summary.pendingWebhooks} webhook(s) aguardando processamento`}
      </p>

      {report.affected > 0 && (
        <div className="alert high">
          <strong>{report.affected} assinatura(s) com desconto indevido</strong> — cerca de{" "}
          {money(report.lossPerCycleCents)} deixam de ser cobrados por ciclo.{" "}
          <Link href={`/lojas/${storeId}/relatorios/cupom`}>Ver relatório</Link>
        </div>
      )}

      <div className="cards">
        <div className="card">
          <div className="label">Total no espelho</div>
          <div className="value">{total}</div>
        </div>
        {statuses.map((status) => (
          <Link key={status} href={`/lojas/${storeId}/assinaturas?status=${status}`} className="card">
            <div className="label">{statusLabel(status)}</div>
            <div className="value">{summary.countsByStatus[status]}</div>
          </Link>
        ))}
      </div>

      <div className="actions">
        <form action={reconcileStore.bind(null, storeId)}>
          <button type="submit">Sincronizar tudo com a Appmax</button>
        </form>
        <span className="muted">
          Roda em segundo plano. Também acontece todo dia às 5h.
        </span>
      </div>

      <h2>Webhook</h2>
      <p className="muted">
        Cadastre esta URL no painel da Appmax (API → Webhooks) com os eventos de assinatura:
      </p>
      <p>
        <code>{summary.webhookUrl}</code>
      </p>
    </main>
  );
}
