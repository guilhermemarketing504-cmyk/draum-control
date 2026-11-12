"use server";
import { act, formObj, bool, type ActionResult } from "@/lib/action";
import { createProduct, updateProduct, addVariants, setVariantActive, upsertProductSupplier, markAvailabilityChecked, removeProductSupplier, importProductsCsv } from "@/server/products";
import { parseCsv } from "@/lib/csv";
import { BusinessError } from "@/server/core";

const prodFields = (o: any) => ({
  name: o.name, category: o.category, description: o.description, image_url: o.image_url ?? "", sale_price: o.sale_price,
  promo_price: o.promo_price ?? null, modality: o.modality, status: o.status,
});

export async function createProductAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => createProduct(ctx, prodFields(o), JSON.parse(o.variants || "[]"), o.code || undefined), { message: "Produto cadastrado." });
}
export async function updateProductAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => updateProduct(ctx, Number(o.id), prodFields(o)), { message: "Produto atualizado." });
}
export async function addVariantsAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  const sizes = String(o.sizes ?? "").split(/[,\s]+/).filter(Boolean);
  return act((ctx) => addVariants(ctx, Number(o.id), sizes.map((size) => ({ color: o.color, color_code: o.color_code || undefined, size }))), { message: "Variantes criadas." });
}
export async function toggleVariantAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => setVariantActive(ctx, Number(o.id), o.active === "true"));
}
export async function saveProductSupplierAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => upsertProductSupplier(ctx, Number(o.product_id), {
    supplier_id: o.supplier_id, unit_cost: o.unit_cost, inbound_freight: o.inbound_freight ?? 0, lead_days: o.lead_days,
    availability_checked: bool(o.availability_checked), is_primary: bool(o.is_primary), notes: o.notes,
  }), { message: "Fornecedor vinculado." });
}
export async function checkAvailabilityAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => markAvailabilityChecked(ctx, Number(fd.get("id"))), { message: "Disponibilidade registrada." });
}
export async function removeProductSupplierAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => removeProductSupplier(ctx, Number(fd.get("id"))));
}
export async function importProductsAction(_: ActionResult | null, fd: FormData) {
  const file = fd.get("file") as File | null;
  const dry = fd.get("dry") === "on";
  return act(async (ctx) => {
    if (!file || !file.size) throw new BusinessError("Selecione um arquivo CSV.");
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new BusinessError("Arquivo vazio.");
    const r = await importProductsCsv(ctx, rows, dry);
    const list = r.errors.slice(0, 8).map((e) => `linha ${e.line}: ${e.message}`).join(" · ");
    if (r.errors.length && !r.created) throw new BusinessError(`Nada foi importado. Corrija: ${list}`);
    if (r.errors.length) throw new BusinessError(`${r.created} produto(s) importado(s); estes não entraram: ${list}`);
    return r;
  }, { message: dry ? "Validação concluída: arquivo sem erros." : "Importação concluída." });
}
