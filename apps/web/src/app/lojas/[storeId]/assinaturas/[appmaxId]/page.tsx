import type { SubscriptionDetailDto } from "@assinaturas/api/contracts";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { date, dateTime, intervalLabel, money, statusLabel } from "@/lib/format";
import { syncSubscription } from "../../actions";

const FINDING_TITLES: Partial<Record<SubscriptionDetailDto["findings"][number]["kind"], string>> = {
  coupon_inherited: "Desconto indevido",
  charged_below_catalog: "Desconto indevido",
  coupon_expected: "Desconto deve se repetir",
  freight_registered: "Frete cadastrado",
};

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ storeId: string; appmaxId: string }>;
}) {
  const { storeId, appmaxId } = await params;
  let detail: SubscriptionDetailDto;
  try {
    detail = await api<SubscriptionDetailDto>(`/api/stores/${storeId}/subscriptions/${appmaxId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { subscription: s, charges, originOrder, findings, events } = detail;
  const catalogCents = s.products.reduce((sum, p) => sum + p.priceCents * p.quantity, 0);

  return (
    <main>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Assinatura #{s.appmaxId}</h1>
          <p className="muted">
            {s.customerName} · {s.customerEmail} · sincronizada em {dateTime(s.syncedAt)}
          </p>
        </div>
        <form action={syncSubscription.bind(null, storeId, s.appmaxId)}>
          <button type="submit" className="secondary">
            Sincronizar agora
          </button>
        </form>
      </div>

      {findings.map((finding) => (
        <div key={finding.kind} className={`alert ${finding.severity}`}>
          <strong>{FINDING_TITLES[finding.kind] ?? "Atenção"}:</strong> {finding.message}
          {finding.lossPerCycleCents !== null && (
            <> Diferença estimada: {money(finding.lossPerCycleCents)} por ciclo.</>
          )}
        </div>
      ))}

      <dl className="grid">
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(s.status)}</dd>
        </div>
        <div>
          <dt>Periodicidade</dt>
          <dd>{intervalLabel(s.interval, s.intervalCount)}</dd>
        </div>
        <div>
          <dt>Valor da assinatura</dt>
          <dd>
            {money(s.valueCents)}
            {s.freightCents ? ` + ${money(s.freightCents)} de frete` : ""}
          </dd>
        </div>
        <div>
          <dt>Próxima cobrança</dt>
          <dd>{date(s.nextChargeAt)}</dd>
        </div>
        <div>
          <dt>Ciclo atual</dt>
          <dd>
            {s.currentCycle ?? "—"}
            {s.maxCycles ? ` de ${s.maxCycles}` : " (sem limite)"}
          </dd>
        </div>
        <div>
          <dt>Cartão</dt>
          <dd>{s.cardBrand ? `${s.cardBrand} final ${s.cardLast4}` : "—"}</dd>
        </div>
        <div>
          <dt>Pedido de origem</dt>
          <dd>
            {s.originOrderId ? `#${s.originOrderId}` : "—"}
            {originOrder && originOrder.discountCents > 0 && ` (desconto de ${money(originOrder.discountCents)})`}
          </dd>
        </div>
        {s.status === "PAUSED" && (
          <div>
            <dt>Pausada</dt>
            <dd>
              de {date(s.pausedFrom)} até {s.pausedUntil ? date(s.pausedUntil) : "indeterminado"}
            </dd>
          </div>
        )}
      </dl>

      <h2>Produtos</h2>
      {s.hasProducts ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th className="num">Qtd.</th>
                <th className="num">Preço</th>
              </tr>
            </thead>
            <tbody>
              {s.products.map((p, i) => (
                <tr key={`${p.productId ?? p.variantId}-${i}`}>
                  <td>{p.name}</td>
                  <td>{p.sku ?? "—"}</td>
                  <td className="num">{p.quantity}</td>
                  <td className="num">{money(p.priceCents)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <strong>Total de catálogo</strong>
                </td>
                <td className="num">
                  <strong>{money(catalogCents)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          Assinatura criada sem produtos: o valor foi herdado do pedido de origem e a Appmax não permite
          alterar produtos dela pela API.
        </p>
      )}

      <h2>Cobranças</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ciclo</th>
              <th>Pedido</th>
              <th>Data</th>
              <th className="num">Valor</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id}>
                <td>{c.cycle === 0 ? "0 (origem)" : c.cycle}</td>
                <td>#{c.appmaxOrderId}</td>
                <td>{date(c.chargedAt)}</td>
                <td className="num">{money(c.valueCents)}</td>
                <td>
                  <span className={`badge ${c.status === "paid" ? "ok" : c.status === "failed" ? "high" : ""}`}>
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
            {charges.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nenhuma cobrança registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Eventos recebidos</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recebido em</th>
              <th>Evento</th>
              <th>Pedido</th>
              <th>Processado</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{dateTime(e.receivedAt)}</td>
                <td>
                  <code>{e.event}</code>
                </td>
                <td>{e.appmaxOrderId ? `#${e.appmaxOrderId}` : "—"}</td>
                <td>{e.processedAt ? dateTime(e.processedAt) : <span className="badge medium">pendente</span>}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nenhum webhook recebido para esta assinatura.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
