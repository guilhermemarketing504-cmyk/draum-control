"use server";
import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";
import { verifyLogin, createUser, countUsers } from "@/server/users";
import { errorMessage, type ActionResult } from "@/lib/action";

// Limite simples de tentativas por e-mail (memória do processo)
const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "").toLowerCase().trim();
  const a = attempts.get(email);
  if (a && a.until > Date.now()) return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos.", at: Date.now() };
  const user = await verifyLogin(email, String(fd.get("password") ?? ""));
  if (!user) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(email, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return { ok: false, error: "E-mail ou senha inválidos.", at: Date.now() };
  }
  attempts.delete(email);
  await createSession(user);
  redirect("/");
}

export async function setupAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    if ((await countUsers()) > 0) return { ok: false, error: "O sistema já foi configurado.", at: Date.now() };
    const u = await createUser(null, { name: String(fd.get("name")), email: String(fd.get("email")), password: String(fd.get("password")), role: "admin" });
    await createSession({ id: u.id, role: "admin" });
  } catch (e) { return { ok: false, error: errorMessage(e), at: Date.now() }; }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
