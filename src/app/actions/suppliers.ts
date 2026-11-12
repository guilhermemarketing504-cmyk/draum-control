"use server";
import { act, formObj, bool, type ActionResult } from "@/lib/action";
import { saveSupplier } from "@/server/suppliers";

export async function saveSupplierAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  const id = o.id ? Number(o.id) : null;
  return act((ctx) => saveSupplier(ctx, id, { ...o, email: o.email ?? "", active: id ? bool(o.active) : true }), { message: "Fornecedor salvo." });
}
