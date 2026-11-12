import { notFound } from "next/navigation";
import { q1 } from "@/lib/db";
import { listShipments } from "@/server/marketing";
import { listInventory } from "@/server/inventory";
import { PageHeader, Section, Badge, Empty } from "@/components/ui";
import { ActionForm, ActionButton, Field } from "@/components/forms";
import { AmbassadorForm } from "@/components/MarketingForms";
import { shipAmbassadorAction, toggleContentAction } from "@/app/actions/marketing";
import { brl, dateBR } from "@/lib/format";
import { todayISO } from "@/server/core";
import Link from "next/link";

export default async function Embaixadora({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const a = await q1<any>(`select * from draum.ambassadors where id=$1`, [id]);
  if (!a) notFound();
  const [ships, inv, orders] = await Promise.all([listShipments(id), listInventory(), q1<any>(`select json_agg(x) rows from (select o.id, o.number, o.total, o.attribution, o.created_at, c.name from draum.orders o join draum.customers c on c.id=o.customer_id where o.ambassador_id=$1 order by o.created_at desc) x`, [id])]);
  return (
    <>
      <PageHeader eyebrow="Embaixadoras DRAUM" title={a.name} description={a.instagram ? `@${a.instagram}` : undefined} actions={<Badge value={a.status} />} />
      <div className="grid xl:grid-cols-[1fr_420px] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Peças enviadas">
            {ships.length === 0 ? <Empty title="Nenhum envio" /> : (
              <table className="table"><thead><tr><th>Data</th><th>Peça</th><th className="text-right">Qtd</th><th className="text-right">Custo</th><th>Conteúdo entregue</th></tr></thead>
                <tbody>{ships.map((s: any) => <tr key={s.id}><td>{dateBR(s.sent_on)}</td><td>{s.description}</td><td className="text-right num">{s.qty}</td><td className="text-right num">{brl(s.qty * s.unit_cost)}</td>
                  <td><ActionButton action={toggleContentAction} fields={{ id: s.id, value: String(!s.content_delivered) }} label={s.content_delivered ? "sim ✓" : "marcar entregue"} className={s.content_delivered ? "chip-ok cursor-pointer" : "btn-secondary btn-sm"} /></td></tr>)}</tbody></table>
            )}
            <div className="card-pad border-t border-line">
              <ActionForm action={shipAmbassadorAction} submitLabel="Registrar envio (baixa estoque)" className="grid sm:grid-cols-3 gap-3">
                <input type="hidden" name="ambassador_id" value={id} />
                <Field label="SKU"><select className="input" name="variant_id">{inv.filter((v) => v.qty_available > 0).map((v) => <option key={v.variant_id} value={v.variant_id}>{v.sku} · disp. {v.qty_available}</option>)}</select></Field>
                <Field label="Qtd"><input className="input" name="qty" type="number" min="1" defaultValue="1" /></Field>
                <Field label="Data"><input className="input" name="sent_on" type="date" defaultValue={todayISO()} /></Field>
              </ActionForm>
            </div>
          </Section>
          <Section title="Vendas atribuídas">
            {!orders?.rows?.length ? <Empty title="Nenhuma venda atribuída">Vendas são atribuídas pelo código de indicação usado como cupom, link rastreado ou registro explícito no pedido.</Empty> : (
              <table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th className="text-right">Total</th><th>Rastreamento</th></tr></thead>
                <tbody>{orders.rows.map((o: any) => <tr key={o.id}><td><Link className="link font-mono text-[12px]" href={`/pedidos/${o.id}`}>{o.number}</Link></td><td>{o.name}</td><td className="text-right num">{brl(o.total)}</td><td>{o.attribution}</td></tr>)}</tbody></table>
            )}
          </Section>
        </div>
        <Section title="Cadastro"><div className="card-pad"><AmbassadorForm a={a} /></div></Section>
      </div>
    </>
  );
}
