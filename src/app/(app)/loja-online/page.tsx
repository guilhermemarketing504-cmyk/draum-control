import Link from "next/link";
import { headers } from "next/headers";
import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/server/core";
import { listMftCosts, lastSyncRuns, getImportToken } from "@/server/mft";
import { priceFromCost, cutoffLabel, storeDeliveryDate } from "@/server/store";
import { q1 } from "@/lib/db";
import { PageHeader, Section, Stat, Alert, Tabs } from "@/components/ui";
import { ActionForm, Field } from "@/components/forms";
import { saveStoreSettingsAction, saveMftCostsAction } from "@/app/actions/store";
import { CATEGORIES } from "@/server/products";
import { brl, dateTimeBR, dateBR, int } from "@/lib/format";
import { noticeQueue, orderMessage, vipWelcomeMessage, groupInviteMessage } from "@/server/notices";
import { WhatsappButton } from "@/components/WhatsappButton";
import { ORDER_STATUS } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loja online" };

export default async function LojaOnline({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const tab = sp.aba ?? "visao";
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [s, runs, costs, counts, token] = await Promise.all([
    getSettings(), lastSyncRuns(8), listMftCosts(),
    q1<any>(`select
        (select count(*) from draum.orders where channel = 'loja') as orders,
        (select count(*) from draum.orders where channel = 'loja' and status = 'aguardando_pagamento') as waiting,
        (select count(*) from draum.customers where lead_source = 'site') as leads,
        (select count(*) from draum.customers where lead_source = 'site' and consent_whatsapp) as leads_ok,
        (select count(*) from draum.customers where consent_source = 'acesso antecipado VIP (loja)') as vip_leads,
        (select count(*) from draum.products where source = 'proprio' and status = 'ativo' and store_visible) as own,
        (select count(*) from draum.products p where source = 'proprio' and status = 'ativo' and store_visible
           and not exists (select 1 from draum.product_images i where i.product_id = p.id) and p.image_url is null) as own_no_photo`),
    getImportToken(),
  ]);
  const bookmarklet = `javascript:(function(){window.__DRAUM={endpoint:'${base}/api/mft/import',token:'${token}'};var s=document.createElement('script');s.src='${base}/api/mft/import.js?v='+Date.now();document.body.appendChild(s);})();`;
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
        { key: "visao", label: "Atualizar MFT", href: "/loja-online" },
        { key: "custos", label: `Custos MFT${missing.length ? ` (${missing.length} pendentes)` : ""}`, href: "/loja-online?aba=custos" },
        { key: "mensagens", label: "Mensagens WhatsApp", href: "/loja-online?aba=mensagens" },
        { key: "config", label: "Configuração", href: "/loja-online?aba=config" },
      ]} />

      {tab === "mensagens" && <Mensagens base={base} />}

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
          <Section title="Atualizar o catálogo da MFT">
            <div className="card-pad space-y-3 text-[12.5px] text-espresso">
              <p>A leitura roda no seu navegador, dentro do site da MFT e já logado como revendedor. Ela atualiza peças, fotos, cores, tamanhos, o estoque da fábrica <b>e o custo</b>. Peças que saíram da MFT são pausadas e somem da loja.</p>
              <div className="label pt-1">Uma vez só: instale o favorito</div>
              <p>Arraste o botão abaixo para a barra de favoritos do navegador (Ctrl+Shift+B mostra a barra).</p>
              <div dangerouslySetInnerHTML={{ __html: `<a href="${bookmarklet.replace(/"/g, "&quot;")}" class="btn-primary" style="cursor:grab" onclick="alert('Arraste este botão para a barra de favoritos. Depois, clique nele estando no site da MFT.');return false;">DRAUM · Atualizar MFT</a>` }} />
              <div className="label pt-2">Para atualizar</div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Entre no site da MFT com o login de revendedor.</li>
                <li>Clique no favorito <b>DRAUM · Atualizar MFT</b>.</li>
                <li>Espere o aviso "Pronto!" no canto da tela (5 a 8 minutos, deixe a aba aberta).</li>
              </ol>
              <p className="text-[11.5px] text-muted">Faça isso pelo menos uma vez por dia, e sempre antes do corte de sexta. O favorito contém uma chave de acesso: não compartilhe.</p>
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

      {tab === "visao" && (
        <div className="mt-6">
          <Section title="Black Friday e contatos para remarketing">
            <div className="card-pad grid lg:grid-cols-2 gap-6 text-[12.5px] text-espresso">
              <div className="space-y-2">
                <div className="label">Link do acesso antecipado (grupo VIP)</div>
                {st.vip_code ? <>
                  <div className="font-mono text-[12px] bg-offwhite border border-line px-3 py-2 break-all select-all">{base}/loja/vip/{st.vip_code}</div>
                  <p>Envie no grupo DRAUM PRIVATE ACCESS. Quem abre o link confirma nome, WhatsApp e e-mail e vê os preços VIP no celular. Os descontos e as datas ficam em Marketing → Promoções.</p>
                </> : <p className="text-muted">Código VIP ainda não gerado.</p>}
              </div>
              <div className="space-y-2">
                <div className="label">Contatos captados pela loja</div>
                <p><b className="num">{int(counts.leads)}</b> pessoas cadastradas pelo site, <b className="num">{int(counts.leads_ok)}</b> com autorização para receber ofertas, <b className="num">{int(counts.vip_leads)}</b> pelo link VIP.</p>
                <p>Ficam em <Link href="/clientes?origem=site" className="link">Clientes</Link>, com WhatsApp, e-mail e a data do consentimento. Para campanhas, use só quem autorizou.</p>
              </div>
            </div>
          </Section>
        </div>
      )}

      {tab === "config" && (
        <Section title="Configuração da loja">
          <ActionForm action={saveStoreSettingsAction} submitLabel="Salvar" className="card-pad">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="WhatsApp que recebe os pedidos" hint="DDD + número"><input className="input" name="whatsapp" defaultValue={st.whatsapp} placeholder="91 9 0000-0000" /></Field>
              <Field label="Margem sobre o preço de venda (%)" hint="50% = custo × 2"><input className="input" name="margin_pct" type="number" step="1" min="0" max="90" defaultValue={st.margin_pct} /></Field>
              <Field label="Final do preço" hint="0,90 arredonda para cima em ,90. Use 0 para não arredondar."><input className="input" name="price_ending" type="number" step="0.01" min="0" max="0.99" defaultValue={st.price_ending} /></Field>
              <Field label="Prazo da MFT (dias)" hint="Usado na regra de prazo da pré-venda."><input className="input" name="mft_lead_days" type="number" min="0" max="30" defaultValue={st.mft_lead_days} /></Field>
              <Field label="InfiniteTag (pagamento na loja)" hint="Sem o $. Vazio = pagamento só pelo WhatsApp."><input className="input" name="infinitepay_handle" defaultValue={st.infinitepay_handle ?? ""} placeholder="sualoja" /></Field>
            </div>
            <label className="flex items-center gap-2 mt-4 text-[13px]"><input type="checkbox" name="mft_enabled" defaultChecked={st.mft_enabled} className="accent-mineral" /> Mostrar o catálogo sob encomenda (MFT) na loja</label>
            <p className="text-[12px] text-muted mt-3">Mudar a margem ou o final do preço recalcula na hora todos os preços da MFT. O dia e a hora do corte ficam em Configurações → Pré-venda e entregas.</p>
          </ActionForm>
        </Section>
      )}
    </>
  );
}

async function Mensagens({ base }: { base: string }) {
  const { orders, vips, leads } = await noticeQueue();
  const pendOrders = orders.filter((o) => !o.sent_at).length, pendVips = vips.filter((v) => !v.sent_at).length, pendLeads = leads.filter((l) => !l.sent_at).length;
  const welcome = await Promise.all(vips.map((v) => vipWelcomeMessage(v.name, base)));
  const invites = await Promise.all(leads.map((l) => groupInviteMessage(l.name)));
  return (
    <div className="mt-6 space-y-6">
      <Alert>Cada botão abre o WhatsApp da cliente com a mensagem já escrita. Confira e aperte enviar. O CONTROL marca quem já recebeu.</Alert>
      <Section title={`Pedidos da loja${pendOrders ? ` · ${pendOrders} sem aviso` : ""}`}>
        {orders.length === 0 ? <div className="card-pad text-muted text-[13px]">Nenhum pedido pela loja nos últimos 21 dias.</div> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Peças</th><th className="text-right">Total</th><th>Status</th><th>Mensagem</th></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}>
                <td><Link className="link font-mono text-[12px]" href={`/pedidos/${o.id}`}>{o.number}</Link><div className="text-[11.5px] text-muted">{dateTimeBR(o.created_at)}</div></td>
                <td>{o.customer_name}</td>
                <td className="text-[12px]">{o.items.map((i: any) => `${i.qty > 1 ? `${i.qty}x ` : ""}${i.product_name} ${i.size}`).join(", ")}</td>
                <td className="text-right num">{brl(o.total)}</td>
                <td className="text-[12px]">{ORDER_STATUS[o.status] ?? o.status}</td>
                <td><WhatsappButton small phone={o.whatsapp} refId={o.id} sentAt={o.sent_at ? new Date(o.sent_at).toISOString() : null}
                  kind={o.status === "aguardando_pagamento" ? "pedido_pendente" : "pedido_confirmado"}
                  label={o.status === "aguardando_pagamento" ? "Lembrar pagamento" : "Confirmar pedido"}
                  text={orderMessage(o, o.items)} /></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Section>
      <Section title={`Novos no DRAUM Private Access${pendVips ? ` · ${pendVips} sem boas-vindas` : ""}`}>
        {vips.length === 0 ? <div className="card-pad text-muted text-[13px]">Ninguém entrou pelo link do grupo ainda.</div> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Nome</th><th>WhatsApp</th><th>Entrou em</th><th>Mensagem</th></tr></thead>
            <tbody>{vips.map((v, i) => (
              <tr key={v.id}>
                <td><Link className="link" href={`/clientes/${v.id}`}>{v.name}</Link></td>
                <td className="num text-[12px]">{v.whatsapp}</td>
                <td className="text-[12px]">{dateBR(v.vip_joined_at ?? v.created_at)}</td>
                <td><WhatsappButton small phone={v.whatsapp} refId={v.id} kind="boas_vindas_vip" label="Dar boas-vindas"
                  sentAt={v.sent_at ? new Date(v.sent_at).toISOString() : null} text={welcome[i]} /></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Section>
      <Section title={`Cadastros pelo site, fora do grupo${pendLeads ? ` · ${pendLeads} sem convite` : ""}`}>
        {leads.length === 0 ? <div className="card-pad text-muted text-[13px]">Ninguém se cadastrou em "Seja a primeira a saber" ainda.</div> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>Nome</th><th>WhatsApp</th><th>Cadastro</th><th>Mensagem</th></tr></thead>
            <tbody>{leads.map((l, i) => (
              <tr key={l.id}>
                <td><Link className="link" href={`/clientes/${l.id}`}>{l.name}</Link></td>
                <td className="num text-[12px]">{l.whatsapp}</td>
                <td className="text-[12px]">{dateBR(l.created_at)}</td>
                <td><WhatsappButton small phone={l.whatsapp} refId={l.id} kind="convite_grupo" label="Convidar pro grupo"
                  sentAt={l.sent_at ? new Date(l.sent_at).toISOString() : null} text={invites[i]} /></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}
