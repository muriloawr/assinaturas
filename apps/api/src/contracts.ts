// Formatos de resposta da API interna, compartilhados com o painel (apps/web).
// Só tipos: o painel importa com `import type` e nada daqui vai para o bundle.

import type { AuditLog, Order, Store, Subscription, SubscriptionCharge, WebhookEvent } from "@assinaturas/db";
import type { AuditFinding } from "./services/coupon-audit.ts";

type Serialized<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

export type StoreDto = Omit<Serialized<Store>, "clientSecretEncrypted">;
export type SubscriptionDto = Omit<Serialized<Subscription>, "raw">;
export type ChargeDto = Serialized<SubscriptionCharge>;
export type OrderDto = Omit<Serialized<Order>, "raw">;
export type WebhookEventDto = Omit<Serialized<WebhookEvent>, "payload">;
export type AuditLogDto = Serialized<AuditLog>;

export interface StoreSummary {
  store: StoreDto;
  webhookUrl: string;
  countsByStatus: Record<string, number>;
  pendingWebhooks: number;
}

export interface SubscriptionPage {
  items: SubscriptionDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SubscriptionDetailDto {
  subscription: SubscriptionDto;
  charges: ChargeDto[];
  originOrder: OrderDto | null;
  finding: AuditFinding | null;
  events: WebhookEventDto[];
  auditLogs: AuditLogDto[];
}

export interface CouponAuditRow extends AuditFinding {
  appmaxId: number;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  valueCents: number;
  originOrderId: number | null;
  originDiscountCents: number | null;
  nextChargeAt: string | null;
}

export interface CouponAuditReport {
  generatedAt: string;
  analyzed: number;
  /** Assinaturas com achado de severidade alta ou média. */
  affected: number;
  lossPerCycleCents: number;
  rows: CouponAuditRow[];
}
