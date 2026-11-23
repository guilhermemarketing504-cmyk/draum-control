import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/server/core";
import { listMftCosts, lastSyncRuns } from "@/server/mft";
import { priceFromCost, cutoffLabel, storeDeliveryDate } from "@/server/store";
import { q1 } from "@/lib/db";
import { PageHeader, Section, Stat, Alert, Tabs } from "@/components/ui";
import { ActionForm, Field } from "@/components/forms";
import { saveStoreSettingsAction, syncMftAction, saveMftCostsAction } from "@/app/actions/store";
import { CATEGORIES } from "@/server/products";
import { brl, dateTimeBR, dateBR, int } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loja online" };

export default async function LojaOnline({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const tab = sp.aba ?? "visao";
  const [s, runs, costs, counts] = await Promise.all([
    getSettings(), lastSyncRuns(8), listMftCosts(),
    q1<any>(`select
        (select count(*) from draum.orders where channel = 'loja') as orders,
        (select count(*) from draum.orders where channel = 'loja' and status = 'aguardando_pagamento') as waiting,
        (select count(*) from draum.products where source = 'proprio' and status = 'ativo' and store_visible) as own,
        (select count(*) from draum.products p where source = 'proprio' and status = 'ativo' and store_visible
           and not exists (select 1 from draum.product_images i where i.product_id = p.id) and p.image_url is null) as own_no_photo`),
  ]);
  const st = s.store;
  const last = runs[0];
  const missing = costs.filter((c) => !(Number(c.unit_cost) > 0) && c.status !== "pausado");
  const delivery = storeDeliveryDate(new Date(), s);

  return (
    <>
      <PageHeader eyebrow="Vendas" title="Loja online"
        description={`Pronta-entrega própria + catálogo sob encomenda da MFT. Corte: ${cutoffLabel(s)} → entrega na terça.`}
        actions={<Link href="/loja" target="_blank" className="btn-secondary">Abrir a loja ↗</Link>} />
      {!st.whatsapp && <div className="mb-6"><Alert tone="crit">Cadastre o WhatsApp que recebe os pedidos (aba Configuração). Sem ele, a loja não aceita pedidos.</Alert></div>}
      {missing.length > 0 && <div className="mb-6"><Alert>{missing.length} peça(s) da MFT sem custo. Elas ficam fora da loja até você informar o custo na aba Custos MFT.</Alert></div>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Stat label="Pedidos pela loja" value={int(counts.orders)} hint={`${int(counts.waiting)} aguardando pagamento`} href="/pedidos" tone={counts.waiting > 0 ? "warn" : undefined} />
        <Stat label="Próxima entrega" value={delivery ? dateBR(delivery) : "—"} hint={`pedidos até ${cutoffLabel(s)}`} />
        <Stat label="Pronta-entrega na loja" value={int(counts.own)} hint={counts.own_no_photo > 0 ? `${counts.own_no_photo} sem foto` : "produtos ativos"} href="/produtos" tone={counts.own_no_photo > 0 ? "warn" : undefined} />
        <Stat label="Catálogo MFT" value={int(costs.filter((c) => c.status === "ativo" && Number(c.unit_cost) > 0).length)}
          hint={last ? `atualizado ${dateTimeBR(last.finished_at ?? last.started_at)}` : "ainda não sincronizado"} tone={last?.status === "erro" ? "crit" : undefined} />
      </div>
      <Tabs current={tab} tabs={[
        { key: "visao", label: "Sincronização MFT", href: "/loja-online" },
        { key: "custos", label: `Custos MFT${missing.length ? ` (${missing.length} pendentes)` : ""}`, href: "/loja-online?aba=custos" },
        { key: "config", label: "Configuração", href: "/loja-online?aba=config" },
      ]} />

      {tab === "visao" && (
        <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
          <Section title="Últimas sincronizações">
            <table className="table">
              <thead><tr><th>Início</th><th>Status</th><th className="text-right">Peças lidas</th><th className="text-right">Novas</th><th className="text-right">Pausadas</th><th className="text-right">Sem custo</th><th>Observação</th></tr></thead>
              <tbody>
                {runs.length === 0 && <tr><td colSpan={7} className="text-muted">Nenhuma sincronização ainda.</td></tr>}
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="text-[12px]">{dateTimeBR(r.started_at)}</td>
                    <td>{r.status === "ok" ? <span className="chip-ok">ok</span> : r.status === "erro" ? <span className="chip-crit">erro</span> : <span className="chip-neutral">rodando</span>}</td>
                    <td className="text-right num">{r.products_seen}</td><td className="text-right num">{r.products_created}</td>
                    <td className="text-right num">{r.products_paused}</td><td className="text-right num">{r.without_cost}</td>
                    <td className="text-[11.5px] text-muted max-w-[320px] truncate" title={r.message ?? ""}>{r.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Robô da MFT">
            <div className="card-pad space-y-3 text-[12.5px] text-espresso">
              <p>O robô lê o site da MFT e atualiza peças, fotos, cores, tamanhos e o estoque da fábrica. Peças que saem do site da MFT são pausadas aqui e somem da loja.</p>
              <p>Ele roda sozinho a cada 3 horas. O preço de custo não é lido automaticamente porque o login da MFT tem verificação anti-robô; mantenha-o na aba <b>Custos MFT</b>.</p>
              <ActionForm action={syncMftAction} submitLabel="Sincronizar agora" submitClass="btn-primary" />
              <p className="text-[11.5px] text-muted">Leva de 4 a 6 minutos: o site da MFT limita o ritmo de acessos, então o robô lê uma página por vez.</p>
            </div>
          </Section>
        </div>
      )}

      {tab === "custos" && (
        <Section title={`Custos da MFT · preço = custo ÷ ${(1 - st.margin_pct / 100).toLocaleString("pt-BR")} (margem ${st.margin_pct}%)`}>
          <ActionForm action={saveMftCostsAction} submitLabel="Salvar custos e recalcular preços" className="">
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="table">
                <thead className="sticky top-0 bg-paper z-10"><tr><th>Peça</th><th>Categoria</th><th className="text-right">Estoque MFT</th><th className="w-[150px]">Custo (R$)</th><th className="text-right">Preço na loja</th><th></th></tr></thead>
                <tbody>
                  {costs.map((c) => (
                    <tr key={c.id} className={c.status === "pausado" ? "opacity-50" : ""}>
                      <td><Link href={`/produtos/${c.id}`} className="link">{c.name}</Link>{c.status === "pausado" && <span className="chip-neutral ml-2">fora da MFT</span>}</td>
                      <td className="text-[12px]">{CATEGORIES[c.category]?.label}</td>
                      <td className="text-right num">{int(c.supplier_stock)}</td>
                      <td><input className={`input h-8 num ${Number(c.unit_cost) > 0 ? "" : "border-warn"}`} name={`cost_${c.id}`} type="number" step="0.01" min="0" defaultValue={Number(c.unit_cost) > 0 ? Number(c.unit_cost) : ""} placeholder="—" /></td>
                      <td className="text-right num">{Number(c.unit_cost) > 0 ? brl(c.sale_price) : <span className="text-muted">fora da loja</span>}</td>
                      <td className="text-right">{c.external_url && <a href={c.external_url} target="_blank" rel="noreferrer" className="link text-[11.5px]">MFT ↗</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="card-pad text-[12px] text-muted border-t border-line">Use o preço cheio de revenda (sem promoções temporárias da MFT). Exemplo com a margem atual: custo R$ 100,00 → {brl(priceFromCost(100, st))}.</p>
          </ActionForm>
        </Section>
      )}

      {tab === "config" && (
        <Section title="Configuração da loja">
          <ActionForm action={saveStoreSettingsAction} submitLabel="Salvar" className="card-pad">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="WhatsApp que recebe os pedidos" hint="DDD + número"><input className="input" name="whatsapp" defaultValue={st.whatsapp} placeholder="91 9 0000-0000" /></Field>
              <Field label="Margem sobre o preço de venda (%)" hint="50% = custo × 2"><input className="input" name="margin_pct" type="number" step="1" min="0" max="90" defaultValue={st.margin_pct} /></Field>
              <Field label="Final do preço" hint="0,90 arredonda para cima em ,90. Use 0 para não arredondar."><input className="input" name="price_ending" type="number" step="0.01" min="0" max="0.99" defaultValue={st.price_ending} /></Field>
              <Field label="Prazo da MFT (dias)" hint="Usado na regra de prazo da pré-venda."><input className="input" name="mft_lead_days" type="number" min="0" max="30" defaultValue={st.mft_lead_days} /></Field>
            </div>
            <label className="flex items-center gap-2 mt-4 text-[13px]"><input type="checkbox" name="mft_enabled" defaultChecked={st.mft_enabled} className="accent-mineral" /> Mostrar o catálogo sob encomenda (MFT) na loja</label>
            <p className="text-[12px] text-muted mt-3">Mudar a margem ou o final do preço recalcula na hora todos os preços da MFT. O dia e a hora do corte ficam em Configurações → Pré-venda e entregas.</p>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
