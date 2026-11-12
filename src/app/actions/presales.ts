"use server";
import { act, formObj, num, type ActionResult } from "@/lib/action";
import { createPurchaseOrder, sendPurchaseOrder, payPurchaseOrder, updateTracking, receivePurchaseOrder, cancelPurchaseOrder } from "@/server/presales";

export async function createPurchaseOrderAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  const itemIds = (o.items ?? []).map(Number);
  const confirmedCosts: Record<number, number> = {};
  for (const id of itemIds) { const c = num(o[`cost_${id}`]); if (c != null) confirmedCosts[id] = c; }
  return act((ctx) => createPurchaseOrder(ctx, { supplierId: Number(o.supplier_id), orderItemIds: itemIds, confirmedCosts, shippingCost: num(o.shipping_cost) ?? 0, notes: o.notes }), { message: "Compra criada em rascunho.", redirect: (d) => `/pre-vendas/compras/${d.id}` });
}
export async function createStockPurchaseAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => createPurchaseOrder(ctx, { supplierId: Number(o.supplier_id), orderItemIds: [], stockItems: [{ variantId: Number(o.variant_id), qty: Number(o.qty), unitCost: num(o.unit_cost)! }], shippingCost: num(o.shipping_cost) ?? 0, notes: o.notes }), { message: "Compra de reposição criada.", redirect: (d) => `/pre-vendas/compras/${d.id}` });
}
export async function sendPOAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => sendPurchaseOrder(ctx, Number(o.po_id), o.expected_at || undefined), { message: "Compra registrada como enviada ao fornecedor." });
}
export async function payPOAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => payPurchaseOrder(ctx, Number(fd.get("po_id"))), { message: "Pagamento ao fornecedor registrado." });
}
export async function trackingAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => updateTracking(ctx, Number(o.po_id), o.tracking_code ?? "", o.expected_at || undefined), { message: "Rastreio atualizado." });
}
export async function receivePOAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  const lines = Object.keys(o).filter((k) => k.startsWith("recv_")).map((k) => ({ poItemId: Number(k.slice(5)), qty: Number(o[k] ?? 0) }));
  return act((ctx) => receivePurchaseOrder(ctx, Number(o.po_id), lines), { message: "Recebimento conferido registrado." });
}
export async function cancelPOAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => cancelPurchaseOrder(ctx, Number(fd.get("po_id")), String(fd.get("reason") ?? "")), { message: "Compra cancelada." });
}
