// Tipos da API da Appmax, escritos a partir de https://docs.appmax.com.br.
// Os campos seguem exatamente os nomes da API; valores de assinatura vêm em
// reais (number) e valores de pedido vêm em centavos (integer).

export type AppmaxEnvironment = "sandbox" | "production";

export interface AppmaxCredentials {
  clientId: string;
  clientSecret: string;
}

export type SubscriptionInterval = "week" | "month" | "year";

/** Status como aparecem em GET /v1/subscriptions e GET /v1/subscriptions/{id}. */
export type SubscriptionStatus =
  | "ACTIVE"
  | "PAUSED"
  | "CANCELLED"
  | "OVERDUE"
  | "SUSPENDED"
  | "FINISHED";

export type DiscountType = "nominal" | "percent";

export interface SubscriptionProduct {
  name: string;
  price: number;
  quantity: number;
  product_id: number | null;
  shopify_product_id: string | null;
  variant_id: string | null;
  sku?: string | null;
  image_url: string | null;
  compare_at_price: number | null;
}

export interface SubscriptionCharge {
  cycle: number;
  order_id: number;
  shopify_order_id: string | null;
  /** dd/mm/aaaa */
  charged_at: string | null;
  value: number;
  status: string;
}

export interface SubscriptionCustomer {
  name: string;
  email: string;
  document: string | null;
  phone: string | null;
  address?: {
    country: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    postcode: string | null;
  } | null;
}

export interface SubscriptionPaymentInfo {
  payment_info: {
    brand: string | null;
    final: string | null;
    expiration: string | null;
  } | null;
}

/** GET /v1/subscriptions/{id} */
export interface SubscriptionDetail {
  subscription_id: number;
  status: SubscriptionStatus;
  products: SubscriptionProduct[];
  value: number;
  freight_value: number | null;
  interval: SubscriptionInterval;
  interval_count: number;
  current_cycle: number;
  completed_cycles: number;
  max_cycles: number | null;
  customer: SubscriptionCustomer;
  payment: SubscriptionPaymentInfo | null;
  /** aaaa-mm-dd hh:mm:ss (horário de Brasília) */
  next_charge_at: string | null;
  /** dd/mm/aaaa */
  last_charge_at: string | null;
  charges: SubscriptionCharge[];
  created_at: string;
  canceled_at: string | null;
  paused_from: string | null;
  paused_until: string | null;
}

/** Item de GET /v1/subscriptions. Note que aqui `next_charge_at` vem como dd/mm/aaaa. */
export interface SubscriptionListItem {
  subscription_id: number;
  status: SubscriptionStatus;
  products: SubscriptionProduct[];
  value: number;
  freight_value: number | null;
  current_cycle: number;
  customer: SubscriptionCustomer;
  payment: SubscriptionPaymentInfo | null;
  charges: SubscriptionCharge[];
  next_charge_at: string | null;
}

export interface Pagination {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export interface SubscriptionList {
  subscriptions: SubscriptionListItem[];
  pagination: Pagination;
}

export interface ListSubscriptionsParams {
  email?: string;
  /** aaaa-mm-dd */
  next_charge_from?: string;
  /** aaaa-mm-dd */
  next_charge_to?: string;
  status?: Extract<SubscriptionStatus, "ACTIVE" | "PAUSED" | "CANCELLED" | "OVERDUE">;
  page?: number;
}

/** GET /v1/orders/{order_id}. Valores em centavos. */
export interface OrderDetail {
  order: {
    id: number;
    status: string;
    total_paid: number;
    amounts: {
      sub_total: number;
      shipping_value: number;
      discount: number;
      installment_fee: number;
    };
    created_at: string;
    updated_at: string;
  };
  customer: {
    id: number;
    name: string;
    email: string;
    document_number: string | null;
  };
  payment: {
    method: string;
    installments: number | null;
    installments_amount: number | null;
    card?: { brand: string | null; number: string | null } | null;
    paid_at: string | null;
  } | null;
}

export interface PauseSubscriptionInput {
  /** aaaa-mm-dd. Sem valor, pausa por prazo indeterminado. */
  paused_until?: string;
  reason?: string;
}

export interface DiscountInput {
  discount: number;
  discount_type?: DiscountType;
}

export interface CycleDiscountInput extends DiscountInput {
  /** Omitido, vale para o próximo ciclo. */
  cycle_index?: number;
}

/** Envelope comum dos webhooks da Appstore. */
export interface WebhookEnvelope<T = Record<string, unknown>> {
  event: string;
  event_type: "order" | "customer" | "payment" | "subscription" | "withdraw" | string;
  site_id?: string;
  app_id?: string;
  client_key?: string | null;
  external_key?: string | null;
  data: T;
  partner_merchant?: {
    merchant_email?: string;
    merchant_document_number?: string;
    merchant_phone?: string;
  };
}
