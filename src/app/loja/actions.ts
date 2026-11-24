"use server";
import { cookies, headers } from "next/headers";
import { createPaymentLink } from "@/server/infinitepay";
import { cartLines, placeStoreOrder, registerLead, isVipCode } from "@/server/store";
import { errorMessage } from "@/lib/action";
import { VIP_COOKIE, vipFromCookie, storeClock, PREVIEW } from "./vip";

const PREVIEW_BLOCK = { ok: false as const, error: "Prévia de aprovação: compras e cadastros estão desligados aqui." };

// Ações públicas da loja: não exigem sessão. Preços e disponibilidade são sempre recalculados no servidor.
export async function cartAction(items: { variantId: number; qty: number }[]) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 30)
    .map((i) => ({ variantId: Math.trunc(Number(i?.variantId)), qty: Math.min(Math.max(Math.trunc(Number(i?.qty)) || 1, 1), 10) }))
    .filter((i) => i.variantId > 0);
  return cartLines(clean, await vipFromCookie(), await storeClock());
}

async function baseUrl() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function checkoutAction(input: unknown) {
  if (PREVIEW) return PREVIEW_BLOCK;
  let order;
  try {
    order = await placeStoreOrder(input, await vipFromCookie());
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
  // Pagamento online (Pix ou cartão): se o link falhar, a cliente segue pelo WhatsApp com o pedido já criado
  if ((input as any)?.payOnline) {
    try {
      return { ok: true as const, ...order, paymentUrl: await createPaymentLink(order.number, await baseUrl()) };
    } catch (e) {
      return { ok: true as const, ...order, paymentUrl: null, paymentError: errorMessage(e) };
    }
  }
  return { ok: true as const, ...order, paymentUrl: null };
}

/** Cadastro na lista de novidades (página inicial) */
export async function leadAction(input: unknown) {
  if (PREVIEW) return PREVIEW_BLOCK;
  try {
    await registerLead(input, { vip: false });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}

/** Acesso antecipado: cadastro + libera os preços VIP neste navegador */
export async function vipAccessAction(code: string, input: unknown) {
  if (PREVIEW) return PREVIEW_BLOCK;
  try {
    if (!(await isVipCode(code))) return { ok: false as const, error: "Link de acesso inválido. Peça o link atualizado no grupo DRAUM PRIVATE ACCESS." };
    await registerLead(input, { vip: true });
    (await cookies()).set(VIP_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 21 });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
