"use client";
import { ActionForm, Field } from "./forms";
import { saveCustomerAction } from "@/app/actions/crm";

const SOURCES: [string, string][] = [["instagram", "Instagram"], ["indicacao", "Indicação"], ["whatsapp", "WhatsApp"], ["embaixadora", "Embaixadora"], ["evento", "Evento"], ["site", "Site"], ["outro", "Outro"]];

export function CustomerForm({ c, campaigns, ambassadors }: { c?: any; campaigns: any[]; ambassadors: any[] }) {
  return (
    <ActionForm action={saveCustomerAction} submitLabel={c ? "Salvar" : "Cadastrar"} reset={!c} redirectTo={c ? undefined : (d) => `/clientes/${d.id}`} className="grid sm:grid-cols-2 gap-3">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="Nome" className="sm:col-span-2"><input className="input" name="name" defaultValue={c?.name} required /></Field>
      <Field label="WhatsApp (DDD + número)"><input className="input" name="whatsapp" defaultValue={c?.whatsapp ?? ""} placeholder="91 98888-7777" /></Field>
      <Field label="Instagram"><input className="input" name="instagram" defaultValue={c?.instagram ?? ""} placeholder="@perfil" /></Field>
      <Field label="E-mail"><input className="input" name="email" type="email" defaultValue={c?.email ?? ""} /></Field>
      <Field label="Cidade"><input className="input" name="city" defaultValue={c?.city ?? "Belém"} /></Field>
      <Field label="Bairro"><input className="input" name="neighborhood" defaultValue={c?.neighborhood ?? ""} /></Field>
      <Field label="Endereço de entrega"><input className="input" name="address" defaultValue={c?.address ?? ""} /></Field>
      <Field label="Preferência de produtos"><input className="input" name="product_prefs" defaultValue={c?.product_prefs ?? ""} placeholder="macaquinhos, tons escuros" /></Field>
      <Field label="Tamanhos de interesse"><input className="input" name="sizes" defaultValue={c?.sizes ?? ""} placeholder="M, G" /></Field>
      <Field label="Origem do lead"><select className="input" name="lead_source" defaultValue={c?.lead_source ?? ""}><option value="">—</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Entrada no grupo VIP" hint="Preencha quando a pessoa entrar no DRAUM PRIVATE ACCESS."><input className="input" name="vip_joined_at" type="date" defaultValue={c?.vip_joined_at ?? ""} /></Field>
      <Field label="Campanha de origem"><select className="input" name="campaign_id" defaultValue={c?.campaign_id ?? ""}><option value="">—</option>{campaigns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Indicada por embaixadora"><select className="input" name="ambassador_id" defaultValue={c?.ambassador_id ?? ""}><option value="">—</option>{ambassadors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <fieldset className="sm:col-span-2 border border-line rounded p-3 space-y-2">
        <legend className="label px-1">Consentimentos (LGPD)</legend>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="consent_whatsapp" defaultChecked={c?.consent_whatsapp} /> Autoriza receber mensagens da DRAUM pelo WhatsApp</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="consent_email" defaultChecked={c?.consent_email} /> Autoriza receber e-mails</label>
        <input className="input" name="consent_source" defaultValue={c?.consent_source ?? ""} placeholder="Como a autorização foi dada (ex.: mensagem no WhatsApp em 10/11)" />
      </fieldset>
      <Field label="Observações" className="sm:col-span-2"><textarea className="input" name="notes" rows={2} defaultValue={c?.notes ?? ""} /></Field>
    </ActionForm>
  );
}
