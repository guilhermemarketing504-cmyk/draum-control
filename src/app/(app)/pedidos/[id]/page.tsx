import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder, ORDER_STATUS, FIN_STATUS, ITEM_STATUS, PAYMENT_METHODS } from "@/server/orders";
import { sellableVariants } from "@/server/products";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section, Badge, KV, Alert } from "@/components/ui";
import { ActionForm, ActionButton, Field, Disclosure } from "@/components/forms";
import {
  informPaymentAction, reconcilePaymentAction, rejectPaymentAction, markReadyAction, handOverAction, confirmDeliveredAction,
  finalizeOrderAction, cancelOrderAction, payRefundAction, returnAction,
} from "@/app/actions/orders";
import { brl, dateBR, dateTimeBR, waLink } from "@/lib/format";

const FULFILL: Record<string, string> = { entrega_local: "DRAUM Delivery Day", retirada: "Retirada", envio: "Envio por transportadora" };

export default async function Pedido({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const [d, user] = await Promise.all([getOrder(id), requireSession()]);
  if (!d) notFound();
  const { order: o, items, payments, refunds, returns, stops, history, margin } = d;
  const admin = user.role === "admin";
  const paidRec = payments.filter((p) => p.status === "conciliado").reduce((a, p) => a + Number(p.amount), 0);
  const informed = payments.filter((p) => p.status !== "rejeitado").reduce((a, p) => a + Number(p.amount), 0);
  const remaining = Math.round((Number(o.total) - informed) * 100) / 100;
  const packable = items.filter((i) => ["reservado", "recebido", "embalado"].includes(i.status));
  const ready = items.filter((i) => i.status === "pronto");
  const inRoute = items.filter((i) => i.status === "em_rota");
  const delivered = items.filter((i) => i.status === "entregue");
  const cancellable = o.status !== "cancelado" && !items.some((i) => ["em_rota", "entregue", "devolvido", "trocado"].includes(i.status));
  const variants = delivered.length ? await sellableVariants() : [];

  return (
    <>
      <PageHeader eyebrow={`Pedido · ${dateTimeBR(o.created_at)}`} title={o.number}
        description={`${o.customer_name} · ${FULFILL[o.fulfillment]}`}
        actions={<><Badge value={o.financial_status} label={FIN_STATUS[o.financial_status]} /><Badge value={o.status} label={ORDER_STATUS[o.status]} /></>} />
      {o.status === "cancelado" && <div className="mb-6"><Alert tone="crit">Cancelado em {dateTimeBR(o.cancelled_at)}: {o.cancel_reason}</Alert></div>}
      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Itens e cumprimento individual">
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>Produto</th><th>Modalidade</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Desconto</th><th className="text-right">Total</th><th>Status</th><th>Prazo</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.id} className={["cancelado", "trocado"].includes(i.status) ? "opacity-50" : ""}>
                  <td><div>{i.product_name}</div><div className="font-mono text-[11px] text-muted">{i.sku} · {i.color} · {i.size}</div></td>
                  <td>{i.mode === "pre" ? <>Pré-venda<div className="text-[11.5px] text-muted">{i.supplier_name}{i.po_number && <> · <Link className="link" href={`/pre-vendas/compras/${i.po_id}`}>{i.po_number}</Link></>}{i.qty_received != null && i.mode === "pre" ? ` · recebidas ${i.qty_received}/${i.qty}` : ""}</div></> : "Pronta-entrega"}</td>
                  <td className="text-right num">{i.qty}</td><td className="text-right num">{brl(i.unit_price)}</td><td className="text-right num">{Number(i.discount) ? `− ${brl(i.discount)}` : "—"}</td>
                  <td className="text-right num">{brl(i.total)}</td>
                  <td><Badge value={i.status} label={ITEM_STATUS[i.status]} /></td>
                  <td className="text-[12px]">{i.customer_promised_date ? dateBR(i.customer_promised_date) : "—"}{i.expected_ready_date && i.mode === "pre" && <div className="text-muted">chegada prev. {dateBR(i.expected_ready_date)}</div>}</td>
                </tr>))}
              </tbody>
              <tfoot><tr><td colSpan={5} className="text-right label !border-0 px-4 py-2">Subtotal · descontos · frete</td><td className="text-right num px-4" colSpan={3}>{brl(o.subtotal)} · −{brl(o.discount_total)} · {brl(o.shipping_charged)}</td></tr>
                <tr><td colSpan={5} className="text-right label px-4 py-2">Total</td><td colSpan={3} className="px-4 font-display text-[18px] num">{brl(o.total)}</td></tr></tfoot>
            </table></div>
            {o.status !== "cancelado" && o.paid_at && (packable.length > 0 || ready.length > 0 || inRoute.length > 0) && (
              <div className="card-pad border-t border-line grid md:grid-cols-3 gap-5">
                {packable.length > 0 && (
                  <ActionForm action={markReadyAction} submitLabel="Conferido e embalado" submitClass="btn-secondary btn-sm">
                    <div className="label mb-2">Conferência e embalagem</div>
                    <input type="hidden" name="order_id" value={o.id} />
                    {packable.map((i) => <label key={i.id} className="flex gap-2 text-[12.5px]"><input type="checkbox" name="items[]" value={i.id} defaultChecked />{i.sku} × {i.qty}</label>)}
                  </ActionForm>
                )}
                {ready.length > 0 && o.fulfillment !== "entrega_local" && (
                  <ActionForm action={handOverAction} submitLabel={o.fulfillment === "retirada" ? "Registrar retirada" : "Registrar envio"} submitClass="btn-secondary btn-sm">
                    <div className="label mb-2">{o.fulfillment === "retirada" ? "Retirada pelo cliente" : "Despacho"}</div>
                    <input type="hidden" name="order_id" value={o.id} /><input type="hidden" name="method" value={o.fulfillment === "retirada" ? "retirada" : "envio"} />
                    {ready.map((i) => <label key={i.id} className="flex gap-2 text-[12.5px]"><input type="checkbox" name="items[]" value={i.id} defaultChecked />{i.sku} × {i.qty}</label>)}
                    <input className="input mt-2" name="note" placeholder={o.fulfillment === "retirada" ? "Quem retirou" : "Código de rastreio"} />
                  </ActionForm>
                )}
                {ready.length > 0 && o.fulfillment === "entrega_local" && <div className="text-[12.5px]"><div className="label mb-2">Delivery Day</div>Itens prontos. Programe em <Link className="link" href="/entregas">Entregas</Link>.</div>}
                {inRoute.length > 0 && o.fulfillment === "envio" && (
                  <ActionForm action={confirmDeliveredAction} submitLabel="Confirmar entrega" submitClass="btn-secondary btn-sm">
                    <div className="label mb-2">Em transporte</div>
                    <input type="hidden" name="order_id" value={o.id} />
                    {inRoute.map((i) => <label key={i.id} className="flex gap-2 text-[12.5px]"><input type="checkbox" name="items[]" value={i.id} defaultChecked />{i.sku} × {i.qty}</label>)}
                  </ActionForm>
                )}
              </div>
            )}
          </Section>

          {items.some((i) => i.terms_accepted) && (
            <Section title="Condições de pré-venda aceitas">
              <ul className="card-pad space-y-3 text-[12.5px] text-espresso">{items.filter((i) => i.terms_accepted).map((i) => <li key={i.id}><span className="font-mono text-[11.5px]">{i.sku}</span> — {i.terms_accepted} <span className="text-muted">(aceite registrado em {dateTimeBR(i.terms_accepted_at)})</span></li>)}</ul>
            </Section>
          )}

          <Section title="Pagamentos">
            {payments.length === 0 ? <p className="card-pad text-muted text-[13px]">Nenhum pagamento registrado.</p> : (
              <table className="table"><thead><tr><th>Informado em</th><th>Forma</th><th className="text-right">Valor</th><th className="text-right">Taxa</th><th>Identificador</th><th>Status</th><th></th></tr></thead>
                <tbody>{payments.map((p) => (
                  <tr key={p.id}>
                    <td className="text-[12px]">{dateTimeBR(p.informed_at)}<div className="text-muted">{p.informed_by_name}</div></td><td>{PAYMENT_METHODS[p.method]}</td>
                    <td className="text-right num">{brl(p.amount)}</td><td className="text-right num">{brl(p.fee_amount)}</td><td className="font-mono text-[11.5px]">{p.external_ref ?? "—"}</td>
                    <td><Badge value={p.status} label={p.status === "informado" ? "aguardando conciliação" : p.status} />{p.reconciled_at && <div className="text-[11px] text-muted">{dateTimeBR(p.reconciled_at)} · {p.reconciled_by_name}</div>}</td>
                    <td className="text-right">{admin && p.status === "informado" && (
                      <div className="flex flex-col gap-2 items-end">
                        <ActionForm action={reconcilePaymentAction} submitLabel="Conciliar" submitClass="btn-primary btn-sm" inline className="flex gap-2 items-center" confirm={`Confirma que ${brl(p.amount)} entrou na conta bancária?`}>
                          <input type="hidden" name="payment_id" value={p.id} />
                          <input className="input w-24 h-7" name="fee_amount" type="number" step="0.01" min="0" placeholder="taxa real" />
                        </ActionForm>
                        <ActionButton action={rejectPaymentAction} fields={{ payment_id: p.id, reason: "não identificado no extrato" }} label="Rejeitar" className="btn-ghost btn-sm" confirm="Rejeitar este pagamento?" />
                      </div>)}</td>
                  </tr>))}
                </tbody></table>
            )}
            {o.status !== "cancelado" && remaining > 0 && (
              <div className="card-pad border-t border-line">
                <ActionForm action={informPaymentAction} submitLabel="Registrar pagamento informado" reset className="grid sm:grid-cols-4 gap-3 items-end">
                  <input type="hidden" name="order_id" value={o.id} />
                  <Field label="Valor (R$)"><input className="input" name="amount" type="number" step="0.01" min="0.01" max={remaining} defaultValue={remaining} required /></Field>
                  <Field label="Forma"><select className="input" name="method" defaultValue={o.payment_method ?? "pix"}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <Field label="ID da transação / comprovante"><input className="input" name="external_ref" /></Field>
                  <Field label="Taxa (se souber)"><input className="input" name="fee_amount" type="number" step="0.01" min="0" /></Field>
                </ActionForm>
                <p className="text-[11.5px] text-muted mt-3">Registrar o comprovante não confirma o recebimento. O valor só entra no caixa quando um administrador conciliar com o extrato.</p>
              </div>
            )}
          </Section>

          {(refunds.length > 0 || returns.length > 0) && (
            <Section title="Reembolsos, trocas e devoluções">
              <div className="card-pad space-y-3 text-[13px]">
                {refunds.map((r) => (
                  <div key={r.id} className="flex justify-between items-center gap-4">
                    <span>Reembolso {brl(r.amount)} — {r.reason} <Badge value={r.status === "pago" ? "liquidada" : "aberta"} label={r.status} /></span>
                    {admin && r.status === "aprovado" && <ActionButton action={payRefundAction} fields={{ refund_id: r.id }} label="Registrar pagamento do reembolso" confirm={`Confirma que ${brl(r.amount)} foi devolvido à cliente?`} />}
                  </div>
                ))}
                {returns.map((r) => <div key={r.id}>{r.kind === "troca" ? "Troca" : "Devolução"} de {r.qty} peça(s){r.new_sku ? ` → ${r.new_sku}` : ""} — {r.reason} · {r.restock ? "voltou ao estoque" : "não retornou ao estoque"} · {dateTimeBR(r.created_at)}</div>)}
              </div>
            </Section>
          )}

          {delivered.length > 0 && (
            <Section title="Registrar troca ou devolução">
              <div className="card-pad">
                <ActionForm action={returnAction} submitLabel="Registrar" className="grid sm:grid-cols-3 gap-3" confirm="Confirmar troca/devolução?">
                  <Field label="Item"><select className="input" name="order_item_id">{delivered.map((i) => <option key={i.id} value={i.id}>{i.sku} × {i.qty}</option>)}</select></Field>
                  <Field label="Tipo"><select className="input" name="kind"><option value="devolucao">Devolução</option><option value="troca">Troca</option></select></Field>
                  <Field label="Quantidade"><input className="input" name="qty" type="number" min="1" defaultValue="1" /></Field>
                  <Field label="Nova variante (troca)"><select className="input" name="new_variant_id"><option value="">—</option>{variants.filter((v: any) => v.available > 0).map((v: any) => <option key={v.id} value={v.id}>{v.sku} · disp. {v.available}</option>)}</select></Field>
                  <Field label="Reembolso (devolução, R$)" hint="Em branco: proporcional ao valor pago."><input className="input" name="refund_amount" type="number" step="0.01" min="0" /></Field>
                  <Field label="Motivo"><input className="input" name="reason" required /></Field>
                  <label className="flex items-center gap-2 text-[13px] sm:col-span-3"><input type="checkbox" name="restock" defaultChecked /> Peça em condição de venda: volta ao estoque</label>
                </ActionForm>
              </div>
            </Section>
          )}

          <Section title="Histórico">
            <ul className="divide-y divide-line">{history.map((h: any) => <li key={h.id} className="px-5 py-2.5 text-[12.5px] flex justify-between gap-4"><span><span className="label mr-2">{h.entity}</span>{h.action.replace(/_/g, " ")}</span><span className="text-muted">{dateTimeBR(h.created_at)} · {h.user_name ?? "sistema"}</span></li>)}</ul>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Resumo">
            <div className="card-pad">
              <KV items={[
                ["Cliente", <Link key="c" className="link" href={`/clientes/${o.customer_id}`}>{o.customer_name}</Link>],
                ["WhatsApp", o.whatsapp ? <a key="w" className="link" target="_blank" href={waLink(o.whatsapp)!}>{o.whatsapp}</a> : "—"],
                ["Entrega", FULFILL[o.fulfillment]],
                ["Endereço", o.address ? `${o.address}${o.neighborhood ? ` · ${o.neighborhood}` : ""}` : "—"],
                ["Prazo prometido", dateBR(o.promised_date)],
                ["Pagamento", o.payment_method ? PAYMENT_METHODS[o.payment_method] : "—"],
                ["Recebido (conciliado)", brl(paidRec)],
                ["Promoção", o.promotion_name ?? "—"],
                ["Atribuição", o.attribution ? `${o.campaign_name ?? ""}${o.ambassador_name ? ` ${o.ambassador_name}` : ""} (${o.attribution.replace("_", " ")})` : "—"],
                ["Criado por", o.created_by_name ?? "—"],
                ...(o.margin_override_by ? [["Exceção de margem", `${o.override_by_name}: ${o.margin_override_reason}`] as [string, string]] : []),
                ["Observações", o.notes ?? "—"],
              ]} />
            </div>
          </Section>
          <Section title="Margem do pedido">
            <div className="card-pad text-[13px] num space-y-1.5">
              {[["Receita líquida", margin.netRevenue], ["Custo das peças", -margin.cogs], ["Taxas de pagamento", -margin.fee], ["Tributos estimados", -margin.tax], ["Embalagem", -margin.packaging], ["Entrega (custo − frete)", -margin.delivery]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><span className="text-muted">{k}</span><span>{brl(v as number)}</span></div>
              ))}
              <div className="vao my-3" />
              <div className="flex justify-between font-medium"><span>Margem de contribuição</span><span>{brl(margin.margin)} · {margin.marginPct.toLocaleString("pt-BR")}%</span></div>
              <p className="text-[11.5px] text-muted pt-2">Usa a taxa real dos pagamentos conciliados e o custo real rateado da rota quando disponíveis.</p>
            </div>
          </Section>
          {stops.length > 0 && (
            <Section title="Entregas">
              <ul className="card-pad space-y-2 text-[13px]">{stops.map((s: any) => <li key={s.id}><Link className="link" href={`/entregas/${s.route_id}`}>Rota {dateBR(s.route_date)}</Link> · <Badge value={s.status} />{s.proof && <div className="text-[12px] text-muted">{s.proof}</div>}{s.occurrence && <div className="text-[12px] text-warn">{s.occurrence}</div>}</li>)}</ul>
            </Section>
          )}
          <Section title="Ações">
            <div className="card-pad space-y-4">
              {o.status === "entregue" && <ActionButton action={finalizeOrderAction} fields={{ order_id: o.id }} label="Finalizar pedido" className="btn-primary btn-sm" />}
              {cancellable ? (
                <Disclosure label="Cancelar pedido">
                  {o.paid_at && !admin ? <p className="text-[12.5px] text-muted">Pedidos pagos só podem ser cancelados por um administrador.</p> : (
                    <ActionForm action={cancelOrderAction} submitLabel="Confirmar cancelamento" submitClass="btn-danger btn-sm" confirm="Cancelar este pedido? Reservas serão liberadas e, se houver pagamento conciliado, um reembolso será criado.">
                      <input type="hidden" name="order_id" value={o.id} />
                      <Field label="Motivo"><input className="input" name="reason" required /></Field>
                    </ActionForm>
                  )}
                </Disclosure>
              ) : o.status !== "cancelado" && <p className="text-[12px] text-muted">Itens já despachados: use troca/devolução.</p>}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
