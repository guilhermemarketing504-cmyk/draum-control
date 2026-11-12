import Link from "next/link";
import { REPORTS } from "@/server/reports";
import { requireSession } from "@/lib/auth";
import { todayISO, addDays } from "@/server/core";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Relatórios" };
const ADMIN_ONLY = ["fluxo_caixa", "despesas"];

export default async function Relatorios() {
  const user = await requireSession();
  const from = addDays(todayISO(), -90), to = todayISO();
  return (
    <>
      <PageHeader eyebrow="Indicadores" title="Relatórios" description="Gerados a partir dos registros reais do sistema. Exportação em CSV (abre no Excel/Google Planilhas). Para PDF, abra o relatório e use Imprimir → Salvar como PDF." />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Object.entries(REPORTS).filter(([k]) => user.role === "admin" || !ADMIN_ONLY.includes(k)).map(([k, r]) => (
          <div key={k} className="card card-pad flex flex-col">
            <div className="font-display text-[16px]">{r.title}</div>
            <p className="text-[12.5px] text-espresso mt-1.5 flex-1">{r.description}</p>
            <form action={`/api/relatorios/${k}`} className="flex flex-wrap gap-2 items-end mt-4">
              {r.usesPeriod && <><input className="input w-36 h-8" type="date" name="de" defaultValue={from} aria-label="De" /><input className="input w-36 h-8" type="date" name="ate" defaultValue={to} aria-label="Até" /></>}
              <button className="btn-primary btn-sm">CSV</button>
              <Link className="btn-secondary btn-sm" href={`/relatorios/${k}`}>Visualizar / PDF</Link>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
