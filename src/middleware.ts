import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Primeira barreira: sem sessão válida, nada além de /login e /setup.
// A verificação definitiva (usuário ativo, perfil) acontece no servidor em cada página e ação.
const PUBLIC = ["/login", "/setup", "/api/health", "/api/mft/", "/loja", "/brand", "/_next", "/favicon", "/icon"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
