import Link from "next/link";
import { listOrders, ORDER_STATUS, FIN_STATUS } from "@/server/orders";
import { PageHeader, Empty, Badge, FilterBar, Tabs } from "@/components/ui";
import { brl, dateBR } from "@/lib/format";

export const metadata = { title: "Pedidos" };
const KANBAN = ["aguardando_pagamento", "pago", "em_andamento", "entregue_parcial", "entregue", "finalizado"];

export default async function Pedidos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const view = sp.ver === "kanban" ? "kanban" : "lista";
  const rows = await listOrders({ search: sp.q, status: sp.status, financial: sp.fin, mode: sp.modo, from: sp.de, to: sp.ate });
  const qs = (v: string) => `/pedidos?${new URLSearchParams({ ...sp, ver: v }).toString()}`;
  const modeLabel = (m: string) => (m?.includes(",") ? "Misto" : m === "pre" ? "Pré-venda" : "Pronta");
  return (
    <>
      <PageHeader eyebrow="Vendas" title="Pedidos" actions={<Link className="btn-primary" href="/pedidos/novo">Novo pedido</Link>} />
      <Tabs current={view} tabs={[{ key: "lista", label: "Lista", href: qs("lista") }, { key: "kanban", label: "Kanban", href: qs("kanban") }]} />
      <FilterBar>
        <input type="hidden" name="ver" value={view} />
        <input className="input w-56" name="q" placeholder="Número, cliente ou WhatsApp" defaultValue={sp.q} />
        <select className="input w-44" name="status" defaultValue={sp.status ?? ""}><option value="">Todos os status</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-44" name="fin" defaultValue={sp.fin ?? ""}><option value="">Financeiro: todos</option>{Object.entries(FIN_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-36" name="modo" defaultValue={sp.modo ?? ""}><option value="">Modalidade</option><option value="pronta">Pronta</option><option value="pre">Com pré-venda</option><option value="misto">Misto</option></select>
        <input className="input w-36" type="date" name="de" defaultValue={sp.de} aria-label="De" />
        <input className="input w-36" type="date" name="ate" defaultValue={sp.ate} aria-label="Até" />
      </FilterBar>
      {rows.length === 0 ? <div className="card"><Empty title="Nenhum pedido encontrado" action={<Link className="btn-primary" href="/pedidos/novo">Registrar pedido</Link>} /></div>
        : view === "lista" ? (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Modalidade</th><th className="text-right">Peças</th><th className="text-right">Total</th><th className="text-right">Recebido</th><th>Financeiro</th><th>Logística</th><th>Prazo</th></tr></thead>
              <tbody>{rows.map((o) => (
                <tr key={o.id}>
                  <td><Link className="font-medium hover:underline font-mono text-[12.5px]" href={`/pedidos/${o.id}`}>{o.number}</Link></td>
                  <td>{dateBR(o.created_at)}</td><td>{o.customer_name}</td><td>{modeLabel(o.modes)}</td>
                  <td className="text-right num">{o.pieces ?? 0}</td><td className="text-right num">{brl(o.total)}</td><td className="text-right num">{brl(o.paid_amount)}</td>
                  <td><Badge value={o.financial_status} label={FIN_STATUS[o.financial_status]?.split(" (")[0]} /></td>
                  <td><Badge value={o.status} label={ORDER_STATUS[o.status]} /></td><td>{dateBR(o.promised_date)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {KANBAN.map((st) => {
              const col = rows.filter((o) => o.status === st);
              return (
                <div key={st} className="w-64 shrink-0">
                  <div className="flex justify-between items-center mb-2"><span className="label">{ORDER_STATUS[st]}</span><span className="label">{col.length}</span></div>
                  <div className="space-y-2">{col.map((o) => (
                    <Link key={o.id} href={`/pedidos/${o.id}`} className="card p-3 block hover:border-stone">
                      <div className="flex justify-between"><span className="font-mono text-[12px]">{o.number}</span><span className="num text-[12.5px]">{brl(o.total)}</span></div>
                      <div className="text-[13px] mt-1">{o.customer_name}</div>
                      <div className="flex gap-1.5 mt-2 flex-wrap"><span className="chip-neutral">{modeLabel(o.modes)}</span>{o.financial_status !== "pago" && <Badge value={o.financial_status} label={FIN_STATUS[o.financial_status]?.split(" (")[0]} />}</div>
                    </Link>))}
                    {col.length === 0 && <div className="border border-dashed border-line rounded p-4 text-center text-[12px] text-muted">vazio</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}
