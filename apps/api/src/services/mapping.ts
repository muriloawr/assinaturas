import {
  parseAppmaxDate,
  reaisToCents,
  type OrderDetail,
  type SubscriptionCharge as AppmaxCharge,
  type SubscriptionDetail,
} from "@assinaturas/appmax";
import type { SubscriptionProductSnapshot } from "@assinaturas/db";

/** Linha de `subscriptions` sem os campos gerados pelo banco. */
export function mapSubscription(storeId: string, detail: SubscriptionDetail, syncedAt: Date) {
  const products: SubscriptionProductSnapshot[] = (detail.products ?? []).map((p) => ({
    name: p.name,
    priceCents: reaisToCents(p.price) ?? 0,
    quantity: p.quantity,
    productId: p.product_id ?? null,
    shopifyProductId: p.shopify_product_id ?? null,
    variantId: p.variant_id ?? null,
    sku: p.sku ?? null,
  }));
  const card = detail.payment?.payment_info;

  return {
    storeId,
    appmaxId: detail.subscription_id,
    status: detail.status,
    interval: detail.interval ?? null,
    intervalCount: detail.interval_count ?? null,
    valueCents: reaisToCents(detail.value) ?? 0,
    freightCents: reaisToCents(detail.freight_value),
    currentCycle: detail.current_cycle ?? null,
    completedCycles: detail.completed_cycles ?? null,
    maxCycles: detail.max_cycles ?? null,
    nextChargeAt: parseAppmaxDate(detail.next_charge_at),
    lastChargeAt: parseAppmaxDate(detail.last_charge_at),
    customerName: detail.customer?.name ?? null,
    customerEmail: detail.customer?.email?.toLowerCase() ?? null,
    customerDocument: detail.customer?.document ?? null,
    customerPhone: detail.customer?.phone ?? null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.final ?? null,
    products,
    hasProducts: products.length > 0,
    originOrderId: originOrderId(detail.charges ?? []),
    appmaxCreatedAt: parseAppmaxDate(detail.created_at),
    canceledAt: parseAppmaxDate(detail.canceled_at),
    pausedFrom: parseAppmaxDate(detail.paused_from),
    pausedUntil: parseAppmaxDate(detail.paused_until),
    raw: detail,
    syncedAt,
  };
}

export function mapCharge(storeId: string, subscriptionId: string, charge: AppmaxCharge) {
  return {
    storeId,
    subscriptionId,
    cycle: charge.cycle,
    appmaxOrderId: charge.order_id,
    shopifyOrderId: charge.shopify_order_id ?? null,
    chargedAt: parseAppmaxDate(charge.charged_at),
    valueCents: reaisToCents(charge.value) ?? 0,
    status: charge.status,
  };
}

export function mapOrder(storeId: string, detail: OrderDetail, syncedAt: Date) {
  const { order } = detail;
  return {
    storeId,
    appmaxOrderId: order.id,
    status: order.status,
    subTotalCents: order.amounts?.sub_total ?? 0,
    shippingCents: order.amounts?.shipping_value ?? 0,
    discountCents: order.amounts?.discount ?? 0,
    installmentFeeCents: order.amounts?.installment_fee ?? 0,
    totalPaidCents: order.total_paid ?? 0,
    raw: detail,
    syncedAt,
  };
}

/**
 * O pedido de origem é a cobrança do ciclo 0. Nem sempre ela vem no histórico
 * da API; nesse caso devolvemos null e o pedido de origem fica com o que já
 * estava gravado ou com o `order_id` do webhook `subscription_created`.
 */
export function originOrderId(charges: AppmaxCharge[]): number | null {
  return charges.find((c) => c.cycle === 0)?.order_id ?? null;
}
