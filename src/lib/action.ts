import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { BusinessError } from "@/server/core";
import { getSession } from "./auth";
import type { SessionUser } from "./auth";

export interface ActionResult { ok: boolean; error?: string; message?: string; data?: any; at: number }

/** Executa uma ação de negócio com sessão validada no servidor e erros legíveis. */
export async function act(fn: (ctx: SessionUser) => Promise<any>, opts: { revalidate?: string[]; message?: string; redirect?: (data: any) => string } = {}): Promise<ActionResult> {
  const ctx = await getSession();
  if (!ctx) return { ok: false, error: "Sessão expirada. Entre novamente.", at: Date.now() };
  let data: any;
  try {
    data = await fn(ctx);
    (opts.revalidate ?? ["/"]).forEach((p) => revalidatePath(p, "layout"));
  } catch (e: any) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  if (opts.redirect) redirect(opts.redirect(data));
  return { ok: true, data, message: opts.message ?? "Salvo.", at: Date.now() };
}

export function errorMessage(e: any): string {
  if (e instanceof BusinessError) return e.message;
  if (e instanceof ZodError) return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join(" · ");
  if (e?.code === "23505") return "Registro duplicado: já existe um cadastro com esse identificador.";
  if (e?.code === "23514") return "Operação recusada por uma regra de consistência do banco.";
  console.error(e);
  return "Erro inesperado. Nada foi alterado. Tente novamente ou verifique os registros.";
}

/** FormData → objeto (checkbox "on" → true; campos vazios → null) */
export function formObj(fd: FormData): Record<string, any> {
  const o: Record<string, any> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? v.trim() : v;
    if (k.endsWith("[]")) { (o[k.slice(0, -2)] ??= []).push(val); continue; }
    o[k] = val === "on" ? true : val === "" ? null : val;
  }
  return o;
}
export const bool = (v: any) => v === true || v === "on" || v === "true";
export const num = (v: any) => (v == null || v === "" ? undefined : Number(String(v).replace(",", ".")));
