import { promoUnitPrice } from "./pricing";
import { z } from "zod";
import { BusinessError, Ctx, q, q1, round2, audit, requireAdmin, getSettings, Settings, StoreSettings, STORE_DEFAULTS } from "./core";
import { tx } from "@/lib/db";
import { firstEligibleTuesday, cutoffFor } from "./delivery";
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

// ───────── Promoções da loja (Black Friday) ─────────
export interface StorePromo { id: number; name: string; pct: number; requiresVip: boolean; startsAt: Date; endsAt: Date; productIds: number[] | null }

/** Promoções de Black Friday cadastradas no CONTROL (as da loja). */
export async function storePromotions(): Promise<StorePromo[]> {
  const rows = await q<any>(
    `select p.id, p.name, p.pct, p.requires_vip, p.starts_at, p.ends_at, p.all_products,
            (select array_agg(product_id) from draum.promotion_products pp where pp.promotion_id = p.id) as product_ids
       from draum.promotions p where p.kind = 'black_friday' and p.active and p.min_items <= 1 and p.coupon_code is null
      order by p.starts_at`);
  return rows.map((r) => ({ id: r.id, name: r.name, pct: Number(r.pct), requiresVip: r.requires_vip, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at),
    productIds: r.all_products ? null : (r.product_ids ?? []).map(Number) }));
}

/** Melhor promoção vigente para a cliente (VIP vê também a do acesso antecipado) */
export function activePromo(promos: StorePromo[], isVip: boolean, now = new Date()) {
  return promos.filter((p) => now >= p.startsAt && now <= p.endsAt && (!p.requiresVip || isVip)).sort((a, b) => b.pct - a.pct)[0] ?? null;
}
const promoApplies = (p: StorePromo | null, productId: number) => !!p && (p.productIds == null || p.productIds.includes(productId));
const discounted = (price: number, pct: number) => promoUnitPrice(price, pct);

/** Link do acesso antecipado: o cookie guarda o código do grupo VIP */
export async function isVipCode(code: string | undefined | null) {
  if (!code) return false;
  const s = await getSettings();
  return !!s.store.vip_code && code === s.store.vip_code;
}

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
  id: number; slug: string; name: string; category: string; categoryLabel: string; price: number; promoPrice: number | null; promoPct: number | null;
  image: string | null; colors: { name: string; hex: string | null }[]; sizes: string[];
  hasPronta: boolean; hasPre: boolean; prontaUnits: number; unique: boolean; source: string;
}

/** Prévia (ambiente de aprovação): mostra também as peças próprias ainda ocultas. Nunca ligado em produção. */
const VISIBLE = process.env.STORE_PREVIEW === "1" ? "(p.store_visible or p.source = 'proprio')" : "p.store_visible";

export const imageSrc = (img: { id: number; url: string | null }) => img.url ?? `/loja/img/${img.id}`;

export async function listStoreProducts(isVip = false, now = new Date()): Promise<StoreCard[]> {
  const s = await getSettings();
  const promo = activePromo(await storePromotions(), isVip, now);
  const products = await q<any>(
    `select p.id, p.slug, p.name, p.category, p.sale_price, p.promo_price, p.image_url, p.source, p.created_at,
            (select json_build_object('id', im.id, 'url', im.url) from draum.product_images im where im.product_id = p.id order by im.position, im.id limit 1) as img
       from draum.products p
      where p.status = 'ativo' and ${VISIBLE} and p.slug is not null and p.sale_price > 0
        and ($1::boolean or p.source <> 'mft')
      order by (p.source = 'proprio') desc, p.created_at desc`, [s.store.mft_enabled]);
  if (!products.length) return [];
  const variants = await q<any>(`${VARIANT_SQL} and v.product_id = any($1)`, [products.map((p) => p.id)]);
  const byProduct = new Map<number, any[]>();
  for (const v of variants) (byProduct.get(v.product_id) ?? byProduct.set(v.product_id, []).get(v.product_id)!).push(v);
  const cards: StoreCard[] = [];
  for (const p of products) {
    const vs = (byProduct.get(p.id) ?? []).map((v) => ({ ...v, mode: variantMode(v, s.availability_valid_days, now) })).filter((v) => v.mode);
    if (!vs.length) continue;
    if (p.source === "mft" && !p.img && !p.image_url) continue; // peça da distribuidora sem foto não vende: fica fora até ganhar foto
    const colors = new Map<string, string | null>();
    vs.forEach((v) => colors.set(v.color, v.color_hex ?? colors.get(v.color) ?? null));
    const pronta = vs.filter((v) => v.mode === "pronta");
    const prontaUnits = pronta.reduce((a, v) => a + Number(v.available), 0);
    cards.push({
      id: p.id, slug: p.slug, name: p.name, category: p.category, categoryLabel: CATEGORIES[p.category]?.label ?? p.category,
      price: Number(p.sale_price),
      promoPrice: promoApplies(promo, p.id) ? discounted(Number(p.sale_price), promo!.pct) : p.promo_price != null ? Number(p.promo_price) : null,
      promoPct: promoApplies(promo, p.id) ? promo!.pct : null,
      image: p.img ? imageSrc(p.img) : p.image_url ?? null,
      colors: [...colors].map(([name, hex]) => ({ name, hex })),
      sizes: [...new Set(vs.map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b)),
      hasPronta: pronta.length > 0, hasPre: vs.some((v) => v.mode === "pre"), prontaUnits,
      unique: pronta.length > 0 && prontaUnits === 1 && !vs.some((v) => v.mode === "pre"),
      source: p.source,
    });
  }
  return cards;
}

export async function getStoreProduct(slug: string, isVip = false, now = new Date()) {
  const s = await getSettings();
  const promo = activePromo(await storePromotions(), isVip, now);
  const p = await q1<any>(
    `select p.* from draum.products p where p.slug = $1 and p.status = 'ativo' and ${VISIBLE} and ($2::boolean or p.source <> 'mft')`,
    [slug, s.store.mft_enabled]);
  if (!p) return null;
  const variants = (await q<any>(`${VARIANT_SQL} and v.product_id = $1`, [p.id]))
    .map((v) => ({ id: v.id as number, color: v.color as string, hex: v.color_hex as string | null, size: v.size as string,
      available: Number(v.available), mode: variantMode(v, s.availability_valid_days, now) }))
    .sort((a, b) => a.color.localeCompare(b.color) || sizeRank(a.size) - sizeRank(b.size));
  const images = (await q<any>(`select id, url, color from draum.product_images where product_id = $1 order by position, id`, [p.id]))
    .map((im) => ({ src: imageSrc(im), color: im.color as string | null }));
  if (!images.length && p.image_url) images.push({ src: p.image_url, color: null });
  if (!images.length && p.source === "mft") return null;
  return {
    product: { id: p.id, slug: p.slug, name: p.name, category: p.category, categoryLabel: CATEGORIES[p.category]?.label ?? p.category,
      description: p.description as string | null, price: Number(p.sale_price),
      promoPrice: promoApplies(promo, p.id) ? discounted(Number(p.sale_price), promo!.pct) : p.promo_price != null ? Number(p.promo_price) : null,
      promoPct: promoApplies(promo, p.id) ? promo!.pct : null, promoName: promoApplies(promo, p.id) ? promo!.name : null,
      promoEnds: promoApplies(promo, p.id) ? promo!.endsAt.toISOString() : null },
    variants, images, deliveryDate: storeDeliveryDate(now, s), cutoff: cutoffLabel(s),
    cutoffAt: (() => { const d = storeDeliveryDate(now, s); return d ? cutoffFor(d, s).toISOString() : null; })(),
  };
}

/** Dados do carrinho (preços e disponibilidade sempre vindos do servidor) */
export async function cartLines(items: { variantId: number; qty: number }[], isVip = false, now = new Date()) {
  const s = await getSettings();
  const promo = activePromo(await storePromotions(), isVip, now);
  const promoInfo = promo ? { id: promo.id, name: promo.name, pct: promo.pct } : null;
  if (!items.length) return { lines: [], deliveryDate: storeDeliveryDate(now, s), cutoff: cutoffLabel(s), cutoffAt: null as string | null, whatsappReady: !!s.store.whatsapp, promo: promoInfo, onlinePayment: !!s.store.infinitepay_handle };
  const rows = await q<any>(
    `${VARIANT_SQL} and v.id = any($1) and p.status = 'ativo' and ${VISIBLE}`, [items.map((i) => i.variantId)]);
  const info = await q<any>(
    `select v.id, p.id as product_id, p.name, p.slug, p.sale_price, p.promo_price,
            (select coalesce(im.url, '/loja/img/' || im.id) from draum.product_images im where im.product_id = p.id
              and (im.color is null or im.color = v.color) order by (im.color = v.color) desc nulls last, im.position, im.id limit 1) as image,
            p.image_url
       from draum.product_variants v join draum.products p on p.id = v.product_id where v.id = any($1)`, [items.map((i) => i.variantId)]);
  const lines = items.map((it) => {
    const v = rows.find((r) => r.id === it.variantId);
    const meta = info.find((r) => r.id === it.variantId);
    if (!v || !meta) return null;
    const mode = variantMode(v, s.availability_valid_days, now);
    const maxQty = mode === "pronta" ? Number(v.available) : mode === "pre" ? Math.min(v.supplier_stock ?? 10, 10) : 0;
    const qty = Math.min(it.qty, Math.max(maxQty, 0));
    // Mesmo cálculo do CONTROL: com a Black Friday, o preço unitário termina em ,90
    const onPromo = promoApplies(promo, meta.product_id);
    const base = Number(meta.sale_price);
    const unit = onPromo ? discounted(base, promo!.pct) : meta.promo_price != null ? Number(meta.promo_price) : base;
    const lineTotal = round2(qty * unit);
    return { variantId: v.id as number, name: meta.name as string, slug: meta.slug as string, color: v.color as string, size: v.size as string,
      image: (meta.image ?? meta.image_url) as string | null, mode, unitPrice: unit, listPrice: base, onPromo, lineTotal, qty, maxQty };
  }).filter(Boolean) as any[];
  const dd = storeDeliveryDate(now, s);
  return { lines, deliveryDate: dd, cutoff: cutoffLabel(s), cutoffAt: dd ? cutoffFor(dd, s).toISOString() : null, whatsappReady: !!s.store.whatsapp, promo: promoInfo, onlinePayment: !!s.store.infinitepay_handle };
}

// ───────── Fechamento do pedido ─────────
export const checkoutSchema = z.object({
  items: z.array(z.object({ variantId: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(1).max(10) })).min(1, "Sua sacola está vazia."),
  name: z.string().trim().min(3, "Informe seu nome completo."),
  whatsapp: z.string().trim().min(10, "Informe seu WhatsApp com DDD."),
  email: z.string().trim().email("E-mail inválido.").optional().nullable().or(z.literal("")),
  marketing: z.boolean().optional(),
  fulfillment: z.enum(["entrega_local", "retirada"]),
  neighborhood: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  acceptPre: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(80),
});

const SYSTEM_CTX: Ctx = { userId: null as unknown as number, role: "operador", name: "Loja online" };

export async function placeStoreOrder(raw: unknown, isVip = false) {
  const input = checkoutSchema.parse(raw);
  const s = await getSettings();
  if (!s.store.whatsapp) throw new BusinessError("A loja ainda não está recebendo pedidos. Fale com a DRAUM pelo Instagram.");
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  if (input.fulfillment === "entrega_local" && (!input.address || !input.neighborhood))
    throw new BusinessError("Informe bairro e endereço para a entrega.");

  const { lines, deliveryDate, promo } = await cartLines(input.items, isVip);
  const usesPromo = !!promo && lines.some((l: any) => l.onPromo);
  if (lines.length !== input.items.length || lines.some((l: any) => !l.mode || l.qty < 1))
    throw new BusinessError("Alguma peça da sacola acabou de ficar indisponível. Atualize a sacola e tente de novo.");
  const hasPre = lines.some((l: any) => l.mode === "pre");
  if (hasPre && !input.acceptPre) throw new BusinessError("Confirme que entendeu o prazo das peças sob encomenda.");
  if (!deliveryDate) throw new BusinessError("Não foi possível calcular a data de entrega.");

  // Cliente: encontra pelo WhatsApp ou cria como lead do site
  const customerId = await upsertStoreCustomer({
    name: input.name, whatsapp: whatsapp!, email: input.email || null, neighborhood: input.neighborhood || null, address: input.address || null,
    marketing: !!input.marketing, vip: usesPromo && !!promo && isVip, source: "pedido na loja online",
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
    promotionId: usesPromo ? promo!.id : null,
  });

  const total = round2(lines.reduce((a: number, l: any) => a + l.lineTotal, 0));
  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const day = new Date(deliveryDate + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const msg = [
    `Olá, DRAUM! Quero finalizar meu pedido *${order.number}*`,
    "",
    ...lines.map((l: any) => `• ${l.qty}× ${l.name} — ${l.color} / ${l.size} — ${fmt(l.lineTotal)}${l.mode === "pre" ? " (sob encomenda)" : ""}`),
    "",
    usesPromo ? `${promo!.name}: ${promo!.pct}% OFF aplicado` : null,
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
  infinitepay_handle: z.string().trim().max(60).optional().nullable(),
});

export async function saveStoreSettings(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const o = storeSettingsSchema.parse(raw);
  const cur = (await getSettings()).store ?? STORE_DEFAULTS;
  const next: StoreSettings = { ...cur, ...o, whatsapp: o.whatsapp ? normalizeWhatsapp(o.whatsapp)! : "",
    infinitepay_handle: (o.infinitepay_handle ?? "").trim().replace(/^\$/, "") };
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

// ───────── Cadastro de clientes pela loja (WhatsApp, e-mail e consentimento) ─────────
/** Cria ou atualiza a cliente pelo WhatsApp. Consentimento de WhatsApp/e-mail só com aceite explícito (LGPD). */
export async function upsertStoreCustomer(d: {
  name: string; whatsapp: string; email: string | null; neighborhood?: string | null; address?: string | null;
  marketing: boolean; vip: boolean; source: string;
}) {
  return tx(async (c) => {
    const found = await q1<{ id: number }>(`select id from draum.customers where whatsapp = $1`, [d.whatsapp], c);
    let id: number;
    if (found) {
      id = found.id;
      await c.query(
        `update draum.customers set
           email = coalesce($2::text, email), neighborhood = coalesce($3::text, neighborhood), address = coalesce($4::text, address),
           consent_whatsapp = consent_whatsapp or $5::boolean, consent_email = consent_email or ($5::boolean and $2::text is not null),
           consent_at = case when $5::boolean then coalesce(consent_at, now()) else consent_at end,
           consent_source = case when $5::boolean then coalesce(consent_source, $7::text) else consent_source end,
           vip_joined_at = case when $6::boolean then coalesce(vip_joined_at, current_date) else vip_joined_at end
         where id = $1`, [id, d.email, d.neighborhood ?? null, d.address ?? null, d.marketing, d.vip, d.source]);
    } else {
      const r = await q1<{ id: number }>(
        `insert into draum.customers(name, whatsapp, email, neighborhood, address, lead_source, vip_joined_at, funnel_stage,
           consent_whatsapp, consent_email, consent_at, consent_source)
         values ($1,$2,$3::text,$4,$5,'site', case when $6::boolean then current_date end, case when $6::boolean then 'entrou_vip' else 'novo_lead' end,
           $7::boolean, $7::boolean and $3::text is not null, case when $7::boolean then now() end, case when $7::boolean then $8::text end) returning id`,
        [d.name, d.whatsapp, d.email, d.neighborhood ?? null, d.address ?? null, d.vip, d.marketing, d.source], c);
      id = r!.id;
      await c.query(`insert into draum.funnel_events(customer_id, stage) values ($1,'novo_lead')`, [id]);
      if (d.vip) await c.query(`insert into draum.funnel_events(customer_id, stage) values ($1,'entrou_vip')`, [id]);
      await audit(c, null, "customer", id, "criar_loja", { source: d.source });
    }
    return id;
  });
}

export const leadSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome."),
  whatsapp: z.string().trim().min(10, "Informe seu WhatsApp com DDD."),
  email: z.string().trim().email("E-mail inválido.").optional().nullable().or(z.literal("")),
  consent: z.literal(true, { message: "Marque a autorização para receber as novidades." }),
});

/** Cadastro na lista de novidades (home) ou no acesso antecipado (link VIP) */
export async function registerLead(raw: unknown, opts: { vip: boolean }) {
  const d = leadSchema.parse(raw);
  const whatsapp = normalizeWhatsapp(d.whatsapp)!;
  return upsertStoreCustomer({ name: d.name, whatsapp, email: d.email || null, marketing: true, vip: opts.vip,
    source: opts.vip ? "acesso antecipado VIP (loja)" : "lista de novidades (loja)" });
}

/** Vitrine "Os mais desejados": a lista escolhida na configuração; sem lista, as peças MFT de pronta-entrega e a seleção padrão */
export const DEFAULT_FEATURED = ["conjunto-pulse", "conjunto-ryze", "conjunto-cold-2-0", "conjunto-club", "macaquito-street", "conjunto-glow", "conjunto-pilates", "conjunto-flare"];
export function featuredCards(all: StoreCard[], slugs: string[] | undefined, max = 12) {
  const pick = new Map<string, StoreCard>();
  const bySlug = new Map(all.map((c) => [c.slug, c]));
  if (slugs?.length) for (const sl of slugs) { const c = bySlug.get(sl); if (c) pick.set(sl, c); }
  else {
    // Por enquanto a vitrine destaca só a MFT (fotos de estúdio): primeiro as de pronta-entrega, depois a seleção
    for (const c of all) if (c.source === "mft" && c.hasPronta) pick.set(c.slug, c);
    for (const sl of DEFAULT_FEATURED) { const c = bySlug.get(sl); if (c && c.source === "mft") pick.set(sl, c); }
  }
  return [...pick.values()].filter((c) => c.image).slice(0, max);
}
