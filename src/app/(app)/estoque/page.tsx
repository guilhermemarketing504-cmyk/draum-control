import Link from "next/link";
import { listInventory, listMovements, valueOf } from "@/server/inventory";
import { CATEGORIES } from "@/server/products";
import { requireSession } from "@/lib/auth";
import { PageHeader, Empty, FilterBar, Stat, Tabs } from "@/components/ui";
import { ActionForm, Disclosure, Field } from "@/components/forms";
import { adjustStockAction, inventoryMetaAction } from "@/app/actions/inventory";
import { brl, int, dateTimeBR } from "@/lib/format";

export const metadata = { title: "Estoque" };
const TYPE: Record<string, string> = { entrada: "Entrada", reserva: "Reserva", liberacao: "Liberação", baixa: "Baixa (saída)", ajuste: "Ajuste", devolucao: "Devolução/retorno", transito: "Em trânsito" };
const FIELD: Record<string, string> = { physical: "físico", reserved: "reservado", in_transit: "em trânsito" };

export default async function Estoque({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireSession();
  const tab = sp.aba === "movimentacoes" ? "movimentacoes" : "posicao";
  const rows = await listInventory({ search: sp.q, category: sp.categoria, low: sp.baixo === "1" });
  const moves = tab === "movimentacoes" ? await listMovements(sp.variante ? Number(sp.variante) : undefined, 300) : [];
  const totals = rows.reduce((a, r) => ({ phys: a.phys + r.qty_physical, res: a.res + r.qty_reserved, av: a.av + r.qty_available, tr: a.tr + r.qty_in_transit }), { phys: 0, res: 0, av: 0, tr: 0 });
  return (
    <>
      <PageHeader eyebrow="Operação" title="Estoque" description="Disponível = físico − reservado. Pré-vendas não geram estoque: a entrada só acontece no recebimento conferido." />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Físico" value={int(totals.phys)} hint="unidades" />
        <Stat label="Reservado" value={int(totals.res)} hint="para pedidos" />
        <Stat label="Disponível" value={int(totals.av)} hint="para venda" />
        <Stat label="Em trânsito" value={int(totals.tr)} hint="compras enviadas" />
        <Stat label="Valor ao custo" value={brl(valueOf(rows))} hint="custo médio ponderado" />
      </div>
      <Tabs current={tab} tabs={[{ key: "posicao", label: "Posição por SKU", href: "/estoque" }, { key: "movimentacoes", label: "Histórico de movimentações", href: "/estoque?aba=movimentacoes" }]} />
      {tab === "posicao" ? (
        <>
          <FilterBar>
            <input className="input w-60" name="q" placeholder="SKU ou produto" defaultValue={sp.q} />
            <select className="input w-44" name="categoria" defaultValue={sp.categoria ?? ""}><option value="">Todas as categorias</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <label className="flex items-center gap-2 h-9 text-[13px]"><input type="checkbox" name="baixo" value="1" defaultChecked={sp.baixo === "1"} /> Só estoque baixo</label>
          </FilterBar>
          <div className="card overflow-x-auto">
            {rows.length === 0 ? <Empty title="Nenhum SKU encontrado" action={<Link className="btn-primary" href="/produtos/novo">Cadastrar produto</Link>}>Os SKUs aparecem aqui assim que os produtos e variantes são cadastrados.</Empty> : (
              <table className="table">
                <thead><tr><th>SKU</th><th>Produto</th><th>Cor</th><th>Tam.</th><th className="text-right">Físico</th><th className="text-right">Reservado</th><th className="text-right">Disponível</th><th className="text-right">Trânsito</th><th className="text-right">Mínimo</th><th className="text-right">Custo médio</th><th>Local</th><th>Última mov.</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.variant_id}>
                      <td className="font-mono text-[12px]"><Link className="hover:underline" href={`/estoque?aba=movimentacoes&variante=${r.variant_id}`}>{r.sku}</Link></td>
                      <td><Link className="hover:underline" href={`/produtos/${r.product_id}`}>{r.name}</Link></td><td>{r.color}</td><td>{r.size}</td>
                      <td className="text-right num">{r.qty_physical}</td><td className="text-right num">{r.qty_reserved}</td>
                      <td className="text-right num font-medium">{r.qty_available}{r.min_qty > 0 && r.qty_available <= r.min_qty && <span className="chip-warn ml-2">baixo</span>}</td>
                      <td className="text-right num">{r.qty_in_transit}</td><td className="text-right num">{r.min_qty}</td>
                      <td className="text-right num">{Number(r.avg_cost) ? brl(r.avg_cost) : "—"}</td><td>{r.location ?? "—"}</td>
                      <td className="text-[12px] text-muted">{dateTimeBR(r.last_movement_at)}</td>
                      <td className="min-w-[120px]">
                        <Disclosure label="Editar">
                          <div className="w-72 space-y-4">
                            <ActionForm action={inventoryMetaAction} submitLabel="Salvar" className="grid grid-cols-2 gap-2">
                              <input type="hidden" name="variant_id" value={r.variant_id} />
                              <Field label="Mínimo"><input className="input" name="min_qty" type="number" min="0" defaultValue={r.min_qty} /></Field>
                              <Field label="Local"><input className="input" name="location" defaultValue={r.location ?? ""} /></Field>
                            </ActionForm>
                            {user.role === "admin" && (
                              <ActionForm action={adjustStockAction} submitLabel="Ajustar físico" className="grid grid-cols-2 gap-2" confirm="Confirmar ajuste de estoque? A operação fica registrada no histórico.">
                                <input type="hidden" name="variant_id" value={r.variant_id} />
                                <Field label="Novo físico"><input className="input" name="new_physical" type="number" min={r.qty_reserved} defaultValue={r.qty_physical} required /></Field>
                                <Field label="Custo unit. (entradas)"><input className="input" name="unit_cost" type="number" step="0.01" min="0" /></Field>
                                <Field label="Motivo" className="col-span-2"><input className="input" name="reason" placeholder="Inventário inicial, contagem, avaria…" required /></Field>
                              </ActionForm>
                            )}
                          </div>
                        </Disclosure>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="card overflow-x-auto">
          {moves.length === 0 ? <Empty title="Sem movimentações registradas" /> : (
            <table className="table">
              <thead><tr><th>Data</th><th>SKU</th><th>Tipo</th><th>Campo</th><th className="text-right">Qtd</th><th className="text-right">Custo unit.</th><th>Observação</th><th>Usuário</th></tr></thead>
              <tbody>{moves.map((m) => (
                <tr key={m.id}><td className="text-[12px]">{dateTimeBR(m.created_at)}</td><td className="font-mono text-[12px]">{m.sku}</td><td>{TYPE[m.type]}</td><td>{FIELD[m.field]}</td>
                  <td className={`text-right num ${m.qty < 0 ? "text-crit" : ""}`}>{m.qty > 0 ? "+" : ""}{m.qty}</td><td className="text-right num">{m.unit_cost ? brl(m.unit_cost) : "—"}</td>
                  <td className="text-[12px]">{m.note ?? (m.order_item_id ? `item de pedido #${m.order_item_id}` : "")}</td><td className="text-[12px]">{m.user_name ?? "—"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
