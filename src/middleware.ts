import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Primeira barreira: sem sessão válida, nada além de /login e /setup.
// A verificação definitiva (usuário ativo, perfil) acontece no servidor em cada página e ação.
const PUBLIC = ["/login", "/setup", "/api/health", "/api/mft/", "/api/infinitepay/", "/loja", "/brand", "/_next", "/favicon", "/icon"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (process.env.STORE_PREVIEW === "1" && pathname.startsWith("/loja") && (req.nextUrl.searchParams.has("agora") || req.nextUrl.searchParams.has("vip"))) {
    // Prévia de aprovação: ?agora=2026-11-24T00:00-03:00 simula a data; ?vip=1|0 alterna a visão do grupo
    const url = req.nextUrl.clone();
    const agora = url.searchParams.get("agora"), vip = url.searchParams.get("vip");
    url.searchParams.delete("agora"); url.searchParams.delete("vip");
    const res = NextResponse.redirect(url);
    if (agora != null) agora ? res.cookies.set("draum_preview_agora", agora, { path: "/" }) : res.cookies.delete("draum_preview_agora");
    if (vip != null) res.cookies.set("draum_preview_vip", vip === "1" ? "1" : "0", { path: "/" });
    return res;
  }
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const token = req.cookies.get("draum_session")?.value;
  let ok = false;
  if (token && process.env.SESSION_SECRET) {
    try { await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET)); ok = true; } catch {}
  }
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
