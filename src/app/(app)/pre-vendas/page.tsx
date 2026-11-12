import Link from "next/link";
import { listPresales, purchaseNeeds, listPurchaseOrders, PO_STATUS } from "@/server/presales";
import { ITEM_STATUS } from "@/server/orders";
import { listSuppliers } from "@/server/suppliers";
import { listInventory } from "@/server/inventory";
import { PageHeader, Section, Empty, Badge, Tabs, Stat, Alert } from "@/components/ui";
import { ActionForm, Field, Disclosure } from "@/components/forms";
import { createPurchaseOrderAction, createStockPurchaseAction } from "@/app/actions/presales";
import { brl, dateBR, waLink } from "@/lib/format";

export const metadata = { title: "Pré-vendas" };

export default async function PreVendas({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const tab = sp.aba ?? "acompanhamento";
  const [rows, needs, pos] = await Promise.all([listPresales({ status: sp.todas ? undefined : "abertas" }), purchaseNeeds(), listPurchaseOrders()]);
  const risky = rows.filter((r) => ["alto", "atrasado"].includes(r.risk.level));
  const reserved = rows.reduce((a, r) => a + Number(r.reserved_for_purchase), 0);
  return (
    <>
      <PageHeader eyebrow="Operação" title="Pré-vendas" description="Peças compradas do fornecedor somente com o dinheiro do próprio pedido, mantendo o vínculo entre cada unidade e o pedido correspondente." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Pré-vendas em aberto" value={rows.filter((r) => !["entregue", "cancelado"].includes(r.status)).length} />
        <Stat label="Aguardando compra" value={rows.filter((r) => r.status === "aguardando_compra").length} />
        <Stat label="Reservado para fornecedores" value={brl(reserved)} hint="parte do caixa comprometido" />
        <Stat label="Risco de atraso" value={risky.length} tone={risky.length ? "crit" : undefined} />
      </div>
      {risky.length > 0 && <div className="mb-6"><Alert tone="crit">{risky.length} pré-venda(s) com risco de descumprir o prazo prometido: {risky.slice(0, 5).map((r) => `${r.order_number} (${r.risk.label})`).join(", ")}. Avise as clientes com antecedência.</Alert></div>}
      <Tabs current={tab} tabs={[
        { key: "acompanhamento", label: "Acompanhamento", href: "/pre-vendas" },
        { key: "lista", label: `Lista de compras (${needs.reduce((a, g) => a + g.items.length, 0)})`, href: "/pre-vendas?aba=lista" },
        { key: "compras", label: "Compras a fornecedores", href: "/pre-vendas?aba=compras" },
      ]} />

      {tab === "acompanhamento" && (
        <div className="card overflow-x-auto">
          <div className="px-5 py-3 border-b border-line text-[12.5px]">{sp.todas ? <Link className="link" href="/pre-vendas">Mostrar só em aberto</Link> : <Link className="link" href="/pre-vendas?todas=1">Incluir concluídas e canceladas</Link>}</div>
          {rows.length === 0 ? <Empty title="Nenhuma pré-venda">As pré-vendas aparecem aqui quando um pedido inclui itens sob encomenda.</Empty> : (
            <table className="table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Produto</th><th>Fornecedor</th><th className="text-right">Custo</th><th className="text-right">Recebido</th><th className="text-right">Reservado p/ compra</th><th>Status</th><th>Compra</th><th>Prazo forn.</th><th>Rastreio</th><th>Chegada prev.</th><th>Prazo cliente</th><th>Recebido em</th><th>Risco</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="font-mono text-[12px] hover:underline" href={`/pedidos/${r.order_id}`}>{r.order_number}</Link></td>
                  <td>{r.customer_name}</td>
                  <td><div>{r.product_name}</div><div className="font-mono text-[11px] text-muted">{r.sku} × {r.qty}</div></td>
                  <td>{r.supplier_name}</td>
                  <td className="text-right num">{brl(r.confirmed_cost ?? r.unit_cost)}{r.confirmed_cost != null && <div className="text-[10.5px] text-muted">confirmado</div>}</td>
                  <td className="text-right num">{brl(r.value_received)}</td>
                  <td className="text-right num">{brl(r.reserved_for_purchase)}</td>
                  <td><Badge value={r.status} label={ITEM_STATUS[r.status]} /></td>
                  <td className="text-[12px]">{r.po_id ? <Link className="link" href={`/pre-vendas/compras/${r.po_id}`}>{r.po_number}</Link> : "—"}{r.ordered_at && <div className="text-muted">{dateBR(r.ordered_at)}</div>}</td>
                  <td className="num">{r.supplier_lead_days != null ? `${r.supplier_lead_days} d` : "—"}</td>
                  <td className="font-mono text-[11.5px]">{r.tracking_code ?? "—"}</td>
                  <td>{dateBR(r.expected_arrival)}</td><td>{dateBR(r.customer_promised_date)}</td><td>{dateBR(r.received_at)}</td>
                  <td><Badge value={r.risk.level} label={r.risk.label} /></td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "lista" && (
        <div className="space-y-6">
          {needs.length === 0 ? <div className="card"><Empty title="Nada a comprar">Itens de pré-venda entram aqui após a conciliação do pagamento do pedido.</Empty></div> : needs.map((g) => (
            <Section key={g.supplier_id} title={`${g.supplier_name} · ${g.items.length} item(ns) · ${brl(g.total)}`}>
              <div className="card-pad border-b border-line text-[12.5px] text-espresso">
                <span className="label mr-2">Consolidado por SKU</span>{Object.entries(g.bySku).map(([sku, n]) => <span key={sku} className="font-mono mr-4">{sku} × {n as number}</span>)}
              </div>
              <ActionForm action={createPurchaseOrderAction} submitLabel="Criar compra com os itens selecionados" className="card-pad">
                <input type="hidden" name="supplier_id" value={g.supplier_id} />
                <table className="table -mx-5 w-[calc(100%+2.5rem)]">
                  <thead><tr><th></th><th>Pedido</th><th>Cliente</th><th>SKU</th><th className="text-right">Qtd</th><th className="text-right">Custo cadastrado</th><th>Custo confirmado (un.)</th><th>Prazo cliente</th></tr></thead>
                  <tbody>{g.items.map((i: any) => (
                    <tr key={i.order_item_id}>
                      <td><input type="checkbox" name="items[]" value={i.order_item_id} defaultChecked /></td>
                      <td className="font-mono text-[12px]">{i.order_number}</td><td>{i.customer_name}</td><td className="font-mono text-[12px]">{i.sku}</td>
                      <td className="text-right num">{i.qty}</td><td className="text-right num">{brl(i.supplier_unit_cost)}</td>
                      <td><input className="input h-8 w-28" name={`cost_${i.order_item_id}`} type="number" step="0.01" min="0" placeholder={String(i.supplier_unit_cost ?? "")} /></td>
                      <td>{dateBR(i.customer_promised_date)}</td>
                    </tr>))}
                  </tbody>
                </table>
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <Field label="Frete da compra (R$)"><input className="input" name="shipping_cost" type="number" step="0.01" min="0" defaultValue="0" /></Field>
                  <Field label="Observações"><input className="input" name="notes" /></Field>
                </div>
                <p className="text-[11.5px] text-muted mt-2">Se o custo confirmado ou o frete superarem o valor reservado pelos pedidos, a diferença precisará sair do caixa livre no momento do pagamento.</p>
              </ActionForm>
            </Section>
          ))}
          <ReplenishForm />
        </div>
      )}

      {tab === "compras" && (
        <div className="card overflow-x-auto">
          {pos.length === 0 ? <Empty title="Nenhuma compra registrada" /> : (
            <table className="table">
              <thead><tr><th>Compra</th><th>Fornecedor</th><th>Status</th><th className="text-right">Peças</th><th className="text-right">Recebidas</th><th className="text-right">Mercadorias</th><th className="text-right">Frete</th><th>Enviada</th><th>Paga</th><th>Previsão</th><th>Rastreio</th></tr></thead>
              <tbody>{pos.map((p) => (
                <tr key={p.id}><td><Link className="font-mono text-[12px] hover:underline" href={`/pre-vendas/compras/${p.id}`}>{p.number}</Link></td><td>{p.supplier_name}</td>
                  <td><Badge value={p.status} label={PO_STATUS[p.status]} /></td><td className="text-right num">{p.units ?? 0}</td><td className="text-right num">{p.received ?? 0}</td>
                  <td className="text-right num">{brl(p.goods_total)}</td><td className="text-right num">{brl(p.shipping_cost)}</td><td>{dateBR(p.ordered_at)}</td><td>{dateBR(p.paid_at)}</td><td>{dateBR(p.expected_at)}</td><td className="font-mono text-[11.5px]">{p.tracking_code ?? "—"}</td></tr>))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

async function ReplenishForm() {
  const [suppliers, inv] = await Promise.all([listSuppliers(), listInventory()]);
  if (!suppliers.length || !inv.length) return null;
  return (
    <Section title="Reposição de estoque (sem pedido vinculado)">
      <div className="card-pad">
        <Disclosure label="Nova compra de reposição">
          <ActionForm action={createStockPurchaseAction} submitLabel="Criar compra" className="grid sm:grid-cols-3 gap-3">
            <Field label="Fornecedor"><select className="input" name="supplier_id">{suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="SKU"><select className="input" name="variant_id">{inv.map((v) => <option key={v.variant_id} value={v.variant_id}>{v.sku} · disp. {v.qty_available}</option>)}</select></Field>
            <Field label="Quantidade"><input className="input" name="qty" type="number" min="1" required /></Field>
            <Field label="Custo unitário (R$)"><input className="input" name="unit_cost" type="number" step="0.01" min="0" required /></Field>
            <Field label="Frete (R$)"><input className="input" name="shipping_cost" type="number" step="0.01" min="0" defaultValue="0" /></Field>
            <Field label="Observações"><input className="input" name="notes" /></Field>
          </ActionForm>
          <p className="text-[11.5px] text-muted mt-2">Reposição é paga exclusivamente com o caixa livre: o sistema bloqueia o pagamento se faltar dinheiro não comprometido.</p>
        </Disclosure>
      </div>
    </Section>
  );
}
