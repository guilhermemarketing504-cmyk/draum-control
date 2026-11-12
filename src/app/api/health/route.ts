import { q1 } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await q1("select 1"); return Response.json({ ok: true, db: "ok" }); }
  catch { return Response.json({ ok: false, db: "indisponível" }, { status: 503 }); }
}
