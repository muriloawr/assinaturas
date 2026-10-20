"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";

export async function reconcileStore(storeId: string) {
  await api(`/api/stores/${storeId}/reconcile`, { method: "POST" });
  revalidatePath(`/lojas/${storeId}`);
}

export async function syncSubscription(storeId: string, appmaxId: number) {
  await api(`/api/stores/${storeId}/subscriptions/${appmaxId}/sync`, { method: "POST" });
  revalidatePath(`/lojas/${storeId}/assinaturas/${appmaxId}`);
}
