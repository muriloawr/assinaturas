import type { CouponAuditRow } from "@assinaturas/api/contracts";

export const KIND_LABELS: Record<CouponAuditRow["kind"], string> = {
  coupon_inherited: "Cupom herdado em todo ciclo",
  charged_below_catalog: "Cobrança abaixo do catálogo",
  coupon_expected: "Desconto deve se repetir na próxima cobrança",
  freight_registered: "Frete cadastrado (deveria ser grátis)",
  inherited_value_unknown_origin: "Sem produtos, origem não sincronizada",
};
