import { q, q1 } from "@/lib/db";
import type { Ctx } from "@/server/core";
import { createUser } from "@/server/users";
import { createProduct, upsertProductSupplier } from "@/server/products";
import { saveSupplier } from "@/server/suppliers";
import { createCustomer } from "@/server/crm";
import { adjustStock } from "@/server/inventory";
import { createOrder, informPayment, reconcilePayment } from "@/server/orders";
import { todayISO, addDays } from "@/server/core";

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function users() {
  const existing = await q1<any>(`select id from draum.users where email='admin@teste.draum'`);
  let adminId = existing?.id;
  if (!adminId) adminId = (await createUser(null, { name: "Admin", email: "admin@teste.draum", password: "senha-forte-123", role: "admin" })).id;
  const admin: Ctx = { userId: adminId, role: "admin" };
  let op = await q1<any>(`select id from draum.users where email='op@teste.draum'`);
  if (!op) op = await createUser(admin, { name: "Operador", email: "op@teste.draum", password: "senha-forte-123", role: "operador" });
  return { admin, op: { userId: op.id, role: "operador" } as Ctx };
}

export async function setSetting(key: string, value: unknown) {
  await q(`update draum.settings set value=$2 where key=$1`, [key, JSON.stringify(value)]);
}

export async function fixture(admin: Ctx, opts: { stock?: number; cost?: number; price?: number; leadDays?: number; checked?: boolean; category?: string } = {}) {
  const sup = await saveSupplier(admin, null, { name: `Fornecedor ${uid()}`, default_lead_days: opts.leadDays ?? 7 });
  const prod = await createProduct(admin,
    { name: `Macaquinho ${uid()}`, category: opts.category ?? "macaquinhos", sale_price: opts.price ?? 200, modality: "ambas", status: "ativo" },
    [{ color: "Preto", size: "M" }, { color: "Preto", size: "G" }]);
  await upsertProductSupplier(admin, prod.id, {
    supplier_id: sup.id, unit_cost: opts.cost ?? 60, inbound_freight: 0, lead_days: opts.leadDays ?? 7,
    availability_checked: opts.checked ?? true, is_primary: true,
  });
  const variants = await q<any>(`select id, sku from draum.product_variants where product_id=$1 order by size desc`, [prod.id]); // M, G
  if (opts.stock) await adjustStock(admin, { variantId: variants[0].id, newPhysical: opts.stock, unitCost: opts.cost ?? 60, reason: "inventário inicial (teste)" });
  const cust = await createCustomer(admin, { name: `Cliente ${uid()}`, whatsapp: `9198${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`, neighborhood: "Umarizal", vip_joined_at: todayISO(), consent_whatsapp: true });
  return { supplierId: sup.id, productId: prod.id, code: prod.code, variantM: variants[0].id, variantG: variants[1].id, skuM: variants[0].sku, customerId: cust.id };
}

export const promise = (days: number) => addDays(todayISO(), days);

export async function paidOrder(admin: Ctx, input: any) {
  const o = await createOrder(admin, input);
  const order = await q1<any>(`select total from draum.orders where id=$1`, [o.id]);
  const p = await informPayment(admin, o.id, { amount: order.total, method: "pix" });
  await reconcilePayment(admin, p.id);
  return o;
}

export const inv = (variantId: number) =>
  q1<{ qty_physical: number; qty_reserved: number; qty_in_transit: number; avg_cost: number }>(`select qty_physical, qty_reserved, qty_in_transit, avg_cost from draum.inventory where variant_id=$1`, [variantId]);

export async function addAporte(admin: Ctx, amount: number) {
  const { createEntry } = await import("@/server/finance");
  await createEntry(admin, { category: "aporte", amount, occurred_on: todayISO(), description: "Aporte de capital (teste)", reconciled: true });
}
