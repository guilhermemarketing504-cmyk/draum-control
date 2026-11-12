import Link from "next/link";
import { listCampaigns, listAmbassadors } from "@/server/marketing";
import { listPromotions } from "@/server/pricing";
import { listProducts } from "@/server/products";
import { crmMetrics } from "@/server/crm";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section, Empty, Badge, Tabs, Stat } from "@/components/ui";
import { Disclosure } from "@/components/forms";
import { CampaignForm, PromotionForm, AmbassadorForm } from "@/components/MarketingForms";
import { brl, pct, dateBR, dateTimeBR } from "@/lib/format";

export const metadata = { title: "Marketing e Campanhas" };

export default async function Marketing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const tab = sp.aba ?? "campanhas";
  const user = await requireSession();
  const [camps, ambs, promos, products, m] = await Promise.all([listCampaigns(), listAmbassadors(), listPromotions(), listProducts(), crmMetrics()]);
  const now = new Date();
  return (
    <>
      <PageHeader eyebrow="Aquisição" title="Marketing e Campanhas" description="Vendas só são atribuídas com rastreamento confiável: cupom, link rastreado ou registro explícito no pedido." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Leads" value={m.leads} hint={`${m.vip} no grupo VIP`} href="/clientes" />
        <Stat label="Compraram" value={m.buyers} hint={`conversão VIP ${pct(m.vipConversionPct)}`} />
        <Stat label="Receita atribuída a campanhas" value={brl(camps.reduce((a, c) => a + Number(c.revenue), 0))} />
        <Stat label="Receita via embaixadoras" value={brl(ambs.reduce((a, c) => a + Number(c.revenue), 0))} />
      </div>
      <Tabs current={tab} tabs={[{ key: "campanhas", label: "Campanhas", href: "/marketing" }, { key: "promocoes", label: "Promoções", href: "/marketing?aba=promocoes" }, { key: "embaixadoras", label: "Embaixadoras DRAUM", href: "/marketing?aba=embaixadoras" }]} />

      {tab === "campanhas" && (
        <>
          <div className="card overflow-x-auto mb-6">
            {camps.length === 0 ? <Empty title="Nenhuma campanha" /> : (
              <table className="table"><thead><tr><th>Campanha</th><th>Período</th><th>Canal</th><th className="text-right">Orçamento</th><th className="text-right">Investido</th><th className="text-right">Leads</th><th className="text-right">Pedidos</th><th className="text-right">Faturamento</th><th className="text-right">Conversão</th><th className="text-right">CAC</th><th className="text-right">Resultado est.</th><th>Status</th></tr></thead>
                <tbody>{camps.map((c) => (
                  <tr key={c.id}><td><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted max-w-xs">{c.objective}</div></td><td className="text-[12px]">{dateBR(c.starts_on)} – {dateBR(c.ends_on)}</td><td>{c.channel}</td>
                    <td className="text-right num">{brl(c.budget)}</td><td className="text-right num">{brl(c.spent)}</td><td className="text-right num">{c.leads}</td><td className="text-right num">{c.orders}</td><td className="text-right num">{brl(c.revenue)}</td>
                    <td className="text-right num">{c.conversion != null ? pct(c.conversion) : "—"}</td><td className="text-right num">{c.cac != null ? brl(c.cac) : "—"}</td><td className={`text-right num ${c.result < 0 ? "text-crit" : ""}`}>{brl(c.result)}</td>
                    <td><Badge value={c.status} /><Disclosure label="Editar" className="mt-2"><div className="w-[520px] card card-pad"><CampaignForm c={c} /></div></Disclosure></td></tr>))}
                </tbody></table>
            )}
          </div>
          <Section title="Nova campanha"><div className="card-pad max-w-2xl"><CampaignForm /></div></Section>
          <p className="text-[12px] text-muted mt-3">Resultado estimado = faturamento atribuído − custo das peças − investimento. CAC = investido ÷ clientes compradores atribuídos.</p>
        </>
      )}

      {tab === "promocoes" && (
        <>
          <div className="card overflow-x-auto mb-6">
            <table className="table"><thead><tr><th>Promoção</th><th className="text-right">%</th><th>Vigência</th><th>Regras</th><th>Produtos</th><th>Status</th><th></th></tr></thead>
              <tbody>{promos.map((p) => {
                const live = p.active && new Date(p.starts_at) <= now && new Date(p.ends_at) >= now;
                return (
                  <tr key={p.id}><td><div className="font-medium">{p.name}</div><div className="text-[12px] text-muted">{p.campaign_name}</div></td><td className="text-right num">{Number(p.pct)}%</td>
                    <td className="text-[12px]">{dateTimeBR(p.starts_at)}<br />{dateTimeBR(p.ends_at)}</td>
                    <td className="text-[12px]">{p.requires_vip ? "Só VIP · " : ""}{p.min_items > 1 ? `mín. ${p.min_items} peças · ` : ""}{p.coupon_code ? `cupom ${p.coupon_code}` : ""}</td>
                    <td className="text-[12px]">{p.all_products ? "Todos" : `${p.product_ids?.length ?? 0} selecionado(s)`}{!p.all_products && !p.product_ids?.length && <span className="chip-warn ml-1">selecione</span>}</td>
                    <td>{live ? <span className="chip-ok">vigente</span> : p.active ? <span className="chip-neutral">{new Date(p.starts_at) > now ? "agendada" : "encerrada"}</span> : <span className="chip-neutral">inativa</span>}</td>
                    <td>{user.role === "admin" && <Disclosure label="Editar"><div className="w-[560px] card card-pad"><PromotionForm p={p} products={products} campaigns={camps} /></div></Disclosure>}</td></tr>);
              })}</tbody></table>
          </div>
          <p className="text-[12.5px] text-espresso mb-4">Descontos não são cumulativos: cada pedido aceita uma única promoção, validada no servidor (vigência, produtos, mínimo de peças, VIP, cupom) e com checagem de margem mínima.</p>
          {user.role === "admin" && <Section title="Nova promoção"><div className="card-pad max-w-2xl"><PromotionForm products={products} campaigns={camps} /></div></Section>}
        </>
      )}

      {tab === "embaixadoras" && (
        <>
          <div className="card overflow-x-auto mb-6">
            {ambs.length === 0 ? <Empty title="Nenhuma embaixadora cadastrada" /> : (
              <table className="table"><thead><tr><th>Embaixadora</th><th>Status</th><th>Código</th><th className="text-right">Peças enviadas</th><th className="text-right">Custo das peças</th><th>Primeiro envio</th><th>Conteúdo</th><th className="text-right">Vendas</th><th className="text-right">Receita atribuída</th><th className="text-right">Receita/custo</th></tr></thead>
                <tbody>{ambs.map((a) => (
                  <tr key={a.id}><td><Link className="font-medium hover:underline" href={`/marketing/embaixadoras/${a.id}`}>{a.name}</Link>{a.instagram && <div className="text-[12px] text-muted">@{a.instagram}</div>}</td><td><Badge value={a.status} /></td><td className="font-mono text-[12px]">{a.referral_code ?? "—"}</td>
                    <td className="text-right num">{a.pieces_sent}</td><td className="text-right num">{brl(a.pieces_cost)}</td><td>{dateBR(a.first_sent)}</td><td className="text-[12px]">{a.content_done} entregue(s){a.content_agreed && <div className="text-muted">{a.content_agreed}</div>}</td>
                    <td className="text-right num">{a.sales}</td><td className="text-right num">{brl(a.revenue)}</td><td className="text-right num">{a.roi != null ? `${a.roi.toLocaleString("pt-BR")}×` : "—"}</td></tr>))}
                </tbody></table>
            )}
          </div>
          <Section title="Nova embaixadora"><div className="card-pad max-w-2xl"><AmbassadorForm /></div></Section>
        </>
      )}
    </>
  );
}
