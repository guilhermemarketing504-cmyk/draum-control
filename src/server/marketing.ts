import { z } from "zod";
import { BusinessError, Ctx, q, q1, audit, round2, requireAdmin } from "./core";
import { tx } from "@/lib/db";
import { reserve, dispatchOut } from "./inventory";

// ───────── Campanhas ─────────
const campaignSchema = z.object({
  name: z.string().trim().min(2),
  channel: z.string().trim().optional().nullable(),
  objective: z.string().trim().optional().nullable(),
  starts_on: z.string().optional().nullable().or(z.literal("")),
  ends_on: z.string().optional().nullable().or(z.literal("")),
  budget: z.coerce.number().min(0).default(0),
  spent: z.coerce.number().min(0).default(0),
  status: z.enum(["planejada", "ativa", "encerrada"]),
  notes: z.string().trim().optional().nullable(),
});

export async function saveCampaign(ctx: Ctx, id: number | null, raw: unknown) {
  const c0 = campaignSchema.parse(raw);
  return tx(async (c) => {
    const vals = [c0.name, c0.channel || null, c0.objective || null, c0.starts_on || null, c0.ends_on || null, c0.budget, c0.spent, c0.status, c0.notes || null];
    if (id) {
      await c.query(`update draum.campaigns set name=$2, channel=$3, objective=$4, starts_on=$5, ends_on=$6, budget=$7, spent=$8, status=$9, notes=$10 where id=$1`, [id, ...vals]);
      await audit(c, ctx, "campaign", id, "editar", c0);
      return { id };
    }
    const r = await q1<{ id: number }>(`insert into draum.campaigns(name, channel, objective, starts_on, ends_on, budget, spent, status, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, vals, c);
    await audit(c, ctx, "campaign", r!.id, "criar", c0);
    return r!;
  });
}

/** Métricas por campanha — só com atribuição registrada (cupom, link ou registro explícito) */
export async function listCampaigns() {
  const rows = await q<any>(`select cp.*,
      (select count(*) from draum.customers c where c.campaign_id = cp.id) leads,
      (select count(*) from draum.orders o where o.campaign_id = cp.id and o.paid_at is not null and o.status <> 'cancelado') orders,
      (select count(distinct o.customer_id) from draum.orders o where o.campaign_id = cp.id and o.paid_at is not null and o.status <> 'cancelado') buyers,
      (select coalesce(sum(o.subtotal - o.discount_total),0) from draum.orders o where o.campaign_id = cp.id and o.paid_at is not null and o.status <> 'cancelado') revenue,
      (select coalesce(sum(oi.qty * oi.unit_cost),0) from draum.order_items oi join draum.orders o on o.id = oi.order_id
         where o.campaign_id = cp.id and o.paid_at is not null and o.status <> 'cancelado' and oi.status not in ('cancelado','trocado')) cogs
    from draum.campaigns cp order by cp.starts_on nulls last, cp.id`);
  return rows.map((r) => ({
    ...r,
    cac: r.buyers > 0 ? round2(Number(r.spent) / r.buyers) : null,
    conversion: r.leads > 0 ? round2((r.buyers / r.leads) * 100) : null,
    result: round2(Number(r.revenue) - Number(r.cogs) - Number(r.spent)),
  }));
}

// ───────── Promoções ─────────
const promoSchema = z.object({
  name: z.string().trim().min(2),
  kind: z.enum(["vip", "duas_pecas", "black_friday", "cupom", "outra"]),
  pct: z.coerce.number().gt(0).lt(100),
  starts_at: z.string().min(10),
  ends_at: z.string().min(10),
  min_items: z.coerce.number().int().min(1).default(1),
  all_products: z.boolean(),
  requires_vip: z.boolean(),
  coupon_code: z.string().trim().optional().nullable(),
  campaign_id: z.coerce.number().int().positive().optional().nullable(),
  active: z.boolean(),
  product_ids: z.array(z.coerce.number().int().positive()).default([]),
});

export async function savePromotion(ctx: Ctx, id: number | null, raw: unknown) {
  requireAdmin(ctx);
  const p = promoSchema.parse(raw);
  if (new Date(p.ends_at) <= new Date(p.starts_at)) throw new BusinessError("O término deve ser depois do início.");
  if (!p.all_products && p.active && !p.product_ids.length) throw new BusinessError("Selecione os produtos elegíveis ou marque 'todos os produtos'.");
  return tx(async (c) => {
    const vals = [p.name, p.kind, p.pct, p.starts_at, p.ends_at, p.min_items, p.all_products, p.requires_vip, p.coupon_code ? p.coupon_code.toUpperCase() : null, p.campaign_id ?? null, p.active];
    let pid = id;
    if (id) await c.query(`update draum.promotions set name=$2, kind=$3, pct=$4, starts_at=$5, ends_at=$6, min_items=$7, all_products=$8, requires_vip=$9, coupon_code=$10, campaign_id=$11, active=$12 where id=$1`, [id, ...vals]);
    else pid = (await q1<{ id: number }>(`insert into draum.promotions(name, kind, pct, starts_at, ends_at, min_items, all_products, requires_vip, coupon_code, campaign_id, active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`, vals, c))!.id;
    await c.query(`delete from draum.promotion_products where promotion_id=$1`, [pid]);
    if (!p.all_products) for (const prod of p.product_ids) await c.query(`insert into draum.promotion_products(promotion_id, product_id) values ($1,$2)`, [pid, prod]);
    await audit(c, ctx, "promotion", pid, id ? "editar" : "criar", p);
    return { id: pid };
  });
}

// ───────── Embaixadoras ─────────
const ambSchema = z.object({
  name: z.string().trim().min(2),
  instagram: z.string().trim().optional().nullable(),
  status: z.enum(["prospeccao", "ativa", "pausada", "encerrada"]),
  referral_code: z.string().trim().optional().nullable(),
  content_agreed: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export async function saveAmbassador(ctx: Ctx, id: number | null, raw: unknown) {
  const a = ambSchema.parse(raw);
  const code = a.referral_code ? a.referral_code.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
  return tx(async (c) => {
    if (code) {
      const dup = await q1(`select 1 from draum.ambassadors where referral_code=$1 and id <> coalesce($2, 0)`, [code, id], c);
      const dupPromo = await q1(`select 1 from draum.promotions where coupon_code=$1`, [code], c);
      if (dup || dupPromo) throw new BusinessError(`O código ${code} já está em uso.`);
    }
    const vals = [a.name, a.instagram?.replace(/^@/, "") || null, a.status, code, a.content_agreed || null, a.notes || null];
    if (id) {
      await c.query(`update draum.ambassadors set name=$2, instagram=$3, status=$4, referral_code=$5, content_agreed=$6, notes=$7 where id=$1`, [id, ...vals]);
      await audit(c, ctx, "ambassador", id, "editar", a);
      return { id };
    }
    const r = await q1<{ id: number }>(`insert into draum.ambassadors(name, instagram, status, referral_code, content_agreed, notes) values ($1,$2,$3,$4,$5,$6) returning id`, vals, c);
    await audit(c, ctx, "ambassador", r!.id, "criar", a);
    return r!;
  });
}

/** Envio de peças para embaixadora: sai do estoque físico (baixa auditada), custo registrado. */
export async function shipToAmbassador(ctx: Ctx, ambassadorId: number, input: { variantId: number; qty: number; sentOn: string }) {
  if (!(input.qty > 0)) throw new BusinessError("Quantidade inválida.");
  return tx(async (c) => {
    const inv = await q1<any>(`select avg_cost from draum.inventory where variant_id=$1`, [input.variantId], c);
    await reserve(c, input.variantId, input.qty, undefined, ctx.userId);
    await dispatchOut(c, input.variantId, input.qty, undefined, ctx.userId, `Envio para embaixadora #${ambassadorId}`);
    const v = await q1<any>(`select v.sku, p.name from draum.product_variants v join draum.products p on p.id=v.product_id where v.id=$1`, [input.variantId], c);
    await c.query(`insert into draum.ambassador_shipments(ambassador_id, variant_id, description, qty, unit_cost, sent_on) values ($1,$2,$3,$4,$5,$6)`,
      [ambassadorId, input.variantId, `${v.name} (${v.sku})`, input.qty, round2(Number(inv?.avg_cost ?? 0)), input.sentOn]);
    await audit(c, ctx, "ambassador", ambassadorId, "envio_pecas", input);
  });
}

export async function toggleShipmentContent(ctx: Ctx, shipmentId: number, delivered: boolean) {
  await tx(async (c) => {
    await c.query(`update draum.ambassador_shipments set content_delivered=$2 where id=$1`, [shipmentId, delivered]);
    await audit(c, ctx, "ambassador_shipment", shipmentId, "conteudo", { delivered });
  });
}

export async function listAmbassadors() {
  const rows = await q<any>(`select a.*,
      (select coalesce(sum(qty),0) from draum.ambassador_shipments s where s.ambassador_id=a.id) pieces_sent,
      (select coalesce(sum(qty*unit_cost),0) from draum.ambassador_shipments s where s.ambassador_id=a.id) pieces_cost,
      (select min(sent_on) from draum.ambassador_shipments s where s.ambassador_id=a.id) first_sent,
      (select count(*) filter (where content_delivered) from draum.ambassador_shipments s where s.ambassador_id=a.id) content_done,
      (select count(*) from draum.orders o where o.ambassador_id=a.id and o.paid_at is not null and o.status<>'cancelado') sales,
      (select coalesce(sum(o.subtotal - o.discount_total),0) from draum.orders o where o.ambassador_id=a.id and o.paid_at is not null and o.status<>'cancelado') revenue
    from draum.ambassadors a order by a.status, a.name`);
  return rows.map((r) => ({ ...r, roi: Number(r.pieces_cost) > 0 ? round2(Number(r.revenue) / Number(r.pieces_cost)) : null }));
}

export async function listShipments(ambassadorId: number) {
  return q<any>(`select * from draum.ambassador_shipments where ambassador_id=$1 order by sent_on desc`, [ambassadorId]);
}
