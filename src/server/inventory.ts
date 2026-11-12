import { BusinessError, Ctx, Tx, q, q1, round2, audit, requireAdmin } from "./core";
import { tx } from "@/lib/db";

/*
  Regras de estoque
  - Disponível = físico − reservado (nunca negativo: CHECK reserved <= physical no banco)
  - Reserva é um UPDATE condicional atômico: duas vendas simultâneas não conseguem
    reservar a mesma unidade, porque a segunda encontra disponível < qty e falha.
  - Pré-venda NÃO cria estoque: gera necessidade de compra.
  - Entrada física só no recebimento conferido de uma compra (ou ajuste administrativo auditado).
*/

async function move(c: Tx, variantId: number, type: string, field: "physical" | "reserved" | "in_transit", qty: number,
  opts: { unitCost?: number; orderItemId?: number; poItemId?: number; note?: string; userId?: number } = {}) {
  await c.query(
    `insert into draum.stock_movements(variant_id,type,field,qty,unit_cost,order_item_id,purchase_order_item_id,note,user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [variantId, type, field, qty, opts.unitCost ?? null, opts.orderItemId ?? null, opts.poItemId ?? null, opts.note ?? null, opts.userId ?? null]
  );
}

async function ensureRow(c: Tx, variantId: number) {
  await c.query(`insert into draum.inventory(variant_id) values ($1) on conflict do nothing`, [variantId]);
}

/** Reserva atômica. Lança erro se não houver unidades disponíveis. */
export async function reserve(c: Tx, variantId: number, qty: number, orderItemId: number | undefined, userId?: number) {
  await ensureRow(c, variantId);
  const r = await c.query(
    `update draum.inventory set qty_reserved = qty_reserved + $2, last_movement_at = now()
      where variant_id = $1 and qty_physical - qty_reserved >= $2
      returning qty_physical - qty_reserved as available`,
    [variantId, qty]
  );
  if (r.rowCount === 0) {
    const cur = await q1<{ sku: string; available: number }>(
      `select v.sku, coalesce(i.qty_physical - i.qty_reserved, 0) as available
         from draum.product_variants v left join draum.inventory i on i.variant_id = v.id where v.id = $1`, [variantId], c);
    throw new BusinessError(`Estoque insuficiente para ${cur?.sku ?? "SKU"}: disponível ${cur?.available ?? 0}, solicitado ${qty}.`, "sem_estoque");
  }
  await move(c, variantId, "reserva", "reserved", qty, { orderItemId, userId });
}

export async function release(c: Tx, variantId: number, qty: number, orderItemId: number | undefined, userId?: number, note?: string) {
  const r = await c.query(
    `update draum.inventory set qty_reserved = qty_reserved - $2, last_movement_at = now()
      where variant_id = $1 and qty_reserved >= $2`, [variantId, qty]);
  if (r.rowCount === 0) throw new BusinessError("Reserva inconsistente: não há unidades reservadas suficientes para liberar.");
  await move(c, variantId, "liberacao", "reserved", -qty, { orderItemId, userId, note });
}

/** Despacho: baixa físico e reservado juntos (a unidade sai fisicamente). */
export async function dispatchOut(c: Tx, variantId: number, qty: number, orderItemId: number | undefined, userId?: number, note?: string) {
  const r = await c.query(
    `update draum.inventory set qty_physical = qty_physical - $2, qty_reserved = qty_reserved - $2, last_movement_at = now()
      where variant_id = $1 and qty_reserved >= $2 and qty_physical >= $2`, [variantId, qty]);
  if (r.rowCount === 0) throw new BusinessError("Não é possível baixar: unidades reservadas insuficientes.");
  await move(c, variantId, "baixa", "physical", -qty, { orderItemId, userId, note });
  await move(c, variantId, "baixa", "reserved", -qty, { orderItemId, userId, note });
}

/** Entrada física com recálculo do custo médio ponderado. */
export async function stockIn(c: Tx, variantId: number, qty: number, unitCost: number,
  opts: { poItemId?: number; userId?: number; note?: string; fromTransit?: boolean; type?: string } = {}) {
  await ensureRow(c, variantId);
  const cur = await q1<{ qty_physical: number; avg_cost: number; qty_in_transit: number }>(
    `select qty_physical, avg_cost, qty_in_transit from draum.inventory where variant_id = $1 for update`, [variantId], c);
  const phys = cur!.qty_physical;
  const newAvg = phys + qty > 0 ? (phys * Number(cur!.avg_cost) + qty * unitCost) / (phys + qty) : unitCost;
  const transitDec = opts.fromTransit ? Math.min(qty, cur!.qty_in_transit) : 0;
  await c.query(
    `update draum.inventory set qty_physical = qty_physical + $2, avg_cost = $3,
       qty_in_transit = qty_in_transit - $4, last_movement_at = now() where variant_id = $1`,
    [variantId, qty, newAvg, transitDec]);
  await move(c, variantId, opts.type ?? "entrada", "physical", qty, { unitCost, poItemId: opts.poItemId, userId: opts.userId, note: opts.note });
  if (transitDec) await move(c, variantId, "transito", "in_transit", -transitDec, { poItemId: opts.poItemId, userId: opts.userId });
}

export async function addInTransit(c: Tx, variantId: number, qty: number, poItemId: number, userId?: number) {
  await ensureRow(c, variantId);
  await c.query(`update draum.inventory set qty_in_transit = qty_in_transit + $2, last_movement_at = now() where variant_id = $1`, [variantId, qty]);
  await move(c, variantId, "transito", "in_transit", qty, { poItemId, userId });
}

export async function removeInTransit(c: Tx, variantId: number, qty: number, poItemId: number, userId?: number) {
  await c.query(`update draum.inventory set qty_in_transit = greatest(qty_in_transit - $2, 0) where variant_id = $1`, [variantId, qty]);
  await move(c, variantId, "transito", "in_transit", -qty, { poItemId, userId, note: "compra cancelada" });
}

/** Ajuste administrativo (inventário inicial, contagem, avaria). Sempre auditado. */
export async function adjustStock(ctx: Ctx, input: { variantId: number; newPhysical: number; unitCost?: number; reason: string }) {
  requireAdmin(ctx);
  if (!input.reason?.trim()) throw new BusinessError("Informe o motivo do ajuste.");
  if (!Number.isInteger(input.newPhysical) || input.newPhysical < 0) throw new BusinessError("Quantidade física inválida.");
  return tx(async (c) => {
    await ensureRow(c, input.variantId);
    const cur = await q1<any>(`select * from draum.inventory where variant_id = $1 for update`, [input.variantId], c);
    if (input.newPhysical < cur.qty_reserved)
      throw new BusinessError(`Não é possível ajustar para ${input.newPhysical}: há ${cur.qty_reserved} unidade(s) reservada(s) para pedidos.`);
    const delta = input.newPhysical - cur.qty_physical;
    if (delta > 0 && input.unitCost != null) {
      await stockIn(c, input.variantId, delta, input.unitCost, { userId: ctx.userId, note: input.reason, type: "ajuste" });
    } else if (delta !== 0) {
      await c.query(`update draum.inventory set qty_physical = $2, last_movement_at = now() where variant_id = $1`, [input.variantId, input.newPhysical]);
      await move(c, input.variantId, "ajuste", "physical", delta, { userId: ctx.userId, note: input.reason });
    }
    await audit(c, ctx, "inventory", input.variantId, "ajuste", { from: cur.qty_physical, to: input.newPhysical, reason: input.reason });
    return { delta };
  });
}

export async function updateInventoryMeta(ctx: Ctx, variantId: number, minQty: number, location: string | null) {
  return tx(async (c) => {
    await ensureRow(c, variantId);
    await c.query(`update draum.inventory set min_qty = $2, location = $3 where variant_id = $1`, [variantId, Math.max(0, minQty | 0), location]);
    await audit(c, ctx, "inventory", variantId, "parametros", { minQty, location });
  });
}

export async function listInventory(filters: { search?: string; category?: string; low?: boolean } = {}) {
  const params: unknown[] = [];
  const where: string[] = ["v.active"];
  if (filters.search) { params.push(`%${filters.search}%`); where.push(`(v.sku ilike $${params.length} or p.name ilike $${params.length})`); }
  if (filters.category) { params.push(filters.category); where.push(`p.category = $${params.length}`); }
  if (filters.low) where.push(`coalesce(i.qty_physical - i.qty_reserved,0) <= coalesce(i.min_qty,0) and coalesce(i.min_qty,0) > 0`);
  return q<any>(
    `select v.id as variant_id, v.sku, v.color, v.size, p.id as product_id, p.name, p.category, p.image_url,
            coalesce(i.qty_physical,0) qty_physical, coalesce(i.qty_reserved,0) qty_reserved,
            coalesce(i.qty_physical - i.qty_reserved,0) qty_available, coalesce(i.qty_in_transit,0) qty_in_transit,
            coalesce(i.min_qty,0) min_qty, coalesce(i.avg_cost,0) avg_cost, i.location, i.last_movement_at
       from draum.product_variants v join draum.products p on p.id = v.product_id
       left join draum.inventory i on i.variant_id = v.id
      where ${where.join(" and ")}
      order by p.name, v.color, v.size`, params);
}

export async function listMovements(variantId?: number, limit = 200) {
  return q<any>(
    `select m.*, v.sku, u.name as user_name from draum.stock_movements m
       join draum.product_variants v on v.id = m.variant_id left join draum.users u on u.id = m.user_id
      ${variantId ? "where m.variant_id = $1" : ""} order by m.id desc limit ${Number(limit)}`, variantId ? [variantId] : []);
}

export const valueOf = (rows: { qty_physical: number; avg_cost: number }[]) =>
  round2(rows.reduce((s, r) => s + r.qty_physical * Number(r.avg_cost), 0));
