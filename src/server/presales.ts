import { BusinessError, Ctx, q, q1, round2, audit, requireAdmin, todayISO, addDays, getSettings } from "./core";
import { tx } from "@/lib/db";
import { stockIn, reserve, addInTransit, removeInTransit } from "./inventory";
import { cashPosition } from "./finance";
import { recomputeOrderStatus } from "./orders";

export const PO_STATUS: Record<string, string> = {
  rascunho: "Rascunho", enviado: "Pedido ao fornecedor", pago: "Pago ao fornecedor", em_transito: "Em trânsito",
  recebido_parcial: "Recebido parcialmente", recebido: "Recebido", cancelado: "Cancelado",
};

/** Risco de atraso de um item de pré-venda */
export function presaleRisk(it: { status: string; customer_promised_date: string | null; expected: string | null; buffer: number }) {
  const today = todayISO();
  if (["entregue", "cancelado", "devolvido", "trocado"].includes(it.status)) return { level: "ok", label: "—" };
  if (!it.customer_promised_date) return { level: "medio", label: "Sem prazo" };
  if (it.customer_promised_date < today) return { level: "atrasado", label: "Prazo vencido" };
  if (["recebido", "pronto", "em_rota", "embalado"].includes(it.status)) return { level: "ok", label: "No prazo" };
  if (!it.expected) return { level: "medio", label: "Sem previsão" };
  if (it.expected > it.customer_promised_date) return { level: "alto", label: "Chegada após o prazo" };
  if (addDays(it.expected, it.buffer) > it.customer_promised_date) return { level: "medio", label: "Folga curta" };
  return { level: "ok", label: "No prazo" };
}

export async function listPresales(f: { status?: string; supplierId?: number } = {}) {
  const s = await getSettings();
  const params: unknown[] = []; const where = ["oi.mode = 'pre'"];
  if (f.status === "abertas") where.push(`oi.status not in ('entregue','cancelado','devolvido','trocado')`);
  else if (f.status) { params.push(f.status); where.push(`oi.status = $${params.length}`); }
  if (f.supplierId) { params.push(f.supplierId); where.push(`oi.supplier_id = $${params.length}`); }
  const rows = await q<any>(
    `select oi.*, o.number as order_number, o.id as order_id, o.paid_at, o.status as order_status, c.name as customer_name, c.whatsapp,
            p.name as product_name, v.sku, v.color, v.size, s.name as supplier_name,
            po.id as po_id, po.number as po_number, po.status as po_status, po.ordered_at, po.paid_at as po_paid_at, po.expected_at, po.tracking_code,
            poi.qty_received, poi.received_at, poi.unit_cost as confirmed_cost,
            (select coalesce(sum(amount),0) from draum.payments pm where pm.order_id = o.id and pm.status='conciliado') as order_paid,
            (o.subtotal - o.discount_total) as order_net,
            (select coalesce(sum(amount),0) from draum.obligations b where b.order_item_id = oi.id and b.status='aberta' and b.kind='mercadoria') as reserved_for_purchase
       from draum.order_items oi join draum.orders o on o.id = oi.order_id join draum.customers c on c.id = o.customer_id
       join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id
       left join draum.suppliers s on s.id = oi.supplier_id
       left join draum.purchase_order_items poi on poi.order_item_id = oi.id
       left join draum.purchase_orders po on po.id = poi.purchase_order_id
      where ${where.join(" and ")} order by oi.customer_promised_date nulls last, oi.id`, params);
  return rows.map((r) => {
    const expected = r.expected_at ?? (r.po_id ? null : r.status === "aguardando_compra" ? addDays(todayISO(), r.supplier_lead_days ?? 0) : r.expected_ready_date);
    const received = r.order_net > 0 ? round2((Number(r.total) / Number(r.order_net)) * Math.min(Number(r.order_paid), Number(r.order_net))) : 0;
    return { ...r, expected_arrival: expected, value_received: received, risk: presaleRisk({ status: r.status, customer_promised_date: r.customer_promised_date, expected, buffer: s.presale_buffer_days }) };
  });
}

/** Necessidades de compra consolidadas por fornecedor (mantém o vínculo item ↔ pedido) */
export async function purchaseNeeds() {
  const rows = await q<any>(
    `select oi.id as order_item_id, oi.qty, oi.unit_cost, oi.customer_promised_date, oi.supplier_id, s.name as supplier_name,
            o.number as order_number, o.id as order_id, c.name as customer_name, v.id as variant_id, v.sku, p.name as product_name, v.color, v.size,
            ps.unit_cost as supplier_unit_cost, ps.lead_days
       from draum.order_items oi join draum.orders o on o.id = oi.order_id join draum.customers c on c.id = o.customer_id
       join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id
       join draum.suppliers s on s.id = oi.supplier_id
       left join draum.product_suppliers ps on ps.product_id = p.id and ps.supplier_id = oi.supplier_id
      where oi.mode='pre' and oi.status='aguardando_compra' and o.paid_at is not null
        and not exists (select 1 from draum.purchase_order_items x where x.order_item_id = oi.id)
      order by s.name, v.sku, oi.customer_promised_date`);
  const bySupplier = new Map<number, { supplier_id: number; supplier_name: string; items: any[]; total: number; bySku: Record<string, number> }>();
  for (const r of rows) {
    if (!bySupplier.has(r.supplier_id)) bySupplier.set(r.supplier_id, { supplier_id: r.supplier_id, supplier_name: r.supplier_name, items: [], total: 0, bySku: {} });
    const g = bySupplier.get(r.supplier_id)!;
    g.items.push(r); g.total = round2(g.total + r.qty * Number(r.supplier_unit_cost ?? r.unit_cost));
    g.bySku[r.sku] = (g.bySku[r.sku] ?? 0) + r.qty;
  }
  return [...bySupplier.values()];
}

export async function createPurchaseOrder(ctx: Ctx, input: {
  supplierId: number; orderItemIds: number[]; confirmedCosts?: Record<number, number>;
  stockItems?: { variantId: number; qty: number; unitCost: number }[]; shippingCost?: number; notes?: string;
}) {
  if (!input.orderItemIds.length && !input.stockItems?.length) throw new BusinessError("Selecione itens para a compra.");
  return tx(async (c) => {
    const sup = await q1<any>(`select * from draum.suppliers where id=$1 and active`, [input.supplierId], c);
    if (!sup) throw new BusinessError("Fornecedor inválido.");
    const po = await q1<{ id: number; number: string }>(
      `insert into draum.purchase_orders(supplier_id, shipping_cost, notes, created_by) values ($1,$2,$3,$4) returning id, number`,
      [input.supplierId, round2(input.shippingCost ?? 0), input.notes ?? null, ctx.userId], c);
    let goods = 0;
    for (const id of input.orderItemIds) {
      const it = await q1<any>(
        `select oi.*, o.paid_at, o.status as order_status, ps.unit_cost as base_cost, ps.inbound_freight
           from draum.order_items oi join draum.orders o on o.id = oi.order_id
           join draum.product_variants v on v.id = oi.variant_id
           left join draum.product_suppliers ps on ps.product_id = v.product_id and ps.supplier_id = oi.supplier_id
          where oi.id = $1 for update of oi`, [id], c);
      if (!it || it.mode !== "pre") throw new BusinessError(`Item ${id} não é uma pré-venda.`);
      if (!it.paid_at || it.order_status === "cancelado") throw new BusinessError(`O pedido do item ${id} não está pago e conciliado: não é permitido comprar com recursos de outros pedidos.`);
      if (it.status !== "aguardando_compra") throw new BusinessError(`Item ${id} não está aguardando compra.`);
      if (it.supplier_id !== input.supplierId) throw new BusinessError(`Item ${id} foi vendido com outro fornecedor.`);
      const cost = round2(input.confirmedCosts?.[id] ?? Number(it.base_cost ?? it.unit_cost));
      if (input.confirmedCosts?.[id] != null) {
        await c.query(`update draum.order_items set unit_cost = $2 where id = $1`, [id, round2(cost + Number(it.inbound_freight ?? 0))]);
      }
      await c.query(`insert into draum.purchase_order_items(purchase_order_id, variant_id, order_item_id, qty, unit_cost) values ($1,$2,$3,$4,$5)`,
        [po!.id, it.variant_id, id, it.qty, cost]);
      goods += it.qty * cost;
    }
    for (const s of input.stockItems ?? []) {
      if (!(s.qty > 0) || !(s.unitCost >= 0)) throw new BusinessError("Quantidade/custo inválidos na reposição.");
      await c.query(`insert into draum.purchase_order_items(purchase_order_id, variant_id, qty, unit_cost) values ($1,$2,$3,$4)`, [po!.id, s.variantId, s.qty, round2(s.unitCost)]);
      goods += s.qty * s.unitCost;
    }
    await c.query(`update draum.purchase_orders set goods_total = $2 where id = $1`, [po!.id, round2(goods)]);
    await audit(c, ctx, "purchase_order", po!.id, "criar", input);
    return po!;
  });
}

/** Envia o pedido ao fornecedor: itens passam a "comprado" e entram como "em trânsito". */
export async function sendPurchaseOrder(ctx: Ctx, poId: number, expectedAt?: string) {
  return tx(async (c) => {
    const po = await q1<any>(`select po.*, s.default_lead_days from draum.purchase_orders po join draum.suppliers s on s.id = po.supplier_id where po.id=$1 for update of po`, [poId], c);
    if (!po || po.status !== "rascunho") throw new BusinessError("Só compras em rascunho podem ser enviadas.");
    const lead = await q1<{ d: number }>(`select max(oi.supplier_lead_days) d from draum.purchase_order_items poi join draum.order_items oi on oi.id = poi.order_item_id where poi.purchase_order_id=$1`, [poId], c);
    const exp = expectedAt || addDays(todayISO(), lead?.d ?? po.default_lead_days ?? 7);
    await c.query(`update draum.purchase_orders set status='enviado', ordered_at=now(), expected_at=$2 where id=$1`, [poId, exp]);
    const items = await q<any>(`select * from draum.purchase_order_items where purchase_order_id=$1`, [poId], c);
    for (const i of items) {
      await addInTransit(c, i.variant_id, i.qty, i.id, ctx.userId);
      if (i.order_item_id) await c.query(`update draum.order_items set status='comprado', expected_ready_date=$2 where id=$1 and status='aguardando_compra'`, [i.order_item_id, exp]);
    }
    const orders = await q<{ order_id: number }>(`select distinct oi.order_id from draum.purchase_order_items poi join draum.order_items oi on oi.id = poi.order_item_id where poi.purchase_order_id=$1`, [poId], c);
    for (const o of orders) await recomputeOrderStatus(c, o.order_id);
    await audit(c, ctx, "purchase_order", poId, "enviar", { expectedAt: exp });
  });
}

/**
 * Pagamento ao fornecedor (administrador). Regra de financiamento:
 *  - A parte coberta pelas obrigações dos próprios pedidos (dinheiro já recebido desses clientes) é liquidada.
 *  - O restante (reposição de estoque, frete além do previsto, custo confirmado maior) só pode sair do CAIXA LIVRE.
 *  Assim, recebimentos de um cliente nunca financiam o pedido de outro.
 */
export async function payPurchaseOrder(ctx: Ctx, poId: number) {
  requireAdmin(ctx);
  return tx(async (c) => {
    await c.query(`lock table draum.obligations in share row exclusive mode`);
    const po = await q1<any>(`select * from draum.purchase_orders where id=$1 for update`, [poId], c);
    if (!po) throw new BusinessError("Compra não encontrada.");
    if (po.paid_at) throw new BusinessError("Esta compra já foi paga.");
    if (po.status === "cancelado" || po.status === "rascunho") throw new BusinessError("Envie a compra ao fornecedor antes de registrar o pagamento.");
    const outflow = round2(Number(po.goods_total) + Number(po.shipping_cost));
    const obs = await q<any>(
      `select b.* from draum.obligations b where b.status='aberta' and (
          b.order_item_id in (select order_item_id from draum.purchase_order_items where purchase_order_id=$1 and order_item_id is not null)
          or b.purchase_order_id = $1) for update`, [poId], c);
    const covered = round2(Math.min(outflow, obs.reduce((a, o) => a + Number(o.amount), 0)));
    const uncovered = round2(outflow - covered);
    if (uncovered > 0) {
      const pos = await cashPosition(c);
      if (uncovered > pos.free + 0.001)
        throw new BusinessError(`Esta compra precisa de R$ ${uncovered.toFixed(2)} além do valor reservado pelos pedidos vinculados, mas o caixa livre estimado é R$ ${pos.free.toFixed(2)}. Recursos de outros pedidos não podem ser usados.`, "caixa");
    }
    const e1 = await q1<{ id: number }>(
      `insert into draum.cash_entries(direction, category, amount, description, reconciled, purchase_order_id, created_by) values ('saida','compra_mercadoria',$1,$2,true,$3,$4) returning id`,
      [po.goods_total, `Compra ${po.number}`, poId, ctx.userId], c);
    if (Number(po.shipping_cost) > 0)
      await c.query(`insert into draum.cash_entries(direction, category, amount, description, reconciled, purchase_order_id, created_by) values ('saida','frete_compra',$1,$2,true,$3,$4)`,
        [po.shipping_cost, `Frete ${po.number}`, poId, ctx.userId]);
    for (const o of obs) await c.query(`update draum.obligations set status='liquidada', settled_at=now(), settled_by_entry=$2 where id=$1`, [o.id, e1!.id]);
    await c.query(`update draum.purchase_orders set paid_at=now(), status = case when status='enviado' then 'pago' else status end where id=$1`, [poId]);
    await audit(c, ctx, "purchase_order", poId, "pagar", { outflow, covered, uncovered });
    return { outflow, covered, uncovered };
  });
}

export async function updateTracking(ctx: Ctx, poId: number, tracking: string, expectedAt?: string) {
  return tx(async (c) => {
    const po = await q1<any>(`select * from draum.purchase_orders where id=$1 for update`, [poId], c);
    if (!po || ["rascunho", "cancelado", "recebido"].includes(po.status)) throw new BusinessError("Compra não está em andamento.");
    await c.query(`update draum.purchase_orders set tracking_code=$2, expected_at=coalesce($3::date, expected_at),
        status = case when status in ('enviado','pago') then 'em_transito' else status end where id=$1`, [poId, tracking || null, expectedAt || null]);
    if (expectedAt) await c.query(`update draum.order_items set expected_ready_date=$2 where id in (select order_item_id from draum.purchase_order_items where purchase_order_id=$1)`, [poId, expectedAt]);
    await audit(c, ctx, "purchase_order", poId, "rastreio", { tracking, expectedAt });
  });
}

/** Recebimento conferido (parcial ou total). Entrada física + reserva automática para a pré-venda vinculada. */
export async function receivePurchaseOrder(ctx: Ctx, poId: number, lines: { poItemId: number; qty: number }[]) {
  if (!lines.some((l) => l.qty > 0)) throw new BusinessError("Informe as quantidades recebidas.");
  return tx(async (c) => {
    const po = await q1<any>(`select * from draum.purchase_orders where id=$1 for update`, [poId], c);
    if (!po || ["rascunho", "cancelado", "recebido"].includes(po.status)) throw new BusinessError("Compra não pode receber mercadorias neste status.");
    const totalUnits = (await q1<{ n: number }>(`select sum(qty) n from draum.purchase_order_items where purchase_order_id=$1`, [poId], c))!.n;
    const freightPerUnit = totalUnits ? Number(po.shipping_cost) / totalUnits : 0;
    const touchedOrders = new Set<number>();
    for (const l of lines) {
      if (!l.qty) continue;
      const it = await q1<any>(`select * from draum.purchase_order_items where id=$1 and purchase_order_id=$2 for update`, [l.poItemId, poId], c);
      if (!it) throw new BusinessError("Item de compra inválido.");
      if (!Number.isInteger(l.qty) || l.qty < 0 || it.qty_received + l.qty > it.qty) throw new BusinessError(`Quantidade recebida excede o pedido ao fornecedor (pendente ${it.qty - it.qty_received}).`);
      await stockIn(c, it.variant_id, l.qty, round2(Number(it.unit_cost) + freightPerUnit), { poItemId: it.id, userId: ctx.userId, note: `Recebimento ${po.number}`, fromTransit: true });
      await c.query(`update draum.purchase_order_items set qty_received = qty_received + $2, received_at = now() where id=$1`, [it.id, l.qty]);
      if (it.order_item_id) {
        const oi = await q1<any>(`select * from draum.order_items where id=$1 for update`, [it.order_item_id], c);
        if (oi && oi.status !== "cancelado") {
          await reserve(c, it.variant_id, l.qty, oi.id, ctx.userId);
          if (it.qty_received + l.qty >= oi.qty) await c.query(`update draum.order_items set status='recebido' where id=$1`, [oi.id]);
          touchedOrders.add(oi.order_id);
        }
      }
    }
    const rem = await q1<{ pend: number; got: number }>(`select sum(qty - qty_received) pend, sum(qty_received) got from draum.purchase_order_items where purchase_order_id=$1`, [poId], c);
    await c.query(`update draum.purchase_orders set status=$2 where id=$1`, [poId, rem!.pend > 0 ? "recebido_parcial" : "recebido"]);
    for (const o of touchedOrders) await recomputeOrderStatus(c, o);
    await audit(c, ctx, "purchase_order", poId, "receber", { lines });
    return { pending: rem!.pend };
  });
}

export async function cancelPurchaseOrder(ctx: Ctx, poId: number, reason: string) {
  return tx(async (c) => {
    const po = await q1<any>(`select * from draum.purchase_orders where id=$1 for update`, [poId], c);
    if (!po || po.paid_at || ["recebido", "recebido_parcial", "cancelado"].includes(po.status))
      throw new BusinessError("Só compras não pagas e sem recebimento podem ser canceladas.");
    const items = await q<any>(`select * from draum.purchase_order_items where purchase_order_id=$1`, [poId], c);
    for (const i of items) {
      if (po.status !== "rascunho") await removeInTransit(c, i.variant_id, i.qty, i.id, ctx.userId);
      if (i.order_item_id) await c.query(`update draum.order_items set status='aguardando_compra' where id=$1 and status in ('comprado','aguardando_compra')`, [i.order_item_id]);
    }
    await c.query(`delete from draum.purchase_order_items where purchase_order_id=$1`, [poId]);
    await c.query(`update draum.obligations set status='cancelada' where purchase_order_id=$1 and status='aberta'`, [poId]);
    await c.query(`update draum.purchase_orders set status='cancelado', notes = coalesce(notes,'') || $2 where id=$1`, [poId, ` | Cancelada: ${reason}`]);
    await audit(c, ctx, "purchase_order", poId, "cancelar", { reason });
  });
}

export async function listPurchaseOrders() {
  return q<any>(`select po.*, s.name as supplier_name,
      (select sum(qty) from draum.purchase_order_items i where i.purchase_order_id = po.id) as units,
      (select sum(qty_received) from draum.purchase_order_items i where i.purchase_order_id = po.id) as received
    from draum.purchase_orders po join draum.suppliers s on s.id = po.supplier_id order by po.created_at desc`);
}

export async function getPurchaseOrder(id: number) {
  const po = await q1<any>(`select po.*, s.name as supplier_name, s.whatsapp as supplier_whatsapp from draum.purchase_orders po join draum.suppliers s on s.id = po.supplier_id where po.id=$1`, [id]);
  if (!po) return null;
  const items = await q<any>(`select i.*, v.sku, v.color, v.size, p.name as product_name, o.number as order_number, o.id as order_id, c.name as customer_name, oi.customer_promised_date
      from draum.purchase_order_items i join draum.product_variants v on v.id = i.variant_id join draum.products p on p.id = v.product_id
      left join draum.order_items oi on oi.id = i.order_item_id left join draum.orders o on o.id = oi.order_id left join draum.customers c on c.id = o.customer_id
      where i.purchase_order_id=$1 order by v.sku`, [id]);
  return { po, items };
}
