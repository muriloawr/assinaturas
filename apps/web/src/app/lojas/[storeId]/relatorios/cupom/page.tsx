import type { CouponAuditReport } from "@assinaturas/api/contracts";
import Link from "next/link";
import { api } from "@/lib/api";
import { date, dateTime, money, statusLabel } from "@/lib/format";
import { KIND_LABELS } from "./labels";

export default async function CouponReportPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const report = await api<CouponAuditReport>(`/api/stores/${storeId}/reports/coupon-audit`);

  return (
    <main>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Relatório do cupom</h1>
          <p className="muted">Gerado em {dateTime(report.generatedAt)} a partir do espelho local.</p>
        </div>
        <a className="button secondary" href={`/lojas/${storeId}/relatorios/cupom/csv`}>
          Exportar CSV
        </a>
      </div>

      <div className="alert">
        Assinaturas criadas na Appmax <strong>sem a lista de produtos</strong> herdam o valor do primeiro pedido.
        Se esse pedido teve cupom, o desconto passa a valer em todas as cobranças. Este relatório só aponta
        os casos; corrigir o valor de quem já assina é uma decisão comercial e exige aviso prévio ao
        assinante.
      </div>

      <div className="cards">
        <div className="card">
          <div className="label">Assinaturas analisadas</div>
          <div className="value">{report.analyzed}</div>
        </div>
        <div className="card">
          <div className="label">Com desconto indevido</div>
          <div className="value">{report.affected}</div>
        </div>
        <div className="card">
          <div className="label">Não cobrado por ciclo (estimado)</div>
          <div className="value">{money(report.lossPerCycleCents)}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Assinatura</th>
              <th>Cliente</th>
              <th>Status</th>
              <th>Achado</th>
              <th className="num">Valor atual</th>
              <th className="num">Desconto na origem</th>
              <th className="num">Diferença/ciclo</th>
              <th>Próxima cobrança</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.appmaxId}>
                <td>
                  <Link href={`/lojas/${storeId}/assinaturas/${r.appmaxId}`}>#{r.appmaxId}</Link>
                </td>
                <td>
                  {r.customerName}
                  <div className="muted">{r.customerEmail}</div>
                </td>
                <td>{statusLabel(r.status)}</td>
                <td className="wrap">
                  <span className={`badge ${r.severity}`}>{KIND_LABELS[r.kind]}</span>
                  <div className="muted">{r.message}</div>
                </td>
                <td className="num">{money(r.valueCents)}</td>
                <td className="num">{money(r.originDiscountCents)}</td>
                <td className="num">{money(r.lossPerCycleCents)}</td>
                <td>{date(r.nextChargeAt)}</td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Nenhum caso encontrado. Se o espelho ainda está vazio, rode a sincronização na visão geral.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
