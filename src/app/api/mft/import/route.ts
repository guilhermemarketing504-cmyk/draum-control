import { importMftFromBrowser, checkImportToken, isSyncRunning } from "@/server/mft";
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
  if (isSyncRunning()) return Response.json({ ok: false, error: "já existe uma atualização em andamento; tente de novo em alguns minutos" }, { status: 409, headers: CORS });
  // Processa em segundo plano: gravar 150+ peças leva alguns minutos e a aba da MFT não precisa ficar esperando
  const total = Array.isArray(body?.items) ? body.items.length : 0;
  void importMftFromBrowser(body).catch((e) => console.error("[mft] importação pelo navegador:", errorMessage(e)));
  return Response.json({ ok: true, accepted: true, total }, { headers: CORS });
}
