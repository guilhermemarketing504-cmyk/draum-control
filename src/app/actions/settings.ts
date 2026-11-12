"use server";
import { act, formObj, type ActionResult } from "@/lib/action";
import { saveSettings, createUser, updateUser, changeOwnPassword } from "@/server/users";
import { getSettings } from "@/server/core";

export async function saveSettingsAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act(async (ctx) => {
    const cur = await getSettings();
    const fees: Record<string, number> = {};
    for (const k of Object.keys(cur.payment_fee_pct)) fees[k] = Number(o[`fee_${k}`] ?? 0);
    await saveSettings(ctx, {
      min_margin_pct: o.min_margin_pct, contingency_pct: o.contingency_pct, safety_reserve_fixed: o.safety_reserve_fixed ?? 0, tax_pct: o.tax_pct ?? 0,
      payment_fee_pct: fees, packaging_cost: o.packaging_cost ?? 0, delivery_cost_estimate: o.delivery_cost_estimate ?? 0,
      presale_buffer_days: o.presale_buffer_days, availability_valid_days: o.availability_valid_days, route_capacity_default: o.route_capacity_default,
      delivery_cutoff: { weekday: o.cutoff_weekday, hour: o.cutoff_hour },
      goals: { vip_members: o.g_vip, paid_orders: o.g_orders, paid_orders_deadline: o.g_deadline, avg_ticket: o.g_ticket, gross_revenue: o.g_revenue, contribution_margin_pct: o.g_margin, on_time_delivery_pct: o.g_ontime },
    });
  }, { message: "Configurações salvas." });
}
export async function createUserAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => createUser(ctx, { name: o.name, email: o.email, password: o.password, role: o.role }), { message: "Usuário criado." });
}
export async function updateUserAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => updateUser(ctx, Number(o.id), { role: o.role || undefined, active: o.active == null ? undefined : o.active === "true", password: o.password || undefined }), { message: "Usuário atualizado." });
}
export async function changePasswordAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => changeOwnPassword(ctx, o.current, o.next), { message: "Senha alterada." });
}
