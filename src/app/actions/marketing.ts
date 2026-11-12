"use server";
import { act, formObj, bool, num, type ActionResult } from "@/lib/action";
import { saveCampaign, savePromotion, saveAmbassador, shipToAmbassador, toggleShipmentContent } from "@/server/marketing";

export async function saveCampaignAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => saveCampaign(ctx, o.id ? Number(o.id) : null, { ...o, starts_on: o.starts_on ?? "", ends_on: o.ends_on ?? "", budget: o.budget ?? 0, spent: o.spent ?? 0 }), { message: "Campanha salva." });
}
export async function savePromotionAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  const tz = (v: string) => (v && v.length === 16 ? `${v}:00-03:00` : v);
  return act((ctx) => savePromotion(ctx, o.id ? Number(o.id) : null, {
    name: o.name, kind: o.kind, pct: o.pct, starts_at: tz(o.starts_at), ends_at: tz(o.ends_at), min_items: o.min_items ?? 1,
    all_products: bool(o.all_products), requires_vip: bool(o.requires_vip), coupon_code: o.coupon_code, campaign_id: o.campaign_id,
    active: bool(o.active), product_ids: (o.product_ids ?? []).map(Number),
  }), { message: "Promoção salva." });
}
export async function saveAmbassadorAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => saveAmbassador(ctx, o.id ? Number(o.id) : null, o), { message: "Embaixadora salva." });
}
export async function shipAmbassadorAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => shipToAmbassador(ctx, Number(o.ambassador_id), { variantId: Number(o.variant_id), qty: num(o.qty) ?? 1, sentOn: o.sent_on }), { message: "Envio registrado e estoque baixado." });
}
export async function toggleContentAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => toggleShipmentContent(ctx, Number(fd.get("id")), fd.get("value") === "true"), { message: "Atualizado." });
}
