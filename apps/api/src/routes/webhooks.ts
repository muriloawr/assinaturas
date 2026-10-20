import { webhookEvents } from "@assinaturas/db";
import type { FastifyInstance } from "fastify";
import { safeEqual, webhookToken } from "../lib/crypto.ts";
import { parseWebhook } from "../services/webhook.ts";
import type { AppDeps } from "../app.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function webhookRoutes(app: FastifyInstance, deps: AppDeps) {
  // A Appmax desiste após 5s sem resposta, então aqui só gravamos e enfileiramos.
  app.post<{ Params: { storeId: string }; Querystring: { token?: string } }>(
    "/webhooks/appmax/:storeId",
    async (request, reply) => {
      const { storeId } = request.params;
      const expected = UUID.test(storeId) ? webhookToken(storeId, deps.env.ENCRYPTION_KEY) : null;
      if (!expected || !safeEqual(request.query.token ?? "", expected) || !(await deps.registry.get(storeId))) {
        return reply.code(404).send({ error: "not found" });
      }

      const parsed = parseWebhook(request.body);
      if (!parsed) return reply.code(400).send({ error: "payload sem campo event" });

      const [inserted] = await deps.db
        .insert(webhookEvents)
        .values({
          storeId,
          event: parsed.event,
          eventType: parsed.eventType,
          appmaxSubscriptionId: parsed.appmaxSubscriptionId,
          appmaxOrderId: parsed.appmaxOrderId,
          dedupeKey: parsed.dedupeKey,
          payload: request.body as object,
        })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });

      if (!inserted) {
        request.log.info({ dedupeKey: parsed.dedupeKey }, "webhook duplicado ignorado");
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      if (parsed.appmaxSubscriptionId !== null) {
        await deps.jobs.enqueueSync({
          storeId,
          appmaxId: parsed.appmaxSubscriptionId,
          // Em subscription_created, order_id é o pedido de origem.
          originOrderId: parsed.event === "subscription_created" ? parsed.appmaxOrderId : null,
        });
      }

      return reply.code(200).send({ ok: true });
    },
  );
}
