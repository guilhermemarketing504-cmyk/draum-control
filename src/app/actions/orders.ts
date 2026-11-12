"use server";
import { act, formObj, num, errorMessage, type ActionResult } from "@/lib/action";
import { getSession } from "@/lib/auth";
import {
  previewOrder, createOrder, informPayment, reconcilePayment, rejectPayment, markItemsReady, handOver,
  confirmShipmentDelivered, finalizeOrder, cancelOrder, payRefund, registerReturn,
} from "@/server/orders";

export async function previewOrderAction(input: unknown) {
  if (!(await getSession())) return { ok: false as const, error: "Sessão expirada." };
  try { return { ok: true as const, data: await previewOrder(input) }; } catch (e) { return { ok: false as const, error: errorMessage(e) }; }
}
export async function createOrderAction(input: unknown) {
  return act((ctx) => createOrder(ctx, input), { message: "Pedido criado." });
}
const ids = (o: any) => (o.items ?? []).map(Number).filter(Boolean);

export async function informPaymentAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => informPayment(ctx, Number(o.order_id), { amount: num(o.amount)!, method: o.method, externalRef: o.external_ref, feeAmount: num(o.fee_amount) }), { message: "Pagamento informado. Aguarda conciliação." });
}
export async function reconcilePaymentAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => reconcilePayment(ctx, Number(o.payment_id), num(o.fee_amount)), { message: "Pagamento conciliado." });
}
export async function rejectPaymentAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => rejectPayment(ctx, Number(o.payment_id), o.reason ?? "não identificado no extrato"), { message: "Pagamento rejeitado." });
}
export async function markReadyAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => markItemsReady(ctx, Number(o.order_id), ids(o)), { message: "Itens conferidos e embalados." });
}
export async function handOverAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => handOver(ctx, Number(o.order_id), ids(o), o.method, o.note), { message: o.method === "retirada" ? "Retirada registrada." : "Envio registrado." });
}
export async function confirmDeliveredAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => confirmShipmentDelivered(ctx, Number(o.order_id), ids(o)), { message: "Entrega confirmada." });
}
export async function finalizeOrderAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => finalizeOrder(ctx, Number(fd.get("order_id"))), { message: "Pedido finalizado." });
}
export async function cancelOrderAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => cancelOrder(ctx, Number(o.order_id), o.reason), { message: "Pedido cancelado." });
}
export async function payRefundAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => payRefund(ctx, Number(fd.get("refund_id"))), { message: "Reembolso pago." });
}
export async function returnAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => registerReturn(ctx, {
    orderItemId: Number(o.order_item_id), kind: o.kind, qty: Number(o.qty), reason: o.reason, restock: o.restock === true,
    newVariantId: o.new_variant_id ? Number(o.new_variant_id) : null, refundAmount: num(o.refund_amount) ?? null,
  }), { message: o.kind === "troca" ? "Troca registrada." : "Devolução registrada." });
}
