import { BusinessError, Ctx, q, q1, round2, audit, todayISO, addDays, weekday, getSettings, Settings, requireAdmin } from "./core";
import { tx } from "@/lib/db";
import { dispatchOut, stockIn, reserve } from "./inventory";
import { recomputeOrderStatus } from "./orders";
import { advanceFunnel } from "./funnel";

/*
  DRAUM DELIVERY DAY
  - Pronta-entrega paga e CONCILIADA até quinta-feira 18h (configurável) pode entrar na rota da terça seguinte,
    desde que o item esteja conferido/embalado, o bairro seja elegível e a rota tenha capacidade.
  - Pré-venda só entra depois do recebimento e conferência da peça.
  - Custo real da rota é lançado no caixa e rateado entre os pedidos entregues, mesmo com frete grátis.
*/

/** Próximas N terças-feiras a partir de hoje (inclui hoje se for terça) */
export function nextTuesdays(n = 6, from = todayISO()) {
  let d = from;
  while (weekday(d) !== 2) d = addDays(d, 1);
  return Array.from({ length: n }, (_, i) => addDays(d, i * 7));
}

/** Prazo de corte (instante) para a rota de uma terça: quinta anterior às HH:00 em Belém (UTC−3) */
export function cutoffFor(routeDate: string, s: Pick<Settings, "delivery_cutoff">) {
  const wd = s.delivery_cutoff?.weekday ?? 4;
  let back = (2 - wd + 7) % 7; if (back === 0) back = 7;
  const day = addDays(routeDate, -back);
  const hh = String(s.delivery_cutoff?.hour ?? 18).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00-03:00`);
}

/** Primeira terça elegível para um pedido pago em `paidAt` */
export function firstEligibleTuesday(paidAt: Date, s: Pick<Settings, "delivery_cutoff">) {
  for (const t of nextTuesdays(4, todayISO(paidAt))) if (paidAt <= cutoffFor(t, s)) return t;
  return null;
}

/** Pedidos aptos para uma rota (com motivo quando não aptos) */
export async function routeCandidates(routeDate: string) {
  const s = await getSettings();
  const cutoff = cutoffFor(routeDate, s);
  const zones = await q<{ neighborhood: string; eligible: boolean }>(`select neighborhood, eligible from draum.delivery_zones`);
  const zoneOk = (n: string | null) => !!n && zones.some((z) => z.eligible && z.neighborhood.toLowerCase().trim() === n.toLowerCase().trim());
  const orders = await q<any>(
    `select o.id, o.number, o.paid_at, o.neighborhood, o.address, o.promised_date, c.name as customer_name, c.whatsapp,
            json_agg(json_build_object('id', oi.id, 'mode', oi.mode, 'status', oi.status, 'sku', v.sku, 'qty', oi.qty, 'name', p.name) order by oi.id) as items,
            (select r.route_date from draum.delivery_stops ds join draum.delivery_routes r on r.id = ds.route_id
               where ds.order_id = o.id and ds.status in ('planejada','em_rota') and r.status in ('planejada','em_rota') limit 1) as in_route
       from draum.orders o join draum.customers c on c.id = o.customer_id
       join draum.order_items oi on oi.order_id = o.id
       join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id
      where o.fulfillment = 'entrega_local' and o.status not in ('cancelado','entregue','finalizado','aguardando_pagamento')
      group by o.id, c.name, c.whatsapp order by o.paid_at`);
  return orders.map((o) => {
    const ready = o.items.filter((i: any) =>
      (i.mode === "pronta" && ["reservado", "embalado", "pronto"].includes(i.status)) || (i.mode === "pre" && ["recebido", "embalado", "pronto"].includes(i.status)));
    const reasons: string[] = [];
    if (!o.paid_at) reasons.push("pagamento não conciliado");
    else if (new Date(o.paid_at) > cutoff && !o.items.every((i: any) => i.mode === "pre")) reasons.push(`pago após o corte (${cutoff.toLocaleString("pt-BR", { timeZone: "America/Belem" })})`);
    if (!zoneOk(o.neighborhood)) reasons.push(`bairro "${o.neighborhood ?? "—"}" fora das regiões elegíveis`);
    if (!ready.length) reasons.push("nenhum item disponível (pré-venda aguardando recebimento)");
    if (o.in_route) reasons.push(`já programado para ${o.in_route}`);
    return { ...o, readyItems: ready, eligible: reasons.length === 0, reasons, partial: ready.length > 0 && ready.length < o.items.filter((i: any) => !["entregue", "cancelado", "devolvido", "trocado"].includes(i.status)).length };
  });
}

export async function createRoute(ctx: Ctx, input: { routeDate: string; driver?: string; capacity?: number; notes?: string }) {
  if (weekday(input.routeDate) !== 2) throw new BusinessError("O DRAUM DELIVERY DAY acontece às terças-feiras.");
  if (input.routeDate < todayISO()) throw new BusinessError("Data no passado.");
  const s = await getSettings();
  return tx(async (c) => {
    const r = await q1<{ id: number }>(`insert into draum.delivery_routes(route_date, driver, capacity, notes) values ($1,$2,$3,$4) returning id`,
      [input.routeDate, input.driver || null, input.capacity || s.route_capacity_default, input.notes || null], c);
    await audit(c, ctx, "route", r!.id, "criar", input);
    return r!;
  });
}

export async function addStops(ctx: Ctx, routeId: number, orderIds: number[]) {
  return tx(async (c) => {
    const route = await q1<any>(`select * from draum.delivery_routes where id=$1 for update`, [routeId], c);
    if (!route || route.status !== "planejada") throw new BusinessError("Rota não está em planejamento.");
    const cands = await routeCandidates(route.route_date);
    const count = (await q1<{ n: number }>(`select count(*) n from draum.delivery_stops where route_id=$1 and status<>'cancelada'`, [routeId], c))!.n;
    if (count + orderIds.length > route.capacity) throw new BusinessError(`A rota comporta ${route.capacity} entregas (já há ${count}).`);
    for (const id of orderIds) {
      const cand = cands.find((x) => x.id === id);
      if (!cand) throw new BusinessError(`Pedido ${id} não é de entrega local ou não está em andamento.`);
      if (!cand.eligible) throw new BusinessError(`${cand.number}: ${cand.reasons.join("; ")}.`);
      const o = await q1<any>(`select o.*, c.name, c.whatsapp from draum.orders o join draum.customers c on c.id=o.customer_id where o.id=$1`, [id], c);
      const stop = await q1<{ id: number }>(`insert into draum.delivery_stops(route_id, order_id, seq, recipient, phone) values ($1,$2,$3,$4,$5) returning id`,
        [routeId, id, count + 1, o.name, o.whatsapp], c);
      for (const it of cand.readyItems) await c.query(`insert into draum.delivery_stop_items(stop_id, order_item_id) values ($1,$2)`, [stop!.id, it.id]);
    }
    await audit(c, ctx, "route", routeId, "adicionar_paradas", { orderIds });
  });
}

export async function updateStop(ctx: Ctx, stopId: number, data: { seq?: number; window_label?: string }) {
  await tx(async (c) => {
    await c.query(`update draum.delivery_stops set seq=coalesce($2,seq), window_label=coalesce($3,window_label) where id=$1`, [stopId, data.seq ?? null, data.window_label ?? null]);
    await audit(c, ctx, "stop", stopId, "editar", data);
  });
}

export async function removeStop(ctx: Ctx, stopId: number) {
  await tx(async (c) => {
    const st = await q1<any>(`select ds.*, r.status as route_status from draum.delivery_stops ds join draum.delivery_routes r on r.id=ds.route_id where ds.id=$1`, [stopId], c);
    if (!st || st.route_status !== "planejada") throw new BusinessError("Só é possível remover paradas de rotas em planejamento.");
    await c.query(`delete from draum.delivery_stops where id=$1`, [stopId]);
    await audit(c, ctx, "stop", stopId, "remover");
  });
}

/** Saída da rota: exige itens conferidos e embalados; baixa estoque físico e reservado. */
export async function startRoute(ctx: Ctx, routeId: number) {
  return tx(async (c) => {
    const route = await q1<any>(`select * from draum.delivery_routes where id=$1 for update`, [routeId], c);
    if (!route || route.status !== "planejada") throw new BusinessError("Rota não está em planejamento.");
    const items = await q<any>(
      `select oi.*, o.number, ds.id as stop_id from draum.delivery_stops ds join draum.delivery_stop_items si on si.stop_id = ds.id
         join draum.order_items oi on oi.id = si.order_item_id join draum.orders o on o.id = oi.order_id
        where ds.route_id=$1 and ds.status='planejada' for update of oi`, [routeId], c);
    if (!items.length) throw new BusinessError("Rota sem paradas.");
    const notReady = items.filter((i) => i.status !== "pronto");
    if (notReady.length) throw new BusinessError(`Conferência/embalagem pendente: ${[...new Set(notReady.map((i) => i.number))].join(", ")}.`);
    for (const it of items) {
      await dispatchOut(c, it.variant_id, it.qty, it.id, ctx.userId, `Rota ${route.route_date}`);
      await c.query(`update draum.order_items set status='em_rota' where id=$1`, [it.id]);
    }
    await c.query(`update draum.delivery_stops set status='em_rota' where route_id=$1 and status='planejada'`, [routeId]);
    await c.query(`update draum.delivery_routes set status='em_rota' where id=$1`, [routeId]);
    for (const o of new Set(items.map((i) => i.order_id))) await recomputeOrderStatus(c, o);
    await audit(c, ctx, "route", routeId, "iniciar");
  });
}

export async function completeStop(ctx: Ctx, stopId: number, input: { delivered: boolean; proof?: string; occurrence?: string }) {
  if (input.delivered && !input.proof?.trim()) throw new BusinessError("Informe o comprovante (nome de quem recebeu ou link da foto).");
  if (!input.delivered && !input.occurrence?.trim()) throw new BusinessError("Descreva a ocorrência.");
  return tx(async (c) => {
    const st = await q1<any>(`select * from draum.delivery_stops where id=$1 for update`, [stopId], c);
    if (!st || st.status !== "em_rota") throw new BusinessError("Parada não está em rota.");
    const items = await q<any>(`select oi.* from draum.delivery_stop_items si join draum.order_items oi on oi.id = si.order_item_id where si.stop_id=$1`, [stopId], c);
    if (input.delivered) {
      for (const it of items) await c.query(`update draum.order_items set status='entregue', delivered_at=now() where id=$1`, [it.id]);
      await c.query(`update draum.delivery_stops set status='entregue', proof=$2, occurrence=$3, delivered_at=now() where id=$1`, [stopId, input.proof, input.occurrence || null]);
      const o = await q1<any>(`select customer_id from draum.orders where id=$1`, [st.order_id], c);
      await advanceFunnel(c, o.customer_id, "pos_venda");
    } else {
      // Mercadoria volta: entra de novo no físico e reservada para o mesmo pedido
      for (const it of items) {
        await stockIn(c, it.variant_id, it.qty, Number(it.unit_cost), { userId: ctx.userId, note: "Retorno de rota (entrega não realizada)", type: "devolucao" });
        await reserve(c, it.variant_id, it.qty, it.id, ctx.userId);
        await c.query(`update draum.order_items set status='pronto' where id=$1`, [it.id]);
      }
      await c.query(`update draum.delivery_stops set status='falhou', occurrence=$2 where id=$1`, [stopId, input.occurrence]);
    }
    await recomputeOrderStatus(c, st.order_id);
    await audit(c, ctx, "stop", stopId, input.delivered ? "entregue" : "falhou", input);
  });
}

/** Fecha a rota com o custo real: lança saída no caixa, rateia e liquida as obrigações de entrega. */
export async function closeRoute(ctx: Ctx, routeId: number, actualCost: number) {
  requireAdmin(ctx);
  if (!(actualCost >= 0)) throw new BusinessError("Informe o custo real da rota (combustível, entregador etc.).");
  return tx(async (c) => {
    const route = await q1<any>(`select * from draum.delivery_routes where id=$1 for update`, [routeId], c);
    if (!route || route.status !== "em_rota") throw new BusinessError("Rota não está em andamento.");
    const pending = (await q1<{ n: number }>(`select count(*) n from draum.delivery_stops where route_id=$1 and status='em_rota'`, [routeId], c))!.n;
    if (pending) throw new BusinessError(`Ainda há ${pending} parada(s) sem baixa.`);
    let entryId: number | null = null;
    if (actualCost > 0) {
      const e = await q1<{ id: number }>(`insert into draum.cash_entries(direction, category, amount, description, reconciled, delivery_route_id, created_by)
          values ('saida','frete_entrega',$1,$2,true,$3,$4) returning id`, [round2(actualCost), `Rota DELIVERY DAY ${route.route_date}`, routeId, ctx.userId], c);
      entryId = e!.id;
    }
    const stops = await q<any>(`select * from draum.delivery_stops where route_id=$1 and status in ('entregue','falhou')`, [routeId], c);
    const per = stops.length ? round2(actualCost / stops.length) : 0;
    for (const st of stops) {
      await c.query(`update draum.delivery_stops set allocated_cost=$2 where id=$1`, [st.id, per]);
      if (st.status === "entregue")
        await c.query(`update draum.obligations set status='liquidada', settled_at=now(), settled_by_entry=$2 where order_id=$1 and kind='entrega' and status='aberta'`, [st.order_id, entryId]);
    }
    await c.query(`update draum.delivery_routes set status='concluida', actual_cost=$2 where id=$1`, [routeId, round2(actualCost)]);
    await audit(c, ctx, "route", routeId, "concluir", { actualCost, perStop: per });
  });
}

export async function listRoutes() {
  return q<any>(`select r.*, (select count(*) from draum.delivery_stops s where s.route_id=r.id and s.status<>'cancelada') stops,
      (select count(*) from draum.delivery_stops s where s.route_id=r.id and s.status='entregue') delivered
      from draum.delivery_routes r order by r.route_date desc`);
}

export async function getRoute(id: number) {
  const route = await q1<any>(`select * from draum.delivery_routes where id=$1`, [id]);
  if (!route) return null;
  const stops = await q<any>(`select ds.*, o.number, o.address, o.neighborhood, o.id as order_id,
      (select json_agg(json_build_object('id', oi.id, 'sku', v.sku, 'qty', oi.qty, 'status', oi.status, 'name', p.name))
         from draum.delivery_stop_items si join draum.order_items oi on oi.id = si.order_item_id
         join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id where si.stop_id = ds.id) as items
      from draum.delivery_stops ds join draum.orders o on o.id = ds.order_id where ds.route_id=$1 order by o.neighborhood, ds.seq`, [id]);
  return { route, stops };
}

export async function saveZone(ctx: Ctx, input: { neighborhood: string; eligible: boolean; notes?: string }) {
  requireAdmin(ctx);
  if (!input.neighborhood?.trim()) throw new BusinessError("Informe o bairro.");
  await tx(async (c) => {
    await c.query(`insert into draum.delivery_zones(neighborhood, eligible, notes) values ($1,$2,$3)
       on conflict (neighborhood) do update set eligible = excluded.eligible, notes = excluded.notes`, [input.neighborhood.trim(), input.eligible, input.notes || null]);
    await audit(c, ctx, "zone", input.neighborhood, "salvar", input);
  });
}
export async function deleteZone(ctx: Ctx, id: number) {
  requireAdmin(ctx);
  await tx(async (c) => { await c.query(`delete from draum.delivery_zones where id=$1`, [id]); await audit(c, ctx, "zone", id, "remover"); });
}
export const listZones = () => q<any>(`select * from draum.delivery_zones order by neighborhood`);
