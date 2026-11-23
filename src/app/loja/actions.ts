"use server";
import { cartLines, placeStoreOrder } from "@/server/store";
import { errorMessage } from "@/lib/action";

// Ações públicas da loja: não exigem sessão. Preços e disponibilidade são sempre recalculados no servidor.
export async function cartAction(items: { variantId: number; qty: number }[]) {
  const clean = (Array.isArray(items) ? items : []).slice(0, 30)
    .map((i) => ({ variantId: Math.trunc(Number(i?.variantId)), qty: Math.min(Math.max(Math.trunc(Number(i?.qty)) || 1, 1), 10) }))
    .filter((i) => i.variantId > 0);
  return cartLines(clean);
}

export async function checkoutAction(input: unknown) {
  try {
    return { ok: true as const, ...(await placeStoreOrder(input)) };
  } catch (e) {
    return { ok: false as const, error: errorMessage(e) };
  }
}
