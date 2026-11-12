import { getSession } from "@/lib/auth";
import { REPORTS, toCsv } from "@/server/reports";
import { todayISO, addDays } from "@/server/core";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ nome: string }> }) {
  const user = await getSession();
  if (!user) return new Response("não autenticado", { status: 401 });
  const { nome } = await params;
  const def = REPORTS[nome];
  if (!def) return new Response("relatório inexistente", { status: 404 });
  if (["fluxo_caixa", "despesas"].includes(nome) && user.role !== "admin") return new Response("somente administradores", { status: 403 });
  const url = new URL(req.url);
  const from = url.searchParams.get("de") || addDays(todayISO(), -90), to = url.searchParams.get("ate") || todayISO();
  const { columns, rows } = await def.run(from, to);
  await q(`insert into draum.audit_log(user_id, entity, entity_id, action, data) values ($1,'report',$2,'exportar',$3)`, [user.userId, nome, JSON.stringify({ from, to, rows: rows.length })]);
  return new Response(toCsv(columns, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="draum-${nome}-${todayISO()}.csv"`, "Cache-Control": "no-store" },
  });
}
