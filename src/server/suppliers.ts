import { z } from "zod";
import { BusinessError, Ctx, q, q1, audit } from "./core";
import { tx } from "@/lib/db";
import { normalizeWhatsapp } from "./crm";

const schema = z.object({
  name: z.string().trim().min(2, "Nome obrigatório"),
  contact_name: z.string().trim().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  email: z.string().trim().email("E-mail inválido").optional().nullable().or(z.literal("")),
  city: z.string().trim().optional().nullable(),
  default_lead_days: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  active: z.boolean().default(true),
});

export async function saveSupplier(ctx: Ctx, id: number | null, raw: unknown) {
  const s = schema.parse(raw);
  const wa = normalizeWhatsapp(s.whatsapp);
  return tx(async (c) => {
    if (id) {
      if (!s.active) {
        const open = (await q1<{ n: number }>(`select count(*) n from draum.purchase_orders where supplier_id=$1 and status in ('rascunho','enviado','pago','em_transito','recebido_parcial')`, [id], c))!.n;
        if (open) throw new BusinessError("Fornecedor com compras em andamento não pode ser desativado.");
      }
      await c.query(`update draum.suppliers set name=$2, contact_name=$3, whatsapp=$4, email=$5, city=$6, default_lead_days=$7, notes=$8, active=$9 where id=$1`,
        [id, s.name, s.contact_name || null, wa, s.email || null, s.city || null, s.default_lead_days ?? null, s.notes || null, s.active]);
      await audit(c, ctx, "supplier", id, "editar", s);
      return { id };
    }
    const r = await q1<{ id: number }>(`insert into draum.suppliers(name, contact_name, whatsapp, email, city, default_lead_days, notes, active)
        values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [s.name, s.contact_name || null, wa, s.email || null, s.city || null, s.default_lead_days ?? null, s.notes || null, s.active], c);
    await audit(c, ctx, "supplier", r!.id, "criar", s);
    return r!;
  });
}

export async function listSuppliers() {
  return q<any>(`select s.*,
      (select count(*) from draum.product_suppliers ps where ps.supplier_id = s.id) products,
      (select coalesce(sum(goods_total + shipping_cost),0) from draum.purchase_orders po where po.supplier_id = s.id and po.paid_at is not null) paid_total,
      (select count(*) from draum.purchase_orders po where po.supplier_id = s.id and po.status not in ('recebido','cancelado')) open_pos,
      (select count(*) from draum.order_items oi where oi.supplier_id = s.id and oi.status = 'aguardando_compra') pending_items
    from draum.suppliers s order by s.active desc, s.name`);
}

export async function getSupplier(id: number) {
  const supplier = await q1<any>(`select * from draum.suppliers where id=$1`, [id]);
  if (!supplier) return null;
  const products = await q<any>(`select ps.*, p.name, p.code from draum.product_suppliers ps join draum.products p on p.id = ps.product_id where ps.supplier_id=$1 order by p.name`, [id]);
  const pos = await q<any>(`select * from draum.purchase_orders where supplier_id=$1 order by created_at desc`, [id]);
  return { supplier, products, pos };
}
