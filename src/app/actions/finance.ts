"use server";
import { act, formObj, num, bool, type ActionResult } from "@/lib/action";
import { createEntry, setEntryReconciled, addPayable, payPayable } from "@/server/finance";

export async function createEntryAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => createEntry(ctx, { category: o.category, amount: num(o.amount), occurred_on: o.occurred_on, description: o.description, reconciled: bool(o.reconciled) }), { message: "Lançamento registrado." });
}
export async function toggleReconciledAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => setEntryReconciled(ctx, Number(fd.get("id")), fd.get("value") === "true"), { message: "Atualizado." });
}
export async function addPayableAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => addPayable(ctx, { amount: num(o.amount)!, description: o.description, due_on: o.due_on }), { message: "Conta a pagar registrada (compromete o caixa)." });
}
export async function payPayableAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => payPayable(ctx, Number(fd.get("id")), String(fd.get("category"))), { message: "Conta paga." });
}
