"use server";
import { act, formObj, num, bool, type ActionResult } from "@/lib/action";
import { createRoute, addStops, startRoute, completeStop, closeRoute, updateStop, removeStop, saveZone, deleteZone } from "@/server/delivery";

export async function createRouteAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => createRoute(ctx, { routeDate: o.route_date, driver: o.driver, capacity: num(o.capacity), notes: o.notes }), { message: "Rota criada." });
}
export async function addStopsAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => addStops(ctx, Number(o.route_id), (o.orders ?? []).map(Number)), { message: "Pedidos adicionados à rota." });
}
export async function startRouteAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => startRoute(ctx, Number(fd.get("route_id"))), { message: "Rota iniciada: estoque baixado." });
}
export async function completeStopAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => completeStop(ctx, Number(o.stop_id), { delivered: o.result === "entregue", proof: o.proof, occurrence: o.occurrence }), { message: "Parada registrada." });
}
export async function closeRouteAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => closeRoute(ctx, Number(o.route_id), num(o.actual_cost) ?? NaN), { message: "Rota concluída e custo lançado." });
}
export async function updateStopAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => updateStop(ctx, Number(o.stop_id), { seq: num(o.seq), window_label: o.window_label }), { message: "Parada atualizada." });
}
export async function removeStopAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => removeStop(ctx, Number(fd.get("stop_id"))), { message: "Parada removida." });
}
export async function saveZoneAction(_: ActionResult | null, fd: FormData) {
  const o = formObj(fd);
  return act((ctx) => saveZone(ctx, { neighborhood: o.neighborhood, eligible: bool(o.eligible), notes: o.notes }), { message: "Bairro salvo." });
}
export async function deleteZoneAction(_: ActionResult | null, fd: FormData) {
  return act((ctx) => deleteZone(ctx, Number(fd.get("id"))), { message: "Bairro removido." });
}
