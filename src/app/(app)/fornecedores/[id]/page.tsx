import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupplier } from "@/server/suppliers";
import { PO_STATUS } from "@/server/presales";
import { PageHeader, Section, Badge, Empty } from "@/components/ui";
import { SupplierForm } from "@/components/SupplierForm";
import { brl, dateBR, dateTimeBR } from "@/lib/format";

export default async function Fornecedor({ params }: { params: Promise<{ id: string }> }) {
  const d = await getSupplier(Number((await params).id));
  if (!d) notFound();
  return (
    <>
      <PageHeader eyebrow="Fornecedores" title={d.supplier.name} />
      <div className="grid xl:grid-cols-[1fr_400px] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Produtos fornecidos">
            {d.products.length === 0 ? <Empty title="Nenhum produto vinculado">Vincule na página de cada produto.</Empty> : (
              <table className="table"><thead><tr><th>Produto</th><th className="text-right">Custo</th><th className="text-right">Frete</th><th className="text-right">Prazo</th><th>Disponibilidade verificada</th></tr></thead>
                <tbody>{d.products.map((p: any) => (<tr key={p.id}><td><Link className="hover:underline" href={`/produtos/${p.product_id}`}>{p.name}</Link> <span className="font-mono text-[11px] text-muted">{p.code}</span></td><td className="text-right num">{brl(p.unit_cost)}</td><td className="text-right num">{brl(p.inbound_freight)}</td><td className="text-right num">{p.lead_days} dias</td><td className="text-[12px]">{dateTimeBR(p.availability_checked_at)}</td></tr>))}</tbody></table>
            )}
          </Section>
          <Section title="Compras">
            {d.pos.length === 0 ? <Empty title="Nenhuma compra" /> : (
              <table className="table"><thead><tr><th>Compra</th><th>Status</th><th className="text-right">Mercadorias</th><th className="text-right">Frete</th><th>Previsão</th><th>Rastreio</th></tr></thead>
                <tbody>{d.pos.map((p: any) => (<tr key={p.id}><td><Link className="hover:underline" href={`/pre-vendas/compras/${p.id}`}>{p.number}</Link></td><td><Badge value={p.status} label={PO_STATUS[p.status]} /></td><td className="text-right num">{brl(p.goods_total)}</td><td className="text-right num">{brl(p.shipping_cost)}</td><td>{dateBR(p.expected_at)}</td><td className="font-mono text-[12px]">{p.tracking_code ?? "—"}</td></tr>))}</tbody></table>
            )}
          </Section>
        </div>
        <Section title="Cadastro"><div className="card-pad"><SupplierForm s={d.supplier} /></div></Section>
      </div>
    </>
  );
}
