import { notFound } from "next/navigation";
import Link from "next/link";
import { getProduct, CATEGORIES } from "@/server/products";
import { listSuppliers } from "@/server/suppliers";
import { getSettings } from "@/server/core";
import { PageHeader, Section, Badge, Empty } from "@/components/ui";
import { ActionForm, ActionButton, Field, Disclosure } from "@/components/forms";
import { EditProductForm } from "@/components/ProductForm";
import { addVariantsAction, toggleVariantAction, saveProductSupplierAction, checkAvailabilityAction, removeProductSupplierAction } from "@/app/actions/products";
import { brl, int, pct, dateTimeBR } from "@/lib/format";

export default async function Produto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, suppliers, s] = await Promise.all([getProduct(Number(id)), listSuppliers(), getSettings()]);
  if (!data) notFound();
  const { product: p, variants, suppliers: links } = data;
  const price = Number(p.promo_price ?? p.sale_price);
  return (
    <>
      <PageHeader eyebrow={`Produtos · ${CATEGORIES[p.category]?.label}`} title={p.name}
        description={`${p.code} · ${variants.length} variante(s)`} actions={<Badge value={p.status} />} />
      <div className="grid xl:grid-cols-[1fr_420px] gap-6">
        <div className="space-y-6">
          <Section title="Variantes e estoque" actions={<Link href={`/estoque?q=${p.code}`} className="link text-[12px]">Ver no estoque</Link>}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>SKU</th><th>Cor</th><th>Tam.</th><th className="text-right">Físico</th><th className="text-right">Reservado</th><th className="text-right">Disponível</th><th className="text-right">Em trânsito</th><th className="text-right">Custo médio</th><th></th></tr></thead>
                <tbody>
                  {variants.map((v: any) => (
                    <tr key={v.id} className={v.active ? "" : "opacity-50"}>
                      <td className="font-mono text-[12px]">{v.sku}</td><td>{v.color}</td><td>{v.size}</td>
                      <td className="text-right num">{int(v.qty_physical)}</td><td className="text-right num">{int(v.qty_reserved)}</td>
                      <td className={`text-right num ${v.min_qty > 0 && v.qty_available <= v.min_qty ? "text-warn" : ""}`}>{int(v.qty_available)}</td>
                      <td className="text-right num">{int(v.qty_in_transit)}</td><td className="text-right num">{Number(v.avg_cost) ? brl(v.avg_cost) : "—"}</td>
                      <td className="text-right"><ActionButton action={toggleVariantAction} fields={{ id: v.id, active: String(!v.active) }} label={v.active ? "Desativar" : "Reativar"} className="btn-ghost btn-sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-pad border-t border-line">
              <Disclosure label="Adicionar variantes">
                <ActionForm action={addVariantsAction} submitLabel="Criar variantes" className="grid sm:grid-cols-3 gap-3 items-end">
                  <input type="hidden" name="id" value={p.id} />
                  <Field label="Cor"><input className="input" name="color" required /></Field>
                  <Field label="Código da cor"><input className="input font-mono uppercase" name="color_code" maxLength={4} placeholder="auto" /></Field>
                  <Field label="Tamanhos"><input className="input" name="sizes" placeholder="P, M, G" required /></Field>
                </ActionForm>
              </Disclosure>
            </div>
          </Section>

          <Section title="Fornecedores, custos e prazos">
            {links.length === 0 ? <Empty title="Sem fornecedor vinculado">Vincule ao menos um fornecedor para calcular margem e permitir pré-venda.</Empty> : (
              <div className="overflow-x-auto"><table className="table">
                <thead><tr><th>Fornecedor</th><th className="text-right">Custo</th><th className="text-right">Frete aquisição</th><th className="text-right">Prazo</th><th className="text-right">Margem bruta</th><th>Disponibilidade verificada</th><th></th></tr></thead>
                <tbody>
                  {links.map((l: any) => {
                    const cost = Number(l.unit_cost) + Number(l.inbound_freight);
                    const age = l.availability_checked_at ? (Date.now() - new Date(l.availability_checked_at).getTime()) / 86400000 : null;
                    return (
                      <tr key={l.id}>
                        <td>{l.supplier_name} {l.is_primary && <span className="chip-dark ml-1">principal</span>}</td>
                        <td className="text-right num">{brl(l.unit_cost)}</td><td className="text-right num">{brl(l.inbound_freight)}</td>
                        <td className="text-right num">{l.lead_days} dias</td>
                        <td className={`text-right num ${(price - cost) / price * 100 < s.min_margin_pct ? "text-crit" : ""}`}>{price > 0 ? pct(((price - cost) / price) * 100) : "—"}</td>
                        <td>{age == null ? <span className="chip-warn">não verificada</span> : age > s.availability_valid_days ? <span className="chip-warn">vencida · {dateTimeBR(l.availability_checked_at)}</span> : <span className="chip-ok">{dateTimeBR(l.availability_checked_at)}</span>}</td>
                        <td className="text-right whitespace-nowrap">
                          <ActionButton action={checkAvailabilityAction} fields={{ id: l.id }} label="Confirmei hoje" confirm={`Confirma que ${l.supplier_name} informou disponibilidade e prazo de ${l.lead_days} dias hoje?`} />
                          <ActionButton action={removeProductSupplierAction} fields={{ id: l.id }} label="Remover" className="btn-ghost btn-sm" confirm="Remover vínculo?" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
            <div className="card-pad border-t border-line">
              {suppliers.length === 0 ? <p className="text-muted text-[13px]">Cadastre fornecedores em <Link className="link" href="/fornecedores">Fornecedores</Link>.</p> : (
                <Disclosure label="Vincular / atualizar fornecedor">
                  <ActionForm action={saveProductSupplierAction} submitLabel="Salvar vínculo" className="grid sm:grid-cols-2 gap-3">
                    <input type="hidden" name="product_id" value={p.id} />
                    <Field label="Fornecedor"><select className="input" name="supplier_id" required>{suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                    <Field label="Custo por peça (R$)"><input className="input num" name="unit_cost" type="number" step="0.01" min="0" required /></Field>
                    <Field label="Frete de aquisição por peça (R$)"><input className="input num" name="inbound_freight" type="number" step="0.01" min="0" defaultValue="0" /></Field>
                    <Field label="Prazo do fornecedor (dias)"><input className="input num" name="lead_days" type="number" min="0" required /></Field>
                    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="availability_checked" /> Disponibilidade confirmada hoje com o fornecedor</label>
                    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="is_primary" /> Fornecedor principal</label>
                    <Field label="Observações" className="sm:col-span-2"><input className="input" name="notes" /></Field>
                  </ActionForm>
                </Disclosure>
              )}
            </div>
          </Section>
        </div>
        <div className="space-y-6">
          {p.image_url && <img src={p.image_url} alt={p.name} className="w-full aspect-[4/5] object-cover card" />}
          <Section title="Dados do produto">
            <div className="card-pad">
              <EditProductForm p={p} />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
