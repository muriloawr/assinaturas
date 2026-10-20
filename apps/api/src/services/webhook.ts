// Interpretação dos webhooks da Appmax.
//
// Regra principal: o webhook é só um gatilho. O conteúdo não é assinado (a
// Appmax não envia HMAC) e o formato do webhook do painel difere do da
// Appstore, então nunca gravamos o estado da assinatura a partir do payload:
// sempre buscamos GET /v1/subscriptions/{id} e gravamos o que a API responde.

/**
 * Eventos que acontecem uma única vez por (assinatura, pedido). Só esses
 * recebem chave de deduplicação. Os demais podem se repetir legitimamente
 * com o mesmo order_id (pausar → retomar → pausar; retentativas de cobrança
 * recusada reutilizam o pedido) e, como só disparam uma sincronização,
 * processá-los de novo não tem efeito colateral.
 */
const ONCE_PER_ORDER_EVENTS = new Set([
  "subscription_created",
  "subscription_charge_success",
  "subscription_cancelation",
]);

export interface ParsedWebhook {
  event: string;
  eventType: string | null;
  appmaxSubscriptionId: number | null;
  appmaxOrderId: number | null;
  dedupeKey: string | null;
}

export function parseWebhook(payload: unknown): ParsedWebhook | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const event = typeof body.event === "string" ? body.event : null;
  if (!event) return null;

  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const eventType = typeof body.event_type === "string" ? body.event_type : null;
  const isSubscriptionEvent = eventType === "subscription" || event.startsWith("subscription_");

  const appmaxSubscriptionId = isSubscriptionEvent
    ? toId(data.subscription_id ?? body.subscription_id)
    : null;
  const appmaxOrderId = toId(data.order_id ?? body.order_id);

  const dedupeKey =
    ONCE_PER_ORDER_EVENTS.has(event) && appmaxSubscriptionId !== null && appmaxOrderId !== null
      ? `${event}:${appmaxSubscriptionId}:${appmaxOrderId}`
      : null;

  return { event, eventType, appmaxSubscriptionId, appmaxOrderId, dedupeKey };
}

function toId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}
