// Tipos da API da Appmax, escritos a partir de https://docs.appmax.com.br e
// conferidos com respostas reais de produção (outubro de 2026). Os campos
// seguem exatamente os nomes da API; valores de assinatura vêm em reais e
// valores de pedido vêm em centavos (integer).
//
// Campos opcionais marcados "fora da documentação" aparecem nas respostas
// reais, mas não nos exemplos da documentação.

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
  /** A documentação mostra number, mas a API real devolve texto ("35.33"), às vezes negativo. */
  value: number | string;
  /** "paid", "overdue", ... */
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

/** Campos que vêm no detalhe e na listagem, fora da documentação. */
export interface SubscriptionExtras {
  /** Pedido que originou a assinatura. O histórico de cobranças não traz o ciclo 0. */
  original_order_id?: number | null;
  original_shopify_order_id?: string | null;
  tag?: string | null;
  /** Desconto permanente da assinatura (PATCH /discount). */
  discount?: number | null;
  discount_type?: DiscountType | null;
  cycle_changes?: unknown[];
  skipped_cycles?: unknown[];
}

/** GET /v1/subscriptions/{id} */
export interface SubscriptionDetail extends SubscriptionExtras {
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
  /** Fora da documentação. */
  pause_reason?: string | null;
  /** Fora da documentação. */
  cancel_reason?: string | null;
}

/** Item de GET /v1/subscriptions. Note que aqui `next_charge_at` vem como dd/mm/aaaa. */
export interface SubscriptionListItem extends SubscriptionExtras {
  subscription_id: number;
  status: SubscriptionStatus;
  products: SubscriptionProduct[];
  value: number;
  freight_value: number | null;
  /** Fora da documentação. */
  interval?: SubscriptionInterval;
  /** Fora da documentação. */
  interval_count?: number;
  /** Fora da documentação. aaaa-mm-dd hh:mm:ss */
  created_at?: string;
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
    /** Em português: "aprovado", "integrado", "cancelado", ... */
    status: string;
    total_paid: number;
    amounts: {
      /**
       * Em pedidos vindos da Shopify o frete pode vir somado aqui, com
       * `shipping_value` zerado, e o frete grátis aparecer como `discount`.
       */
      sub_total: number;
      shipping_value: number;
      discount: number;
      /** Não vem na API real. */
      installment_fee?: number;
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
  /** Pedidos cancelados trazem só `method`. */
  payment: {
    method: string;
    installments?: number | null;
    installments_amount?: number | null;
    card?: { brand: string | null; number: string | null } | null;
    paid_at?: string | null;
  } | null;
  /** Fora da documentação. Preços em centavos. */
  products?: { id: number; name: string; sku: string | null; price: number; quantity: number }[];
  /** Fora da documentação. */
  split_orders?: unknown;
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
