"use server";
import { cookies } from "next/headers";
import { cartLines, placeStoreOrder, registerLead, isVipCode } from "@/server/store";
import { errorMessage } from "@/lib/action";
import { VIP_COOKIE, vipFromCookie } from "./vip";

// Ações públicas da loja: não exigem sessão. Preços e disponibilidade são sempre recalculados no servidor.
export async function cartAction(items: { variantId: number; qty: number }[]) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 30)
    .map((i) => ({ variantId: Math.trunc(Number(i?.variantId)), qty: Math.min(Math.max(Math.trunc(Number(i?.qty)) || 1, 1), 10) }))
    .filter((i) => i.variantId > 0);
  return cartLines(clean, await vipFromCookie());
}

export async function checkoutAction(input: unknown) {
  try {
    return { ok: true as const, ...(await placeStoreOrder(input, await vipFromCookie())) };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

/** Cadastro na lista de novidades (página inicial) */
export async function leadAction(input: unknown) {
  try {
    await registerLead(input, { vip: false });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

/** Acesso antecipado: cadastro + libera os preços VIP neste navegador */
export async function vipAccessAction(code: string, input: unknown) {
  try {
    if (!(await isVipCode(code))) return { ok: false as const, error: "Link de acesso inválido. Peça o link atualizado no grupo DRAUM PRIVATE ACCESS." };
    await registerLead(input, { vip: true });
    (await cookies()).set(VIP_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 21 });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
