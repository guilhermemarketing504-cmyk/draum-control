"use client";
import { ActionForm, Field } from "./forms";
import { saveCampaignAction, savePromotionAction, saveAmbassadorAction } from "@/app/actions/marketing";

const local = (d?: string | Date | null) => {
  if (!d) return "";
  const x = new Date(new Date(d).getTime() - 3 * 3600e3); // horário de Belém (UTC−3)
  return x.toISOString().slice(0, 16);
};

export function CampaignForm({ c }: { c?: any }) {
  return (
    <ActionForm action={saveCampaignAction} submitLabel={c ? "Salvar" : "Criar campanha"} reset={!c} className="grid sm:grid-cols-2 gap-3">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="Nome" className="sm:col-span-2"><input className="input" name="name" defaultValue={c?.name} required /></Field>
      <Field label="Canal"><input className="input" name="channel" defaultValue={c?.channel ?? ""} /></Field>
      <Field label="Status"><select className="input" name="status" defaultValue={c?.status ?? "planejada"}><option value="planejada">Planejada</option><option value="ativa">Ativa</option><option value="encerrada">Encerrada</option></select></Field>
      <Field label="Início"><input className="input" type="date" name="starts_on" defaultValue={c?.starts_on ?? ""} /></Field>
      <Field label="Término"><input className="input" type="date" name="ends_on" defaultValue={c?.ends_on ?? ""} /></Field>
      <Field label="Orçamento (R$)"><input className="input" type="number" step="0.01" min="0" name="budget" defaultValue={c?.budget ?? 0} /></Field>
      <Field label="Investido até agora (R$)"><input className="input" type="number" step="0.01" min="0" name="spent" defaultValue={c?.spent ?? 0} /></Field>
      <Field label="Objetivo" className="sm:col-span-2"><input className="input" name="objective" defaultValue={c?.objective ?? ""} /></Field>
    </ActionForm>
  );
}

export function PromotionForm({ p, products, campaigns }: { p?: any; products: any[]; campaigns: any[] }) {
  const sel = new Set((p?.product_ids ?? []).map(Number));
  return (
    <ActionForm action={savePromotionAction} submitLabel={p ? "Salvar" : "Criar promoção"} reset={!p} className="grid sm:grid-cols-2 gap-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Nome" className="sm:col-span-2"><input className="input" name="name" defaultValue={p?.name} required /></Field>
      <Field label="Tipo"><select className="input" name="kind" defaultValue={p?.kind ?? "outra"}><option value="vip">Pré-lançamento VIP</option><option value="duas_pecas">Duas peças</option><option value="black_friday">Black Friday</option><option value="cupom">Cupom</option><option value="outra">Outra</option></select></Field>
      <Field label="Desconto (%)"><input className="input" type="number" step="0.01" min="0.01" max="99" name="pct" defaultValue={p?.pct} required /></Field>
      <Field label="Início"><input className="input" type="datetime-local" name="starts_at" defaultValue={local(p?.starts_at)} required /></Field>
      <Field label="Término"><input className="input" type="datetime-local" name="ends_at" defaultValue={local(p?.ends_at)} required /></Field>
      <Field label="Mínimo de peças"><input className="input" type="number" min="1" name="min_items" defaultValue={p?.min_items ?? 1} /></Field>
      <Field label="Cupom (opcional)"><input className="input uppercase" name="coupon_code" defaultValue={p?.coupon_code ?? ""} /></Field>
      <Field label="Campanha"><select className="input" name="campaign_id" defaultValue={p?.campaign_id ?? ""}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <div className="flex flex-col gap-2 text-[13px] justify-end">
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Ativa</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="requires_vip" defaultChecked={p?.requires_vip} /> Exclusiva para membros VIP</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="all_products" defaultChecked={p?.all_products ?? true} /> Todos os produtos</label>
      </div>
      <Field label="Produtos elegíveis (se não for para todos)" className="sm:col-span-2">
        <div className="max-h-40 overflow-auto border border-line rounded p-2 grid sm:grid-cols-2 gap-1">
          {products.length === 0 ? <span className="text-muted text-[12px]">Nenhum produto cadastrado.</span> : products.map((x) => <label key={x.id} className="flex gap-2 text-[12.5px]"><input type="checkbox" name="product_ids[]" value={x.id} defaultChecked={sel.has(x.id)} />{x.name}</label>)}
        </div>
      </Field>
    </ActionForm>
  );
}

export function AmbassadorForm({ a }: { a?: any }) {
  return (
    <ActionForm action={saveAmbassadorAction} submitLabel={a ? "Salvar" : "Cadastrar embaixadora"} reset={!a} className="grid sm:grid-cols-2 gap-3">
      {a && <input type="hidden" name="id" value={a.id} />}
      <Field label="Nome"><input className="input" name="name" defaultValue={a?.name} required /></Field>
      <Field label="Instagram"><input className="input" name="instagram" defaultValue={a?.instagram ?? ""} /></Field>
      <Field label="Status"><select className="input" name="status" defaultValue={a?.status ?? "prospeccao"}><option value="prospeccao">Prospecção</option><option value="ativa">Ativa</option><option value="pausada">Pausada</option><option value="encerrada">Encerrada</option></select></Field>
      <Field label="Código de indicação" hint="Usado como cupom no pedido para atribuição confiável."><input className="input uppercase" name="referral_code" defaultValue={a?.referral_code ?? ""} /></Field>
      <Field label="Entregas de conteúdo combinadas" className="sm:col-span-2"><input className="input" name="content_agreed" defaultValue={a?.content_agreed ?? ""} placeholder="2 reels + 3 stories por mês" /></Field>
      <Field label="Observações" className="sm:col-span-2"><input className="input" name="notes" defaultValue={a?.notes ?? ""} /></Field>
    </ActionForm>
  );
}
