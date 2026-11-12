"use server";
import { act, formObj, num } from "@/lib/action";
import type { ActionResult } from "@/lib/action";
import { adjustStock, updateInventoryMeta } from "@/server/inventory";

export async function adjustStockAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => adjustStock(ctx, { variantId: Number(o.variant_id), newPhysical: Number(o.new_physical), unitCost: num(o.unit_cost), reason: o.reason }), { message: "Estoque ajustado." });
}
export async function inventoryMetaAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => updateInventoryMeta(ctx, Number(o.variant_id), Number(o.min_qty ?? 0), o.location), { message: "Parâmetros salvos." });
}
