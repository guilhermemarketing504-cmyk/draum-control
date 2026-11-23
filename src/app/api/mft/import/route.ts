import { importMftFromBrowser, checkImportToken } from "@/server/mft";
import { errorMessage } from "@/lib/action";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Recebe o catálogo lido pelo favorito no site da MFT (origem: navegador do revendedor)
const CORS = { "Access-Control-Allow-Origin": "https://www.mftmoodrevenda.com.br", Vary: "Origin" };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" } });
}

export async function POST(req: Request) {
  let body: any;
  try {
    const text = await req.text();
    if (text.length > 8_000_000) return Response.json({ ok: false, error: "envio grande demais" }, { status: 413, headers: CORS });
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "envio inválido" }, { status: 400, headers: CORS });
  }
  if (!(await checkImportToken(body?.token))) return Response.json({ ok: false, error: "favorito sem autorização: pegue o favorito de novo no CONTROL" }, { status: 401, headers: CORS });
  try {
    const r = await importMftFromBrowser(body);
    return Response.json({ ok: true, seen: r.seen, created: r.created, paused: r.paused, costs: r.costs ?? 0, withoutCost: r.withoutCost, errors: r.errors.slice(0, 10) }, { headers: CORS });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500, headers: CORS });
  }
}
