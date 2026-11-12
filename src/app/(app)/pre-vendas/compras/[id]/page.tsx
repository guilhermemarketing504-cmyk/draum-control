import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseOrder, PO_STATUS } from "@/server/presales";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section, Badge, KV } from "@/components/ui";
import { ActionForm, ActionButton, Field, Disclosure } from "@/components/forms";
import { sendPOAction, payPOAction, trackingAction, receivePOAction, cancelPOAction } from "@/app/actions/presales";
import { brl, dateBR, dateTimeBR, waLink } from "@/lib/format";

export default async function Compra({ params }: { params: Promise<{ id: string }> }) {
  const [d, user] = await Promise.all([getPurchaseOrder(Number((await params).id)), requireSession()]);
  if (!d) notFound();
  const { po, items } = d;
  const pending = items.filter((i: any) => i.qty_received < i.qty);
  const msg = `Olá! Pedido DRAUM ${po.number}:\n${items.map((i: any) => `• ${i.product_name} ${i.color} ${i.size} (${i.sku}) × ${i.qty}`).join("\n")}\nPode confirmar disponibilidade, valor e prazo?`;
  return (
    <>
      <PageHeader eyebrow="Pré-vendas · Compra a fornecedor" title={po.number} description={po.supplier_name} actions={<Badge value={po.status} label={PO_STATUS[po.status]} />} />
      <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Itens (vínculo unidade ↔ pedido)">
            <table className="table">
              <thead><tr><th>SKU</th><th>Produto</th><th className="text-right">Qtd</th><th className="text-right">Recebidas</th><th className="text-right">Custo un.</th><th>Pedido / cliente</th><th>Prazo cliente</th></tr></thead>
              <tbody>{items.map((i: any) => (
                <tr key={i.id}><td className="font-mono text-[12px]">{i.sku}</td><td>{i.product_name} · {i.color} · {i.size}</td><td className="text-right num">{i.qty}</td><td className="text-right num">{i.qty_received}</td><td className="text-right num">{brl(i.unit_cost)}</td>
                  <td>{i.order_id ? <><Link className="link font-mono text-[12px]" href={`/pedidos/${i.order_id}`}>{i.order_number}</Link> · {i.customer_name}</> : <span className="text-muted">reposição de estoque</span>}</td><td>{dateBR(i.customer_promised_date)}</td></tr>))}
              </tbody>
            </table>
          </Section>
          {["enviado", "pago", "em_transito", "recebido_parcial"].includes(po.status) && pending.length > 0 && (
            <Section title="Recebimento e conferência">
              <ActionForm action={receivePOAction} submitLabel="Registrar recebimento conferido" className="card-pad" confirm="Confirma que as peças foram recebidas e conferidas?">
                <input type="hidden" name="po_id" value={po.id} />
                <div className="space-y-2">{pending.map((i: any) => (
                  <label key={i.id} className="flex items-center gap-3 text-[13px]"><span className="font-mono text-[12px] w-56">{i.sku}</span><span className="text-muted w-32">pendente {i.qty - i.qty_received}</span>
                    <input className="input w-24 h-8" name={`recv_${i.id}`} type="number" min="0" max={i.qty - i.qty_received} defaultValue={i.qty - i.qty_received} /></label>))}
                </div>
                <p className="text-[11.5px] text-muted mt-3">Recebimento parcial é permitido. As peças de pré-venda ficam automaticamente reservadas para os pedidos vinculados.</p>
              </ActionForm>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Resumo">
            <div className="card-pad"><KV items={[
              ["Mercadorias", brl(po.goods_total)], ["Frete", brl(po.shipping_cost)], ["Total", brl(Number(po.goods_total) + Number(po.shipping_cost))],
              ["Enviada em", dateTimeBR(po.ordered_at)], ["Paga em", dateTimeBR(po.paid_at)], ["Previsão", dateBR(po.expected_at)], ["Rastreio", po.tracking_code ?? "—"], ["Observações", po.notes ?? "—"],
            ]} /></div>
          </Section>
          <Section title="Ações">
            <div className="card-pad space-y-5">
              {po.supplier_whatsapp && <a className="btn-secondary btn-sm" target="_blank" href={waLink(po.supplier_whatsapp, msg)!}>Enviar pedido ao fornecedor pelo WhatsApp</a>}
              {po.status === "rascunho" && (
                <ActionForm action={sendPOAction} submitLabel="Marcar como enviada ao fornecedor" submitClass="btn-primary btn-sm">
                  <input type="hidden" name="po_id" value={po.id} />
                  <Field label="Previsão de chegada" hint="Em branco: hoje + prazo do fornecedor."><input className="input" name="expected_at" type="date" /></Field>
                </ActionForm>
              )}
              {!po.paid_at && !["rascunho", "cancelado"].includes(po.status) && (user.role === "admin"
                ? <ActionButton action={payPOAction} fields={{ po_id: po.id }} label="Registrar pagamento ao fornecedor" className="btn-primary btn-sm" confirm={`Confirma o pagamento de ${brl(Number(po.goods_total) + Number(po.shipping_cost))}?`} />
                : <p className="text-[12px] text-muted">Pagamento ao fornecedor: somente administrador.</p>)}
              {!["rascunho", "cancelado", "recebido"].includes(po.status) && (
                <ActionForm action={trackingAction} submitLabel="Atualizar rastreio" submitClass="btn-secondary btn-sm" className="grid grid-cols-2 gap-2">
                  <input type="hidden" name="po_id" value={po.id} />
                  <Field label="Código"><input className="input" name="tracking_code" defaultValue={po.tracking_code ?? ""} /></Field>
                  <Field label="Nova previsão"><input className="input" name="expected_at" type="date" defaultValue={po.expected_at ?? ""} /></Field>
                </ActionForm>
              )}
              {!po.paid_at && !["cancelado", "recebido", "recebido_parcial"].includes(po.status) && (
                <Disclosure label="Cancelar compra">
                  <ActionForm action={cancelPOAction} submitLabel="Cancelar" submitClass="btn-danger btn-sm" confirm="Cancelar esta compra? Os itens voltam para a lista de compras.">
                    <input type="hidden" name="po_id" value={po.id} /><Field label="Motivo"><input className="input" name="reason" required /></Field>
                  </ActionForm>
                </Disclosure>
              )}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
