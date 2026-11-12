import Link from "next/link";
import { listProducts, CATEGORIES } from "@/server/products";
import { listSuppliers } from "@/server/suppliers";
import { PageHeader, Empty, Badge, FilterBar } from "@/components/ui";
import { brl, int, pct } from "@/lib/format";

export const metadata = { title: "Produtos" };

export default async function Produtos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [rows, suppliers] = await Promise.all([
    listProducts({ search: sp.q, category: sp.categoria, status: sp.status, supplierId: sp.fornecedor ? Number(sp.fornecedor) : undefined }),
    listSuppliers(),
  ]);
  return (
    <>
      <PageHeader eyebrow="Catálogo" title="Produtos" description="Cada combinação de cor e tamanho tem SKU e estoque próprios."
        actions={<><Link href="/produtos/importar" className="btn-secondary">Importar CSV</Link><Link href="/produtos/novo" className="btn-primary">Novo produto</Link></>} />
      <FilterBar>
        <input className="input w-60" name="q" placeholder="Buscar por nome, código ou SKU" defaultValue={sp.q} />
        <select className="input w-44" name="categoria" defaultValue={sp.categoria ?? ""}>
          <option value="">Todas as categorias</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-40" name="status" defaultValue={sp.status ?? ""}>
          <option value="">Todos os status</option><option value="ativo">Ativo</option><option value="rascunho">Rascunho</option><option value="pausado">Pausado</option><option value="descontinuado">Descontinuado</option>
        </select>
        <select className="input w-48" name="fornecedor" defaultValue={sp.fornecedor ?? ""}>
          <option value="">Todos os fornecedores</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </FilterBar>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty title="Nenhum produto cadastrado" action={<Link href="/produtos/novo" className="btn-primary">Cadastrar o primeiro produto</Link>}>
            Cadastre os modelos que a DRAUM vende ou está cotando. Você também pode importar uma planilha CSV.
          </Empty>
        ) : (
          <table className="table">
            <thead><tr><th></th><th>Produto</th><th>Categoria</th><th>Variantes</th><th className="text-right">Preço</th><th className="text-right">Custo</th><th className="text-right">Margem bruta</th><th className="text-right">Disponível</th><th className="text-right">Reservado</th><th>Modalidade</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const cost = p.primary_cost != null ? Number(p.primary_cost) + Number(p.primary_freight) : null;
                const price = Number(p.promo_price ?? p.sale_price);
                const m = cost != null && price > 0 ? ((price - cost) / price) * 100 : null;
                return (
                  <tr key={p.id}>
                    <td className="w-14">{p.image_url ? <img src={p.image_url} alt="" className="w-10 h-12 object-cover rounded-sm bg-sand" /> : <div className="w-10 h-12 bg-sand/60 rounded-sm" />}</td>
                    <td><Link href={`/produtos/${p.id}`} className="font-medium hover:underline">{p.name}</Link><div className="font-mono text-[11px] text-muted">{p.code}</div></td>
                    <td>{CATEGORIES[p.category]?.label}</td>
                    <td className="text-[12px]"><div>{p.colors ?? "—"}</div><div className="text-muted">{p.sizes}</div></td>
                    <td className="text-right num">{brl(p.sale_price)}{p.promo_price && <div className="text-[11.5px] text-muted">promo {brl(p.promo_price)}</div>}</td>
                    <td className="text-right num">{cost != null ? brl(cost) : <span className="text-muted">sem custo</span>}</td>
                    <td className={`text-right num ${m != null && m < 30 ? "text-crit" : ""}`}>{m != null ? pct(m) : "—"}</td>
                    <td className="text-right num">{int(p.available)} {p.low_stock && <span className="chip-warn ml-1">baixo</span>}</td>
                    <td className="text-right num">{int(p.reserved)}</td>
                    <td><Badge value="x" label={p.modality === "ambas" ? "Pronta + pré" : p.modality === "pre" ? "Pré-venda" : "Pronta"} /></td>
                    <td><Badge value={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
