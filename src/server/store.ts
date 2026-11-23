import { z } from "zod";
import { BusinessError, Ctx, q, q1, round2, audit, requireAdmin, getSettings, Settings, StoreSettings, STORE_DEFAULTS } from "./core";
import { tx } from "@/lib/db";
import { firstEligibleTuesday } from "./delivery";
import { createOrder } from "./orders";
import { normalizeWhatsapp } from "./crm";
import { CATEGORIES } from "./products";

/*
  LOJA DRAUM (pública)
  - Pronta-entrega: estoque próprio (físico − reservado). Peça reservada na hora do pedido.
  - Sob encomenda: catálogo da distribuidora sincronizado pelo robô. A peça vira pré-venda no CONTROL,
    com o fornecedor vinculado; pedido até o corte (sexta 12h) chega na terça seguinte.
  - O fechamento acontece no WhatsApp: o pedido nasce "aguardando pagamento" e o cliente cai na conversa com o resumo.
*/

export type StoreMode = "pronta" | "pre";

/** Preço de venda a partir do custo: margem sobre o preço (custo ÷ (1 − margem)), terminando em ,90.
    Arredonda para o ,90 imediatamente acima; se o valor exato estiver no máximo R$ 0,10 acima de um ,90, usa esse
    (ex.: custo 85 → 170,00 → R$ 169,90). Assim a diferença para a margem exata nunca passa de 10 centavos. */
export function priceFromCost(cost: number, st: Pick<StoreSettings, "margin_pct" | "price_ending">) {
  const m = Math.min(Math.max(Number(st.margin_pct) || 0, 0), 90) / 100;
  const raw = cost / (1 - m);
  const end = Number(st.price_ending) || 0;
  if (!(end > 0 && end < 1)) return round2(Math.ceil(raw * 100) / 100);
  let p = Math.floor(raw) + end;
  if (p + 1e-9 < raw) p += 1;
  if (p - 1 >= 0 && raw - (p - 1) <= 0.10 + 1e-9) p -= 1;
  return round2(p);
}

/** Terça de entrega para um pedido feito agora (mesmo corte do Delivery Day: sexta 12h) */
export function storeDeliveryDate(now: Date, s: Pick<Settings, "delivery_cutoff">) {
  return firstEligibleTuesday(now, s);
}

export function cutoffLabel(s: Pick<Settings, "delivery_cutoff">) {
  const d = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][s.delivery_cutoff.weekday];
  return `${d}, ${s.delivery_cutoff.hour}h`;
}

const SIZE_ORDER = ["PP", "P", "M", "G", "GG", "XG", "EG", "U", "UNICO"];
const sizeRank = (s: string) => { const i = SIZE_ORDER.indexOf(s.toUpperCase()); return i < 0 ? 99 : i; };

/** Disponibilidade por variante: pronta-entrega primeiro, depois encomenda */
const VARIANT_SQL = `
  select v.id, v.product_id, v.sku, v.color, v.color_hex, v.size, v.supplier_stock,
         coalesce(i.qty_physical - i.qty_reserved, 0) as available,
         p.modality,
         ps.supplier_id, ps.availability_checked_at, ps.lead_days
    from draum.product_variants v
    join draum.products p on p.id = v.product_id
    left join draum.inventory i on i.variant_id = v.id
    left join lateral (select * from draum.product_suppliers x where x.product_id = p.id
                        order by x.is_primary desc, x.unit_cost asc limit 1) ps on true
   where v.active`;

function variantMode(v: any, validDays: number, now = new Date()): StoreMode | null {
  if (v.modality !== "pre" && Number(v.available) > 0) return "pronta";
  if (v.modality === "pronta" || !v.supplier_id || !v.availability_checked_at) return null;
  const age = (now.getTime() - new Date(v.availability_checked_at).getTime()) / 86400000;
  if (age > validDays) return null;
  if (v.supplier_stock != null && Number(v.supplier_stock) <= 0) return null;
  return "pre";
}

export interface StoreCard {
  id: number; slug: string; name: string; category: string; categoryLabel: string; price: number; promoPrice: number | null;
  image: string | null; colors: { name: string; hex: string | null }[]; sizes: string[];
  hasPronta: boolean; hasPre: boolean; prontaUnits: number; unique: boolean;
}

export const imageSrc = (img: { id: number; url: string | null }) => img.url ?? `/loja/img/${img.id}`;

export async function listStoreProducts(): Promise<StoreCard[]> {
  const s = await getSettings();
  const products = await q<any>(
    `select p.id, p.slug, p.name, p.category, p.sale_price, p.promo_price, p.image_url, p.source, p.created_at,
            (select json_build_object('id', im.id, 'url', im.url) from draum.product_images im where im.product_id = p.id order by im.position, im.id limit 1) as img
       from draum.products p
      where p.status = 'ativo' and p.store_visible and p.slug is not null and p.sale_price > 0
        and ($1::boolean or p.source <> 'mft')
      order by (p.source = 'proprio') desc, p.created_at desc`, [s.store.mft_enabled]);
  if (!products.length) return [];
  const variants = await q<any>(`${VARIANT_SQL} and v.product_id = any($1)`, [products.map((p) => p.id)]);
  const byProduct = new Map<number, any[]>();
  for (const v of variants) (byProduct.get(v.product_id) ?? byProduct.set(v.product_id, []).get(v.product_id)!).push(v);
  const cards: StoreCard[] = [];
  for (const p of products) {
    const vs = (byProduct.get(p.id) ?? []).map((v) => ({ ...v, mode: variantMode(v, s.availability_valid_days) })).filter((v) => v.mode);
    if (!vs.length) continue;
    if (p.source === "mft" && !p.img && !p.image_url) continue; // peça da distribuidora sem foto não vende: fica fora até ganhar foto
    const colors = new Map<string, string | null>();
    vs.forEach((v) => colors.set(v.color, v.color_hex ?? colors.get(v.color) ?? null));
    const pronta = vs.filter((v) => v.mode === "pronta");
    const prontaUnits = pronta.reduce((a, v) => a + Number(v.available), 0);
    cards.push({
      id: p.id, slug: p.slug, name: p.name, category: p.category, categoryLabel: CATEGORIES[p.category]?.label ?? p.category,
      price: Number(p.sale_price), promoPrice: p.promo_price != null ? Number(p.promo_price) : null,
      image: p.img ? imageSrc(p.img) : p.image_url ?? null,
      colors: [...colors].map(([name, hex]) => ({ name, hex })),
      sizes: [...new Set(vs.map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b)),
      hasPronta: pronta.length > 0, hasPre: vs.some((v) => v.mode === "pre"), prontaUnits,
      unique: pronta.length > 0 && prontaUnits === 1 && !vs.some((v) => v.mode === "pre"),
    });
  }
  return cards;
}

export async function getStoreProduct(slug: string) {
  const s = await getSettings();
  const p = await q1<any>(
    `select p.* from draum.products p where p.slug = $1 and p.status = 'ativo' and p.store_visible and ($2::boolean or p.source <> 'mft')`,
    [slug, s.store.mft_enabled]);
  if (!p) return null;
  const variants = (await q<any>(`${VARIANT_SQL} and v.product_id = $1`, [p.id]))
    .map((v) => ({ id: v.id as number, color: v.color as string, hex: v.color_hex as string | null, size: v.size as string,
      available: Number(v.available), mode: variantMode(v, s.availability_valid_days) }))
    .sort((a, b) => a.color.localeCompare(b.color) || sizeRank(a.size) - sizeRank(b.size));
  const images = (await q<any>(`select id, url, color from draum.product_images where product_id = $1 order by position, id`, [p.id]))
    .map((im) => ({ src: imageSrc(im), color: im.color as string | null }));
  if (!images.length && p.image_url) images.push({ src: p.image_url, color: null });
  if (!images.length && p.source === "mft") return null;
  return {
    product: { id: p.id, slug: p.slug, name: p.name, category: p.category, categoryLabel: CATEGORIES[p.category]?.label ?? p.category,
      description: p.description as string | null, price: Number(p.sale_price), promoPrice: p.promo_price != null ? Number(p.promo_price) : null },
    variants, images, deliveryDate: storeDeliveryDate(new Date(), s), cutoff: cutoffLabel(s),
  };
}

/** Dados do carrinho (preços e disponibilidade sempre vindos do servidor) */
export async function cartLines(items: { variantId: number; qty: number }[]) {
  const s = await getSettings();
  if (!items.length) return { lines: [], deliveryDate: storeDeliveryDate(new Date(), s), cutoff: cutoffLabel(s), whatsappReady: !!s.store.whatsapp };
  const rows = await q<any>(
    `${VARIANT_SQL} and v.id = any($1) and p.status = 'ativo' and p.store_visible`, [items.map((i) => i.variantId)]);
  const info = await q<any>(
    `select v.id, p.name, p.slug, p.sale_price, p.promo_price,
            (select coalesce(im.url, '/loja/img/' || im.id) from draum.product_images im where im.product_id = p.id
              and (im.color is null or im.color = v.color) order by (im.color = v.color) desc nulls last, im.position, im.id limit 1) as image,
            p.image_url
       from draum.product_variants v join draum.products p on p.id = v.product_id where v.id = any($1)`, [items.map((i) => i.variantId)]);
  const lines = items.map((it) => {
    const v = rows.find((r) => r.id === it.variantId);
    const meta = info.find((r) => r.id === it.variantId);
    if (!v || !meta) return null;
    const mode = variantMode(v, s.availability_valid_days);
    const unit = meta.promo_price != null ? Number(meta.promo_price) : Number(meta.sale_price);
    const maxQty = mode === "pronta" ? Number(v.available) : mode === "pre" ? Math.min(v.supplier_stock ?? 10, 10) : 0;
    return { variantId: v.id as number, name: meta.name as string, slug: meta.slug as string, color: v.color as string, size: v.size as string,
      image: (meta.image ?? meta.image_url) as string | null, mode, unitPrice: unit, qty: Math.min(it.qty, Math.max(maxQty, 0)), maxQty };
  }).filter(Boolean) as any[];
  return { lines, deliveryDate: storeDeliveryDate(new Date(), s), cutoff: cutoffLabel(s), whatsappReady: !!s.store.whatsapp };
}

// ───────── Fechamento do pedido ─────────
export const checkoutSchema = z.object({
  items: z.array(z.object({ variantId: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(1).max(10) })).min(1, "Sua sacola está vazia."),
  name: z.string().trim().min(3, "Informe seu nome completo."),
  whatsapp: z.string().trim().min(10, "Informe seu WhatsApp com DDD."),
  fulfillment: z.enum(["entrega_local", "retirada"]),
  neighborhood: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  acceptPre: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(80),
});

const SYSTEM_CTX: Ctx = { userId: null as unknown as number, role: "operador", name: "Loja online" };

export async function placeStoreOrder(raw: unknown) {
  const input = checkoutSchema.parse(raw);
  const s = await getSettings();
  if (!s.store.whatsapp) throw new BusinessError("A loja ainda não está recebendo pedidos. Fale com a DRAUM pelo Instagram.");
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  if (input.fulfillment === "entrega_local" && (!input.address || !input.neighborhood))
    throw new BusinessError("Informe bairro e endereço para a entrega.");

  const { lines, deliveryDate } = await cartLines(input.items);
  if (lines.length !== input.items.length || lines.some((l: any) => !l.mode || l.qty < 1))
    throw new BusinessError("Alguma peça da sacola acabou de ficar indisponível. Atualize a sacola e tente de novo.");
  const hasPre = lines.some((l: any) => l.mode === "pre");
  if (hasPre && !input.acceptPre) throw new BusinessError("Confirme que entendeu o prazo das peças sob encomenda.");
  if (!deliveryDate) throw new BusinessError("Não foi possível calcular a data de entrega.");

  // Cliente: encontra pelo WhatsApp ou cria como lead do site
  const customerId = await tx(async (c) => {
    const found = await q1<{ id: number }>(`select id from draum.customers where whatsapp = $1`, [whatsapp], c);
    if (found) {
      await c.query(`update draum.customers set neighborhood = coalesce($2, neighborhood), address = coalesce($3, address),
                       consent_whatsapp = true, consent_at = coalesce(consent_at, now()), consent_source = coalesce(consent_source, 'loja online')
                     where id = $1`, [found.id, input.neighborhood || null, input.address || null]);
      return found.id;
    }
    const r = await q1<{ id: number }>(
      `insert into draum.customers(name, whatsapp, neighborhood, address, lead_source, consent_whatsapp, consent_at, consent_source)
       values ($1,$2,$3,$4,'site',true,now(),'loja online') returning id`,
      [input.name, whatsapp, input.neighborhood || null, input.address || null], c);
    await c.query(`insert into draum.funnel_events(customer_id, stage) values ($1,'novo_lead')`, [r!.id]);
    await audit(c, null, "customer", r!.id, "criar_loja");
    return r!.id;
  });

  const preSupplier = new Map<number, number>();
  if (hasPre) {
    const rows = await q<any>(`${VARIANT_SQL} and v.id = any($1)`, [lines.filter((l: any) => l.mode === "pre").map((l: any) => l.variantId)]);
    rows.forEach((r) => preSupplier.set(r.id, r.supplier_id));
  }
  const order = await createOrder(SYSTEM_CTX, {
    customerId,
    items: lines.map((l: any) => ({
      variantId: l.variantId, qty: l.qty, mode: l.mode,
      supplierId: l.mode === "pre" ? preSupplier.get(l.variantId) : null,
      customerPromisedDate: deliveryDate, termsAccepted: l.mode === "pre" ? true : undefined,
    })),
    fulfillment: input.fulfillment,
    address: input.fulfillment === "entrega_local" ? `${input.address} — ${input.neighborhood}` : null,
    neighborhood: input.neighborhood || null,
    shippingCharged: 0,
    notes: input.notes || null,
    idempotencyKey: input.idempotencyKey,
    channel: "loja",
  });

  const total = round2(lines.reduce((a: number, l: any) => a + l.unitPrice * l.qty, 0));
  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const day = new Date(deliveryDate + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const msg = [
    `Olá, DRAUM! Quero finalizar meu pedido *${order.number}*`,
    "",
    ...lines.map((l: any) => `• ${l.qty}× ${l.name} — ${l.color} / ${l.size} — ${fmt(l.unitPrice * l.qty)}${l.mode === "pre" ? " (sob encomenda)" : ""}`),
    "",
    `*Total: ${fmt(total)}*`,
    input.fulfillment === "entrega_local" ? `Entrega: ${day} · ${input.neighborhood}` : `Retirada combinada com a DRAUM (a partir de ${day})`,
    `Nome: ${input.name}`,
    input.notes ? `Obs.: ${input.notes}` : null,
  ].filter((x) => x != null).join("\n");
  return {
    number: order.number, total, deliveryDate,
    whatsappUrl: `https://wa.me/${s.store.whatsapp}?text=${encodeURIComponent(msg)}`,
  };
}

// ───────── Configuração (CONTROL) ─────────
const storeSettingsSchema = z.object({
  whatsapp: z.string().trim().optional().nullable(),
  margin_pct: z.coerce.number().min(0).max(90),
  price_ending: z.coerce.number().min(0).max(0.99),
  mft_lead_days: z.coerce.number().int().min(0).max(30),
  mft_enabled: z.boolean(),
});

export async function saveStoreSettings(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const o = storeSettingsSchema.parse(raw);
  const cur = (await getSettings()).store ?? STORE_DEFAULTS;
  const next: StoreSettings = { ...cur, ...o, whatsapp: o.whatsapp ? normalizeWhatsapp(o.whatsapp)! : "" };
  await tx(async (c) => {
    await c.query(`insert into draum.settings(key, value, updated_at, updated_by) values ('store',$1,now(),$2)
      on conflict (key) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by`, [JSON.stringify(next), ctx.userId]);
    // Margem mudou: reprecifica o catálogo da distribuidora
    if (cur.margin_pct !== next.margin_pct || cur.price_ending !== next.price_ending) await repriceMft(c, next);
    await audit(c, ctx, "settings", "store", "salvar", next);
  });
}

export async function repriceMft(c: any, st: StoreSettings) {
  const rows = await q<any>(
    `select p.id, ps.unit_cost, ps.inbound_freight from draum.products p
       join draum.product_suppliers ps on ps.product_id = p.id and ps.is_primary
      where p.source = 'mft' and ps.unit_cost > 0`, [], c);
  for (const r of rows)
    await c.query(`update draum.products set sale_price = $2, updated_at = now() where id = $1`,
      [r.id, priceFromCost(Number(r.unit_cost) + Number(r.inbound_freight), st)]);
  return rows.length;
}
