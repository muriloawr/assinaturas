import { orders, subscriptionCharges, subscriptions, type Db } from "@assinaturas/db";
import { and, eq, inArray } from "drizzle-orm";
import type { CouponAuditReport, CouponAuditRow } from "../contracts.ts";
import { auditSubscription } from "./coupon-audit.ts";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export async function couponAuditReport(db: Db, storeId: string): Promise<CouponAuditReport> {
  const subs = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.storeId, storeId),
        inArray(subscriptions.status, ["ACTIVE", "PAUSED", "OVERDUE"]),
      ),
    );

  const subIds = subs.map((s) => s.id);
  const charges = subIds.length
    ? await db.select().from(subscriptionCharges).where(inArray(subscriptionCharges.subscriptionId, subIds))
    : [];
  const orderIds = subs.map((s) => s.originOrderId).filter((id): id is number => id !== null);
  const originOrders = orderIds.length
    ? await db
        .select()
        .from(orders)
        .where(and(eq(orders.storeId, storeId), inArray(orders.appmaxOrderId, orderIds)))
    : [];

  const chargesBySub = Map.groupBy(charges, (c) => c.subscriptionId);
  const orderById = new Map(originOrders.map((o) => [o.appmaxOrderId, o]));

  const rows: CouponAuditRow[] = [];
  for (const sub of subs) {
    const origin = sub.originOrderId ? (orderById.get(sub.originOrderId) ?? null) : null;
    const finding = auditSubscription(sub, chargesBySub.get(sub.id) ?? [], origin);
    if (!finding) continue;
    rows.push({
      appmaxId: sub.appmaxId,
      status: sub.status,
      customerName: sub.customerName,
      customerEmail: sub.customerEmail,
      valueCents: sub.valueCents,
      originOrderId: sub.originOrderId,
      originDiscountCents: origin?.discountCents ?? null,
      nextChargeAt: sub.nextChargeAt?.toISOString() ?? null,
      ...finding,
    });
  }

  rows.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.lossPerCycleCents ?? 0) - (a.lossPerCycleCents ?? 0),
  );

  return {
    generatedAt: new Date().toISOString(),
    analyzed: subs.length,
    affected: rows.filter((r) => r.severity !== "low").length,
    lossPerCycleCents: rows.reduce((sum, r) => sum + (r.lossPerCycleCents ?? 0), 0),
    rows,
  };
}
