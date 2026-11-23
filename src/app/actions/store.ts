"use server";
import { act, formObj, bool, type ActionResult } from "@/lib/action";
import { saveStoreSettings } from "@/server/store";
import { syncMft, saveMftCosts, isSyncRunning } from "@/server/mft";
import { requireAdmin, BusinessError } from "@/server/core";
import { addProductImage, removeProductImage } from "@/server/images";

export async function saveStoreSettingsAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => saveStoreSettings(ctx, {
    whatsapp: o.whatsapp, margin_pct: o.margin_pct, price_ending: o.price_ending ?? 0, mft_lead_days: o.mft_lead_days, mft_enabled: bool(o.mft_enabled),
    infinitepay_handle: o.infinitepay_handle ?? "",
  }), { message: "Loja atualizada." });
}

export async function syncMftAction(_: ActionResult | null, _fd: FormData) {
  // Roda em segundo plano: a leitura completa da MFT leva alguns minutos por causa do limite de acessos do site
  return act(async (ctx) => {
    requireAdmin(ctx);
    if (isSyncRunning()) throw new BusinessError("Já existe uma sincronização em andamento. Atualize a página em alguns minutos.");
    void syncMft(ctx).catch((e) => console.error("[mft] sincronização manual:", (e as Error).message));
  }, { message: "Sincronização iniciada. Leva de 4 a 6 minutos; atualize a página para ver o resultado." });
}

export async function saveMftCostsAction(_: ActionResult | null, fd: FormData) {
  const costs: { productId: number; cost: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^cost_(\d+)$/);
    if (!m || typeof v !== "string" || v.trim() === "") continue;
    costs.push({ productId: Number(m[1]), cost: Number(v.replace(",", ".")) });
  }
  return act((ctx) => saveMftCosts(ctx, costs), { message: "Custos salvos e preços recalculados." });
}

export async function addProductImageAction(input: { productId: number; color: string | null; dataUrl: string }) {
  return act((ctx) => addProductImage(ctx, input), { message: "Foto adicionada." });
}

export async function removeProductImageAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => removeProductImage(ctx, Number(o.id)), { message: "Foto removida." });
}
