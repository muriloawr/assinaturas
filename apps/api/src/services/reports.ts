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

  const subsByOrigin = Map.groupBy(subs, (s) => s.originOrderId);

  const rows: CouponAuditRow[] = [];
  for (const sub of subs) {
    const origin = sub.originOrderId ? (orderById.get(sub.originOrderId) ?? null) : null;
    const findings = auditSubscription(sub, chargesBySub.get(sub.id) ?? [], origin, {
      sharedOriginCount: sub.originOrderId ? subsByOrigin.get(sub.originOrderId)?.length : 1,
    });
    for (const finding of findings) {
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
  }

  const affectedIds = (filter: (r: CouponAuditRow) => boolean) =>
    new Set(rows.filter(filter).map((r) => r.appmaxId)).size;

  rows.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.lossPerCycleCents ?? 0) - (a.lossPerCycleCents ?? 0) ||
      (a.nextChargeAt ?? "").localeCompare(b.nextChargeAt ?? ""),
  );

  return {
    generatedAt: new Date().toISOString(),
    analyzed: subs.length,
    affected: affectedIds((r) => r.severity !== "low" && r.kind !== "freight_registered"),
    lossPerCycleCents: rows.reduce((sum, r) => sum + (r.lossPerCycleCents ?? 0), 0),
    withFreight: affectedIds((r) => r.kind === "freight_registered"),
    extraPerCycleCents: rows.reduce((sum, r) => sum + (r.extraPerCycleCents ?? 0), 0),
    rows,
  };
}
