import { q, q1, round2, todayISO, addDays, getSettings, pendingSettings } from "./core";
import { cashPosition, financialIndicators } from "./finance";
import { computeMargin } from "./pricing";
import { nextTuesdays } from "./delivery";
import { crmMetrics } from "./crm";
import { listPresales } from "./presales";

export interface DashFilters { from: string; to: string; productId?: number; supplierId?: number; mode?: "pronta" | "pre" }

/** Cláusula de filtro em nível de item (produto, fornecedor, modalidade) */
function itemFilter(f: DashFilters, params: unknown[], alias = "oi") {
  const w: string[] = [];
  if (f.productId) { params.push(f.productId); w.push(`v.product_id = $${params.length}`); }
  if (f.supplierId) { params.push(f.supplierId); w.push(`(${alias}.supplier_id = $${params.length} or exists (select 1 from draum.product_suppliers ps where ps.product_id = v.product_id and ps.supplier_id = $${params.length} and ps.is_primary))`); }
  if (f.mode) { params.push(f.mode); w.push(`${alias}.mode = $${params.length}`); }
  return w.length ? " and " + w.join(" and ") : "";
}

export async function dashboard(f: DashFilters) {
  const s = await getSettings();
  const today = todayISO();
  const p1: unknown[] = [f.from, f.to];
  const filt = itemFilter(f, p1);
  const filtered = !!(f.productId || f.supplierId || f.mode);

  // Linhas de venda do período (pedidos não cancelados)
  const lines = await q<any>(
    `select o.id as order_id, o.created_at, o.paid_at, o.status, o.payment_method, o.fulfillment, o.shipping_charged,
            o.subtotal - o.discount_total as order_net,
            (select coalesce(sum(amount),0) from draum.payments pm where pm.order_id=o.id and pm.status='conciliado') as order_paid,
            (select coalesce(sum(fee_amount),0) from draum.payments pm where pm.order_id=o.id and pm.status='conciliado') as order_fee,
            oi.id, oi.mode, oi.qty, oi.unit_price, oi.discount, oi.total, oi.unit_cost, oi.status as item_status, oi.delivered_at,
            p.id as product_id, p.name as product_name, p.category
       from draum.orders o join draum.order_items oi on oi.order_id = o.id
       join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id
      where o.status <> 'cancelado' and oi.status not in ('cancelado','trocado')
        and o.created_at >= $1::date and o.created_at < $2::date + 1 ${filt}`, p1);

  const orders = new Map<number, any>();
  for (const l of lines) {
    if (!orders.has(l.order_id)) orders.set(l.order_id, { ...l, lines: [] as any[] });
    orders.get(l.order_id).lines.push(l);
  }
  const all = [...orders.values()];
  const paid = all.filter((o) => o.paid_at);
  const gross = round2(lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0));
  const net = round2(lines.reduce((a, l) => a + Number(l.total), 0));
  // recebido proporcional à participação das linhas filtradas no pedido
  const received = round2(all.reduce((a, o) => {
    const share = Number(o.order_net) > 0 ? o.lines.reduce((x: number, l: any) => x + Number(l.total), 0) / Number(o.order_net) : 0;
    return a + Math.min(Number(o.order_paid), Number(o.order_net)) * share;
  }, 0));
  let marginSum = 0, marginNet = 0;
  for (const o of paid) {
    const m = computeMargin({
      lines: o.lines.map((l: any) => ({ qty: l.qty, unitPrice: Number(l.unit_price), discount: Number(l.discount), unitCost: Number(l.unit_cost) })),
      paymentMethod: o.payment_method, fulfillment: o.fulfillment, shippingCharged: filtered ? 0 : Number(o.shipping_charged),
      actualFee: filtered ? null : Number(o.order_fee),
    }, s);
    marginSum += m.margin; marginNet += m.netRevenue;
  }
  const paidNet = round2(paid.reduce((a, o) => a + o.lines.reduce((x: number, l: any) => x + Number(l.total), 0), 0));
  const cogsDelivered = round2(lines.filter((l) => l.item_status === "entregue").reduce((a, l) => a + l.qty * Number(l.unit_cost), 0));

  const fin = await financialIndicators(f.from, f.to);
  const cash = await cashPosition();
  const stock = await q1<any>(`select coalesce(sum(qty_physical),0) units, coalesce(sum(qty_physical * avg_cost),0) value,
      coalesce(sum(qty_reserved),0) reserved, coalesce(sum(qty_in_transit),0) transit,
      count(*) filter (where min_qty > 0 and qty_physical - qty_reserved <= min_qty) low from draum.inventory i join draum.product_variants v on v.id=i.variant_id where v.active`);
  const presalesWaiting = await q1<any>(`select count(*) filter (where status='aguardando_compra') to_buy, count(*) filter (where status='comprado') bought
      from draum.order_items where mode='pre'`);
  const readyOrders = await q1<{ n: number }>(`select count(distinct order_id) n from draum.order_items oi join draum.orders o on o.id=oi.order_id where oi.status='pronto' and o.status<>'cancelado'`);
  const nextTue = nextTuesdays(1)[0];
  const tuesday = await q1<any>(`select count(*) n from draum.delivery_stops ds join draum.delivery_routes r on r.id=ds.route_id where r.route_date=$1 and ds.status<>'cancelada'`, [nextTue]);
  const late = await q1<{ n: number }>(`select count(distinct o.id) n from draum.orders o join draum.order_items oi on oi.order_id=o.id
      where o.status not in ('cancelado','entregue','finalizado') and oi.status not in ('entregue','cancelado','devolvido','trocado')
        and coalesce(oi.customer_promised_date, o.promised_date) < $1`, [today]);
  const crm = await crmMetrics();

  // ───────── Séries ─────────
  const days: string[] = []; for (let d = f.from; d <= f.to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(days.map((d) => [d, { date: d, faturamento: 0, recebido: 0, pedidos: 0 }]));
  for (const l of lines) { const d = todayISO(new Date(l.created_at)); const x = byDay.get(d); if (x) x.faturamento = round2(x.faturamento + l.qty * Number(l.unit_price)); }
  for (const o of all) { const d = todayISO(new Date(o.created_at)); const x = byDay.get(d); if (x) x.pedidos++; }
  const rec = await q<any>(`select to_char(reconciled_at at time zone 'America/Belem','YYYY-MM-DD') d, sum(amount) s from draum.payments where status='conciliado' and reconciled_at >= $1::date and reconciled_at < $2::date + 1 group by 1`, [f.from, f.to]);
  rec.forEach((r) => { const x = byDay.get(r.d); if (x) x.recebido = round2(Number(r.s)); });
  let cum = 0;
  const revenueSeries = [...byDay.values()].map((x) => ({ ...x, acumulado: round2((cum += x.faturamento)) }));

  const modeCount = { pronta: 0, pre: 0, misto: 0 };
  for (const o of all) { const m = new Set(o.lines.map((l: any) => l.mode)); if (m.size > 1) modeCount.misto++; else if (m.has("pre")) modeCount.pre++; else modeCount.pronta++; }

  const prodMap = new Map<string, { name: string; qty: number; net: number; cost: number }>();
  const catMap = new Map<string, number>();
  for (const l of lines) {
    const k = l.product_name;
    if (!prodMap.has(k)) prodMap.set(k, { name: k, qty: 0, net: 0, cost: 0 });
    const x = prodMap.get(k)!; x.qty += l.qty; x.net += Number(l.total); x.cost += l.qty * Number(l.unit_cost);
    catMap.set(l.category, round2((catMap.get(l.category) ?? 0) + Number(l.total)));
  }
  const products = [...prodMap.values()].map((x) => ({ ...x, net: round2(x.net), marginPct: x.net > 0 ? round2(((x.net - x.cost) / x.net) * 100) : 0 }));

  const flows = await q<any>(`select to_char(date_trunc('week', occurred_on),'YYYY-MM-DD') wk,
      coalesce(sum(amount) filter (where direction='entrada' and reconciled),0) entradas, coalesce(sum(amount) filter (where direction='saida'),0) saidas
      from draum.cash_entries where occurred_on between $1 and $2 group by 1 order by 1`, [f.from, f.to]);
  let vipCum = 0;
  const vipSeries = crm.vipGrowth.map((g: any) => ({ semana: g.wk, membros: (vipCum += Number(g.n)) }));

  // ───────── Prioridades do dia ─────────
  const toReconcile = await q<any>(`select p.id, p.amount, o.number, o.id as order_id, c.name from draum.payments p join draum.orders o on o.id=p.order_id join draum.customers c on c.id=o.customer_id where p.status='informado' order by p.informed_at limit 8`);
  const toPack = await q<any>(`select distinct o.id, o.number, c.name from draum.orders o join draum.order_items oi on oi.order_id=o.id join draum.customers c on c.id=o.customer_id
      where o.paid_at is not null and o.status not in ('cancelado') and oi.status in ('reservado','recebido') order by o.number limit 8`);
  const presales = (await listPresales({ status: "abertas" })).filter((p) => ["alto", "atrasado", "medio"].includes(p.risk.level)).slice(0, 8);
  const lowStock = await q<any>(`select v.sku, p.name, i.qty_physical - i.qty_reserved available, i.min_qty from draum.inventory i join draum.product_variants v on v.id=i.variant_id
      join draum.products p on p.id=v.product_id where v.active and i.min_qty>0 and i.qty_physical - i.qty_reserved <= i.min_qty order by 3 limit 8`);

  return {
    settingsPending: pendingSettings(s), goals: s.goals, minMargin: s.min_margin_pct, nextTuesday: nextTue, filtered,
    kpis: {
      gross, net, received, ordersTotal: all.length, ordersPaid: paid.length,
      ordersPending: all.filter((o) => o.status === "aguardando_pagamento").length,
      avgTicket: paid.length ? round2(paidNet / paid.length) : 0,
      marginPct: marginNet > 0 ? round2((marginSum / marginNet) * 100) : null, margin: round2(marginSum),
      expenses: fin.expenses, cashFree: cash.free, cashCommitted: cash.committed, cashBalance: cash.balance, contingency: cash.contingency,
      unreconciled: cash.informedPayments, cogs: cogsDelivered,
      stockUnits: stock.units, stockValue: round2(stock.value), stockReserved: stock.reserved, stockTransit: stock.transit, lowStock: stock.low,
      presalesToBuy: presalesWaiting.to_buy, presalesBought: presalesWaiting.bought, readyOrders: readyOrders!.n,
      tuesdayStops: tuesday.n, lateOrders: late!.n, vipMembers: crm.vip, vipConversionPct: crm.vipConversionPct, leads: crm.leads,
    },
    charts: {
      revenueSeries, modes: [
        { name: "Pronta-entrega", value: modeCount.pronta }, { name: "Pré-venda", value: modeCount.pre }, { name: "Misto", value: modeCount.misto },
      ],
      topProducts: [...products].sort((a, b) => b.qty - a.qty).slice(0, 8),
      categories: [...catMap.entries()].map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value),
      vipSeries, flows: flows.map((x) => ({ semana: x.wk, entradas: round2(x.entradas), saidas: round2(x.saidas) })),
      productMargins: [...products].sort((a, b) => b.net - a.net).slice(0, 10),
    },
    priorities: { toReconcile, toPack, presales, lowStock },
  };
}
