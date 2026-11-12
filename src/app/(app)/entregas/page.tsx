import Link from "next/link";
import { nextTuesdays, routeCandidates, listRoutes, listZones, cutoffFor } from "@/server/delivery";
import { getSettings } from "@/server/core";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section, Empty, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/forms";
import { createRouteAction, addStopsAction } from "@/app/actions/delivery";
import { brl, dateBR, weekdayBR, dateTimeBR } from "@/lib/format";

export const metadata = { title: "Entregas" };

export default async function Entregas({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireSession();
  const tuesdays = nextTuesdays(6);
  const date = sp.data && tuesdays.includes(sp.data) ? sp.data : tuesdays[0];
  const [s, routes, zones, cands] = await Promise.all([getSettings(), listRoutes(), listZones(), routeCandidates(date)]);
  const dayRoutes = routes.filter((r) => r.route_date === date);
  const openRoute = dayRoutes.find((r) => r.status === "planejada");
  const eligible = cands.filter((c) => c.eligible);
  const byHood = new Map<string, any[]>();
  for (const c of eligible) { const k = c.neighborhood ?? "—"; byHood.set(k, [...(byHood.get(k) ?? []), c]); }
  return (
    <>
      <PageHeader eyebrow="Logística" title="DRAUM Delivery Day" description={`Entregas locais gratuitas às terças. Corte: pedidos de pronta-entrega pagos e conciliados até ${["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][s.delivery_cutoff.weekday]}, ${s.delivery_cutoff.hour}h. Pré-vendas entram após recebimento e conferência.`} />
      {zones.filter((z) => z.eligible).length === 0 && <div className="mb-6"><Alert>Nenhum bairro elegível configurado. {user.role === "admin" ? <Link className="link" href="/configuracoes?aba=entregas">Configure os bairros atendidos</Link> : "Peça a um administrador para configurar os bairros atendidos."}.</Alert></div>}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        {tuesdays.map((t) => {
          const rs = routes.filter((r) => r.route_date === t);
          return (
            <Link key={t} href={`/entregas?data=${t}`} className={`card p-4 hover:border-stone ${t === date ? "!border-mineral" : ""}`}>
              <div className="label">{t === tuesdays[0] ? "Próxima terça" : "Terça"}</div>
              <div className="font-display text-[20px] mt-1">{dateBR(t).slice(0, 5)}</div>
              <div className="text-[12px] text-muted mt-1">{rs.length ? `${rs.reduce((a, r) => a + Number(r.stops), 0)} entrega(s) · ${rs.length} rota(s)` : "sem rota"}</div>
              <div className="text-[11px] text-muted mt-1">corte {dateTimeBR(cutoffFor(t, s))}</div>
            </Link>
          );
        })}
      </div>
      <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6">
          <Section title={`Pedidos aptos para ${weekdayBR(date)} · agrupados por bairro`}>
            {eligible.length === 0 ? <Empty title="Nenhum pedido apto para esta terça">Pedidos aparecem aqui quando pagos e conciliados dentro do corte, com bairro elegível e itens disponíveis.</Empty> : (
              <ActionForm action={addStopsAction} submitLabel={openRoute ? "Adicionar à rota" : "Crie uma rota para esta terça"} submitClass={openRoute ? "btn-primary" : "btn-secondary"} className="card-pad">
                <input type="hidden" name="route_id" value={openRoute?.id ?? ""} />
                {[...byHood.entries()].map(([hood, list]) => (
                  <div key={hood} className="mb-4">
                    <div className="label mb-2">{hood} · {list.length}</div>
                    {list.map((c) => (
                      <label key={c.id} className="flex items-start gap-3 py-2 border-b border-line/70 text-[13px]">
                        <input type="checkbox" name="orders[]" value={c.id} defaultChecked disabled={!openRoute} className="mt-1" />
                        <span className="flex-1"><span className="font-mono text-[12px]">{c.number}</span> · {c.customer_name}<div className="text-[12px] text-muted">{c.address}</div>
                          <div className="text-[12px]">{c.readyItems.map((i: any) => `${i.sku} × ${i.qty}`).join(", ")}{c.partial && <span className="chip-warn ml-2">entrega parcial</span>}</div></span>
                      </label>))}
                  </div>
                ))}
              </ActionForm>
            )}
          </Section>
          <Section title="Pedidos de entrega local que não entram nesta terça">
            {cands.filter((c) => !c.eligible).length === 0 ? <p className="card-pad text-muted text-[13px]">Nenhum.</p> : (
              <table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Bairro</th><th>Motivo</th></tr></thead>
                <tbody>{cands.filter((c) => !c.eligible).map((c) => <tr key={c.id}><td><Link className="font-mono text-[12px] link" href={`/pedidos/${c.id}`}>{c.number}</Link></td><td>{c.customer_name}</td><td>{c.neighborhood ?? "—"}</td><td className="text-[12.5px] text-warn">{c.reasons.join("; ")}</td></tr>)}</tbody></table>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title={`Rotas de ${dateBR(date)}`}>
            {dayRoutes.length === 0 ? <p className="card-pad text-muted text-[13px]">Nenhuma rota criada.</p> : (
              <ul className="divide-y divide-line">{dayRoutes.map((r) => <li key={r.id} className="px-5 py-3 flex justify-between items-center text-[13px]"><Link className="link" href={`/entregas/${r.id}`}>{r.driver ?? "Rota"} · {r.stops}/{r.capacity}</Link><Badge value={r.status} /></li>)}</ul>
            )}
            <div className="card-pad border-t border-line">
              <ActionForm action={createRouteAction} submitLabel="Criar rota" submitClass="btn-secondary btn-sm" className="grid grid-cols-2 gap-3">
                <input type="hidden" name="route_date" value={date} />
                <Field label="Motorista/entregador"><input className="input" name="driver" /></Field>
                <Field label="Capacidade"><input className="input" name="capacity" type="number" min="1" defaultValue={s.route_capacity_default} /></Field>
              </ActionForm>
            </div>
          </Section>
          <Section title="Histórico de rotas">
            {routes.length === 0 ? <p className="card-pad text-muted text-[13px]">Sem rotas.</p> : (
              <ul className="divide-y divide-line">{routes.slice(0, 12).map((r) => <li key={r.id} className="px-5 py-2.5 flex justify-between text-[12.5px]"><Link className="link" href={`/entregas/${r.id}`}>{dateBR(r.route_date)} · {r.driver ?? "—"}</Link><span className="text-muted">{r.delivered}/{r.stops} · {r.actual_cost != null ? brl(r.actual_cost) : <Badge value={r.status} />}</span></li>)}</ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
