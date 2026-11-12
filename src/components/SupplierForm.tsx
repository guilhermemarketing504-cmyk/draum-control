"use client";
import { ActionForm, Field } from "./forms";
import { saveSupplierAction } from "@/app/actions/suppliers";

export function SupplierForm({ s }: { s?: any }) {
  return (
    <ActionForm action={saveSupplierAction} submitLabel={s ? "Salvar" : "Cadastrar fornecedor"} reset={!s} redirectTo={s ? undefined : (d) => `/fornecedores/${d.id}`} className="grid sm:grid-cols-2 gap-3">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Nome / razão social" className="sm:col-span-2"><input className="input" name="name" defaultValue={s?.name} required /></Field>
      <Field label="Contato"><input className="input" name="contact_name" defaultValue={s?.contact_name ?? ""} /></Field>
      <Field label="WhatsApp (DDD + número)"><input className="input" name="whatsapp" defaultValue={s?.whatsapp ?? ""} /></Field>
      <Field label="E-mail"><input className="input" name="email" type="email" defaultValue={s?.email ?? ""} /></Field>
      <Field label="Cidade"><input className="input" name="city" defaultValue={s?.city ?? ""} /></Field>
      <Field label="Prazo padrão (dias)"><input className="input" name="default_lead_days" type="number" min="0" defaultValue={s?.default_lead_days ?? ""} /></Field>
      {s && <label className="flex items-center gap-2 text-[13px] self-end h-9"><input type="checkbox" name="active" defaultChecked={s.active} /> Ativo</label>}
      <Field label="Observações" className="sm:col-span-2"><textarea className="input" name="notes" rows={2} defaultValue={s?.notes ?? ""} /></Field>
    </ActionForm>
  );
}
