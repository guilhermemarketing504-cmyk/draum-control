import { syncMft } from "@/server/mft";
import { errorMessage } from "@/lib/action";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Disparo agendado do robô da MFT: POST /api/mft/sync com "Authorization: Bearer $MFT_SYNC_TOKEN"
export async function POST(req: Request) {
  const token = process.env.MFT_SYNC_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (!token || token.length < 24 || auth !== `Bearer ${token}`) return Response.json({ error: "não autorizado" }, { status: 401 });
  try {
    const r = await syncMft(null);
    return Response.json({ ok: true, ...r, errors: r.errors.slice(0, 10) });
  } catch (e) {
    return Response.json({ ok: false, error: errorMessage(e) }, { status: 500 });
  }
}
