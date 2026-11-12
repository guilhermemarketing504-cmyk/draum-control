import { notFound, redirect } from "next/navigation";
import { REPORTS } from "@/server/reports";
import { requireSession } from "@/lib/auth";
import { todayISO, addDays } from "@/server/core";
import { PageHeader, Empty, FilterBar } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";

export default async function Relatorio({ params, searchParams }: { params: Promise<{ nome: string }>; searchParams: Promise<Record<string, string>> }) {
  const { nome } = await params; const sp = await searchParams;
  const user = await requireSession();
  const def = REPORTS[nome]; if (!def) notFound();
  if (["fluxo_caixa", "despesas"].includes(nome) && user.role !== "admin") redirect("/relatorios");
  const from = sp.de ?? addDays(todayISO(), -90), to = sp.ate ?? todayISO();
  const { columns, rows } = await def.run(from, to);
  const fmt = (v: any) => v == null ? "" : typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : typeof v === "boolean" ? (v ? "sim" : "não") : v instanceof Date ? v.toLocaleDateString("pt-BR") : String(v);
  return (
    <>
      <PageHeader eyebrow={`Relatório · gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Belem" })}`} title={def.title} description={def.usesPeriod ? `Período: ${from.split("-").reverse().join("/")} a ${to.split("-").reverse().join("/")}` : def.description}
        actions={<><a className="btn-secondary" href={`/api/relatorios/${nome}?de=${from}&ate=${to}`}>Baixar CSV</a><PrintButton /></>} />
      {def.usesPeriod && <FilterBar><input className="input w-36" type="date" name="de" defaultValue={from} /><input className="input w-36" type="date" name="ate" defaultValue={to} /></FilterBar>}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty title="Sem registros" /> : (
          <table className="table text-[12.5px]"><thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key} className={typeof r[c.key] === "number" ? "text-right num" : ""}>{fmt(r[c.key])}</td>)}</tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
