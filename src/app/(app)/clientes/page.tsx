import Link from "next/link";
import { listCustomers, crmMetrics, LEAD_SOURCES } from "@/server/crm";
import { listCampaigns, listAmbassadors } from "@/server/marketing";
import { FUNNEL, stageLabel } from "@/server/funnel";
import { PageHeader, Section, Empty, Stat, FilterBar, Badge } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
import { Disclosure } from "@/components/forms";
import { brl, int, pct, dateBR, waLink } from "@/lib/format";

export const metadata = { title: "Clientes e Grupo VIP" };

export default async function Clientes({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [rows, m, campaigns, ambassadors] = await Promise.all([
    listCustomers({ search: sp.q, stage: sp.etapa, source: sp.origem, vip: sp.vip, buyers: sp.compra }), crmMetrics(), listCampaigns(), listAmbassadors(),
  ]);
  const max = Math.max(1, ...m.funnel.map((f: any) => f.reached));
  return (
    <>
      <PageHeader eyebrow="CRM" title="Clientes e Grupo VIP" description="DRAUM PRIVATE ACCESS: cadastro manual ou por CSV autorizado. O sistema não acessa participantes do grupo do WhatsApp automaticamente."
        actions={<Link className="btn-secondary" href="/clientes/importar">Importar CSV</Link>} />
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-3 mb-6">
        <Stat label="Leads" value={int(m.leads)} />
        <Stat label="Membros VIP" value={int(m.vip)} hint="meta: 150" />
        <Stat label="Compraram" value={int(m.buyers)} />
        <Stat label="Sem compra" value={int(m.nonBuyers)} />
        <Stat label="Recorrentes" value={int(m.recurring)} />
        <Stat label="Conversão VIP" value={pct(m.vipConversionPct)} hint="VIP que compraram" />
        <Stat label="Valor do grupo VIP" value={brl(m.vipValue)} hint="pedidos pagos" />
      </div>
      <div className="grid xl:grid-cols-[1fr_360px] gap-6 mb-6 items-start">
        <Section title="Funil comercial — clientes que alcançaram cada etapa">
          <div className="card-pad space-y-2.5">
            {m.funnel.map((f: any, i: number) => {
              const prev = i ? m.funnel[i - 1].reached : null;
              return (
                <Link key={f.key} href={`/clientes?etapa=${f.key}`} className="grid grid-cols-[150px_1fr_110px] items-center gap-3 group">
                  <span className="text-[12.5px] group-hover:underline">{f.label}</span>
                  <span className="h-5 bg-offwhite rounded-sm relative"><span className="absolute inset-y-0 left-0 bg-espresso rounded-sm" style={{ width: `${(f.reached / max) * 100}%` }} /></span>
                  <span className="text-[12px] num text-right">{f.reached} {prev ? <span className="text-muted">· {pct((f.reached / prev) * 100, 0)}</span> : null}</span>
                </Link>
              );
            })}
            {m.leads === 0 && <p className="text-muted text-[12.5px] pt-2">O funil se preenche conforme os leads são cadastrados e os pedidos acontecem.</p>}
          </div>
        </Section>
        <Section title="Leads por origem">
          <div className="card-pad">
            {m.bySource.length === 0 ? <p className="text-muted text-[13px]">Sem dados ainda.</p> : (
              <ul className="space-y-2 text-[13px]">{m.bySource.map((s: any) => <li key={s.source} className="flex justify-between"><span>{LEAD_SOURCES[s.source] ?? "Não informada"}</span><span className="num">{s.n}</span></li>)}</ul>
            )}
          </div>
        </Section>
      </div>
      <FilterBar>
        <input className="input w-56" name="q" placeholder="Nome, WhatsApp, @ ou e-mail" defaultValue={sp.q} />
        <select className="input w-44" name="etapa" defaultValue={sp.etapa ?? ""}><option value="">Todas as etapas</option>{FUNNEL.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
        <select className="input w-36" name="origem" defaultValue={sp.origem ?? ""}><option value="">Toda origem</option>{Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-32" name="vip" defaultValue={sp.vip ?? ""}><option value="">VIP: todos</option><option value="sim">Só VIP</option><option value="nao">Fora do VIP</option></select>
        <select className="input w-40" name="compra" defaultValue={sp.compra ?? ""}><option value="">Compras: todos</option><option value="sim">Compraram</option><option value="nao">Sem compra</option><option value="recorrentes">Recorrentes</option></select>
      </FilterBar>
      <div className="mb-4"><Disclosure label="Novo cliente / lead"><div className="card card-pad max-w-3xl"><CustomerForm campaigns={campaigns} ambassadors={ambassadors} /></div></Disclosure></div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty title="Nenhum cliente encontrado">Cadastre leads do DRAUM PRIVATE ACCESS para acompanhar a conversão.</Empty> : (
          <table className="table">
            <thead><tr><th>Cliente</th><th>Contato</th><th>Bairro</th><th>Origem</th><th>VIP desde</th><th>Etapa</th><th className="text-right">Pedidos</th><th className="text-right">Total comprado</th><th>Consentimento</th><th>Último contato</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td><Link className="font-medium hover:underline" href={`/clientes/${c.id}`}>{c.name}</Link>{c.sizes && <div className="text-[11.5px] text-muted">Tam. {c.sizes}</div>}</td>
                <td className="text-[12.5px]">{c.whatsapp && c.consent_whatsapp ? <a className="link" target="_blank" href={waLink(c.whatsapp)!}>WhatsApp</a> : c.whatsapp ? <span className="text-muted">WhatsApp (sem consentimento)</span> : null}{c.instagram && <div className="text-muted">@{c.instagram}</div>}</td>
                <td>{c.neighborhood ?? "—"}</td><td>{LEAD_SOURCES[c.lead_source] ?? "—"}</td><td>{dateBR(c.vip_joined_at)}</td>
                <td><Badge value="x" label={stageLabel(c.funnel_stage)} /></td>
                <td className="text-right num">{c.orders}</td><td className="text-right num">{brl(c.spent)}</td>
                <td className="text-[12px]">{c.consent_whatsapp ? "WhatsApp" : ""}{c.consent_email ? (c.consent_whatsapp ? " · " : "") + "E-mail" : ""}{!c.consent_whatsapp && !c.consent_email ? <span className="text-muted">nenhum</span> : null}</td>
                <td className="text-[12px]">{dateBR(c.last_contact_at)}</td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
