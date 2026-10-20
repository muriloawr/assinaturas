import type { CouponAuditReport } from "@assinaturas/api/contracts";
import { api } from "@/lib/api";
import { KIND_LABELS } from "../labels";

const HEADER = [
  "assinatura",
  "cliente",
  "email",
  "status",
  "achado",
  "severidade",
  "valor_atual",
  "pedido_origem",
  "desconto_origem",
  "diferenca_por_ciclo",
  "proxima_cobranca",
  "detalhe",
];

export async function GET(_request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const report = await api<CouponAuditReport>(`/api/stores/${storeId}/reports/coupon-audit`);

  const reais = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
  const lines = report.rows.map((r) =>
    [
      r.appmaxId,
      r.customerName,
      r.customerEmail,
      r.status,
      KIND_LABELS[r.kind],
      r.severity,
      reais(r.valueCents),
      r.originOrderId,
      reais(r.originDiscountCents),
      reais(r.lossPerCycleCents),
      r.nextChargeAt?.slice(0, 10),
      r.message,
    ]
      .map(csvCell)
      .join(";"),
  );

  // BOM + ";" para o Excel em português abrir sem quebrar acentos e colunas.
  const body = "﻿" + [HEADER.join(";"), ...lines].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-cupom-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
