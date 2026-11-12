"use server";
import { act, formObj, bool, type ActionResult } from "@/lib/action";
import { createCustomer, updateCustomer, setStage, logContact, deleteCustomer, importCustomersCsv } from "@/server/crm";
import { parseCsv } from "@/lib/csv";
import { BusinessError } from "@/server/core";

const fields = (o: any) => ({
  name: o.name, whatsapp: o.whatsapp, instagram: o.instagram, email: o.email ?? "", city: o.city, neighborhood: o.neighborhood, address: o.address,
  product_prefs: o.product_prefs, sizes: o.sizes, lead_source: o.lead_source, vip_joined_at: o.vip_joined_at ?? "",
  consent_whatsapp: bool(o.consent_whatsapp), consent_email: bool(o.consent_email), consent_source: o.consent_source, notes: o.notes,
  campaign_id: o.campaign_id, ambassador_id: o.ambassador_id,
});

export async function saveCustomerAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return o.id ? act((ctx) => updateCustomer(ctx, Number(o.id), fields(o)), { message: "Cliente atualizado." })
              : act((ctx) => createCustomer(ctx, fields(o)), { message: "Cliente cadastrado." });
}
export async function setStageAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => setStage(ctx, Number(fd.get("id")), String(fd.get("stage"))), { message: "Etapa atualizada." });
}
export async function logContactAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => logContact(ctx, Number(fd.get("id")), String(fd.get("channel")), String(fd.get("note") ?? "")), { message: "Contato registrado." });
}
export async function deleteCustomerAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => deleteCustomer(ctx, Number(fd.get("id"))), { message: "Dados pessoais removidos." });
}
export async function importCustomersAction(_: ActionResult | null, fd: FormData) {
  const file = fd.get("file") as File | null;
  return act(async (ctx) => {
    if (!file || !file.size) throw new BusinessError("Selecione um arquivo CSV.");
    const r = await importCustomersCsv(ctx, parseCsv(await file.text()), fd.get("authorized") === "on");
    if (r.errors.length) throw new BusinessError(`${r.created} importado(s), ${r.skipped} já existiam. Erros: ${r.errors.slice(0, 6).map((e) => `linha ${e.line}: ${e.message}`).join(" · ")}`);
    return r;
  }, { message: "Importação concluída." });
}
