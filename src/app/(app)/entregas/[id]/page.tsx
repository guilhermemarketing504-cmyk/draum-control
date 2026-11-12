import Link from "next/link";
import { notFound } from "next/navigation";
import { getRoute } from "@/server/delivery";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section, Badge, Empty, KV } from "@/components/ui";
import { ActionForm, ActionButton, Field } from "@/components/forms";
import { startRouteAction, completeStopAction, closeRouteAction, updateStopAction, removeStopAction } from "@/app/actions/delivery";
import { brl, weekdayBR, dateTimeBR, waLink } from "@/lib/format";

export default async function Rota({ params }: { params: Promise<{ id: string }> }) {
  const [d, user] = await Promise.all([getRoute(Number((await params).id)), requireSession()]);
  if (!d) notFound();
  const { route: r, stops } = d;
  return (
    <>
      <PageHeader eyebrow="Delivery Day · Rota" title={weekdayBR(r.route_date)} description={`${r.driver ?? "Sem entregador definido"} · ${stops.length}/${r.capacity} entregas`} actions={<Badge value={r.status} />} />
      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start">
        <Section title="Paradas">
          {stops.length === 0 ? <Empty title="Rota sem paradas"><Link className="link" href={`/entregas?data=${r.route_date}`}>Adicione pedidos aptos</Link>.</Empty> : (
            <ul className="divide-y divide-line">{stops.map((s: any) => (
              <li key={s.id} className="px-5 py-4 grid lg:grid-cols-[1fr_auto] gap-4">
                <div className="text-[13px]">
                  <div className="flex items-center gap-3"><span className="label">{s.seq}</span><Link className="font-mono text-[12px] link" href={`/pedidos/${s.order_id}`}>{s.number}</Link><span>{s.recipient}</span><Badge value={s.status} />{s.window_label && <span className="chip-neutral">{s.window_label}</span>}</div>
                  <div className="text-espresso mt-1">{s.address} · {s.neighborhood}</div>
                  <div className="text-[12px] text-muted mt-1">{(s.items ?? []).map((i: any) => `${i.sku} × ${i.qty}`).join(", ")}{s.phone && <> · <a className="link" target="_blank" href={waLink(s.phone)!}>WhatsApp</a></>}</div>
                  {s.proof && <div className="text-[12px] mt-1">Comprovante: {s.proof} · {dateTimeBR(s.delivered_at)}</div>}
                  {s.occurrence && <div className="text-[12px] text-warn mt-1">Ocorrência: {s.occurrence}</div>}
                  {s.allocated_cost != null && <div className="text-[12px] text-muted">Custo rateado: {brl(s.allocated_cost)}</div>}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  {r.status === "planejada" && <>
                    <ActionForm action={updateStopAction} submitLabel="Salvar" submitClass="btn-secondary btn-sm" inline className="flex gap-2 items-center">
                      <input type="hidden" name="stop_id" value={s.id} />
                      <input className="input h-7 w-14" name="seq" type="number" defaultValue={s.seq} aria-label="Ordem" />
                      <input className="input h-7 w-28" name="window_label" defaultValue={s.window_label ?? ""} placeholder="09h–12h" aria-label="Janela" />
                    </ActionForm>
                    <ActionButton action={removeStopAction} fields={{ stop_id: s.id }} label="Remover" className="btn-ghost btn-sm" />
                  </>}
                  {s.status === "em_rota" && (
                    <ActionForm action={completeStopAction} submitLabel="Registrar" submitClass="btn-primary btn-sm" className="w-64 space-y-2">
                      <input type="hidden" name="stop_id" value={s.id} />
                      <select className="input" name="result"><option value="entregue">Entregue</option><option value="falhou">Não entregue</option></select>
                      <input className="input" name="proof" placeholder="Quem recebeu / link da foto" />
                      <input className="input" name="occurrence" placeholder="Ocorrência (obrigatória se falhou)" />
                    </ActionForm>
                  )}
                </div>
              </li>))}
            </ul>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Rota"><div className="card-pad space-y-5">
            <KV items={[["Data", weekdayBR(r.route_date)], ["Entregador", r.driver ?? "—"], ["Capacidade", r.capacity], ["Custo real", r.actual_cost != null ? brl(r.actual_cost) : "—"], ["Custo por entrega", r.actual_cost != null && stops.length ? brl(Number(r.actual_cost) / stops.filter((s: any) => ["entregue", "falhou"].includes(s.status)).length || 0) : "—"]]} />
            {r.status === "planejada" && stops.length > 0 && <ActionButton action={startRouteAction} fields={{ route_id: r.id }} label="Iniciar rota (saída do estoque)" className="btn-primary btn-sm" confirm="Os itens precisam estar conferidos e embalados. Iniciar a rota baixa o estoque físico. Continuar?" />}
            {r.status === "em_rota" && (user.role === "admin" ? (
              <ActionForm action={closeRouteAction} submitLabel="Concluir rota" submitClass="btn-primary btn-sm">
                <input type="hidden" name="route_id" value={r.id} />
                <Field label="Custo real da rota (R$)" hint="Combustível, entregador, aplicativo. Lançado no caixa e rateado, mesmo com frete grátis."><input className="input" name="actual_cost" type="number" step="0.01" min="0" required /></Field>
              </ActionForm>) : <p className="text-[12px] text-muted">Conclusão com custo real: administrador.</p>)}
          </div></Section>
        </div>
      </div>
    </>
  );
}
