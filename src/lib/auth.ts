import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { getActiveUser } from "@/server/users";
import type { Ctx, Role } from "@/server/core";

export const SESSION_COOKIE = "draum_session";
const MAX_AGE = 60 * 60 * 12; // 12 horas

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ausente ou curto (mínimo 32 caracteres).");
  return new TextEncoder().encode(s);
}

export async function createSession(user: { id: number; role: Role }) {
  const token = await new SignJWT({ role: user.role }).setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id)).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true", path: "/", maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export interface SessionUser extends Ctx { name: string; email: string }

/** Lê a sessão e confirma no banco que o usuário continua ativo (e com o perfil atual). */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const u = await getActiveUser(Number(payload.sub));
    if (!u) return null;
    return { userId: u.id, role: u.role, name: u.name, email: u.email };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdminPage(): Promise<SessionUser> {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/?negado=1");
  return s;
}
