import Link from "next/link";
import { listSuppliers } from "@/server/suppliers";
import { PageHeader, Section, Empty } from "@/components/ui";
import { SupplierForm } from "@/components/SupplierForm";
import { brl, waLink } from "@/lib/format";

export const metadata = { title: "Fornecedores" };

export default async function Fornecedores() {
  const rows = await listSuppliers();
  return (
    <>
      <PageHeader eyebrow="Compras" title="Fornecedores" description="Cada peça pode ter fornecedores diferentes, com custos e prazos próprios (vínculo feito no produto)." />
      <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="card overflow-x-auto">
          {rows.length === 0 ? <Empty title="Nenhum fornecedor cadastrado">Cadastre os fornecedores com quem a DRAUM trabalha ou está cotando.</Empty> : (
            <table className="table">
              <thead><tr><th>Fornecedor</th><th>Contato</th><th className="text-right">Prazo padrão</th><th className="text-right">Produtos</th><th className="text-right">Itens a comprar</th><th className="text-right">Compras abertas</th><th className="text-right">Total pago</th><th>Status</th></tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.id}>
                  <td><Link className="font-medium hover:underline" href={`/fornecedores/${s.id}`}>{s.name}</Link><div className="text-[12px] text-muted">{s.city}</div></td>
                  <td className="text-[12.5px]">{s.contact_name}{s.whatsapp && <div><a className="link" target="_blank" href={waLink(s.whatsapp)!}>WhatsApp</a></div>}</td>
                  <td className="text-right num">{s.default_lead_days != null ? `${s.default_lead_days} dias` : "—"}</td>
                  <td className="text-right num">{s.products}</td><td className="text-right num">{s.pending_items}</td><td className="text-right num">{s.open_pos}</td>
                  <td className="text-right num">{brl(s.paid_total)}</td>
                  <td>{s.active ? <span className="chip-ok">ativo</span> : <span className="chip-neutral">inativo</span>}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </div>
        <Section title="Novo fornecedor"><div className="card-pad"><SupplierForm /></div></Section>
      </div>
    </>
  );
}
