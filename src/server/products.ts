import { z } from "zod";
import { BusinessError, Ctx, q, q1, audit, round2 } from "./core";
import { tx } from "@/lib/db";

export const CATEGORIES: Record<string, { label: string; code: string }> = {
  macaquinhos: { label: "Macaquinhos", code: "MAC" },
  macacoes: { label: "Macacões", code: "MCC" },
  tops: { label: "Tops", code: "TOP" },
  leggings: { label: "Leggings", code: "LEG" },
  shorts: { label: "Shorts", code: "SHO" },
  conjuntos: { label: "Conjuntos", code: "CON" },
  camisetas: { label: "Camisetas", code: "CAM" },
  casaquinhos: { label: "Casaquinhos", code: "CAS" },
  outras: { label: "Outras peças", code: "OUT" },
};

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Sugestão de código de cor: primeira letra + duas últimas (Preto → PTO, Branco → BCO) */
export function suggestColorCode(color: string): string {
  const s = strip(color);
  if (s.length <= 3) return s.padEnd(3, "X");
  return s[0] + s.slice(-2);
}
export const normalizeSize = (s: string) => strip(s);

export const productSchema = z.object({
  name: z.string().trim().min(2, "Nome obrigatório"),
  category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]),
  description: z.string().trim().optional().nullable(),
  image_url: z.string().trim().url("URL de imagem inválida").optional().nullable().or(z.literal("")),
  sale_price: z.coerce.number().min(0),
  promo_price: z.coerce.number().min(0).optional().nullable(),
  modality: z.enum(["pronta", "pre", "ambas"]),
  status: z.enum(["rascunho", "ativo", "pausado", "descontinuado"]),
});

export const variantSchema = z.object({
  color: z.string().trim().min(1),
  color_code: z.string().trim().optional(),
  size: z.string().trim().min(1),
});

async function nextProductCode(c: any, category: string) {
  const cat = CATEGORIES[category].code;
  const r = await q1<{ n: number }>(
    `select coalesce(max(substring(code from 'DRA-${cat}-(\\d+)')::int), 0) + 1 as n from draum.products where code like $1`,
    [`DRA-${cat}-%`], c);
  return `DRA-${cat}-${String(r!.n).padStart(3, "0")}`;
}

export function buildSku(productCode: string, colorCode: string, size: string) {
  return `${productCode}-${strip(colorCode).slice(0, 4)}-${normalizeSize(size)}`;
}

export async function createProduct(ctx: Ctx, input: unknown, variants: unknown[], code?: string) {
  const p = productSchema.parse(input);
  const vs = z.array(variantSchema).min(1, "Cadastre ao menos uma variante (cor e tamanho).").parse(variants);
  if (p.promo_price != null && p.promo_price >= p.sale_price) throw new BusinessError("O preço promocional deve ser menor que o preço de venda.");
  return tx(async (c) => {
    const productCode = code?.trim() ? code.trim().toUpperCase() : await nextProductCode(c, p.category);
    const exists = await q1(`select 1 from draum.products where code = $1`, [productCode], c);
    if (exists) throw new BusinessError(`Já existe um produto com o código ${productCode}.`);
    const prod = await q1<{ id: number }>(
      `insert into draum.products(code,name,category,description,image_url,sale_price,promo_price,modality,status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [productCode, p.name, p.category, p.description || null, p.image_url || null, p.sale_price, p.promo_price ?? null, p.modality, p.status], c);
    await addVariantsTx(c, prod!.id, productCode, vs);
    await audit(c, ctx, "product", prod!.id, "criar", { code: productCode, variants: vs.length });
    return { id: prod!.id, code: productCode };
  });
}

async function addVariantsTx(c: any, productId: number, productCode: string, vs: z.infer<typeof variantSchema>[]) {
  const seen = new Set<string>();
  for (const v of vs) {
    const cc = strip(v.color_code || suggestColorCode(v.color)).slice(0, 4);
    const sku = buildSku(productCode, cc, v.size);
    if (seen.has(sku)) throw new BusinessError(`Variante duplicada: ${sku}.`);
    seen.add(sku);
    const dup = await q1(`select 1 from draum.product_variants where sku = $1`, [sku], c);
    if (dup) throw new BusinessError(`O SKU ${sku} já existe.`);
    const r = await q1<{ id: number }>(
      `insert into draum.product_variants(product_id, sku, color, color_code, size) values ($1,$2,$3,$4,$5) returning id`,
      [productId, sku, v.color.trim(), cc, normalizeSize(v.size)], c);
    await c.query(`insert into draum.inventory(variant_id) values ($1) on conflict do nothing`, [r!.id]);
  }
}

export async function addVariants(ctx: Ctx, productId: number, variants: unknown[]) {
  const vs = z.array(variantSchema).min(1).parse(variants);
  return tx(async (c) => {
    const p = await q1<{ code: string }>(`select code from draum.products where id = $1`, [productId], c);
    if (!p) throw new BusinessError("Produto não encontrado.");
    await addVariantsTx(c, productId, p.code, vs);
    await audit(c, ctx, "product", productId, "adicionar_variantes", vs);
  });
}

export async function setVariantActive(ctx: Ctx, variantId: number, active: boolean) {
  return tx(async (c) => {
    if (!active) {
      const open = await q1<{ n: number }>(
        `select count(*) n from draum.order_items where variant_id = $1 and status not in ('entregue','cancelado','devolvido','trocado')`, [variantId], c);
      if (open!.n > 0) throw new BusinessError("Esta variante tem pedidos em aberto e não pode ser desativada agora.");
    }
    await c.query(`update draum.product_variants set active = $2 where id = $1`, [variantId, active]);
    await audit(c, ctx, "variant", variantId, active ? "ativar" : "desativar");
  });
}

export async function updateProduct(ctx: Ctx, id: number, input: unknown) {
  const p = productSchema.parse(input);
  if (p.promo_price != null && p.promo_price >= p.sale_price) throw new BusinessError("O preço promocional deve ser menor que o preço de venda.");
  return tx(async (c) => {
    const before = await q1(`select * from draum.products where id = $1 for update`, [id], c);
    if (!before) throw new BusinessError("Produto não encontrado.");
    await c.query(
      `update draum.products set name=$2, category=$3, description=$4, image_url=$5, sale_price=$6, promo_price=$7,
         modality=$8, status=$9, updated_at=now() where id=$1`,
      [id, p.name, p.category, p.description || null, p.image_url || null, p.sale_price, p.promo_price ?? null, p.modality, p.status]);
    await audit(c, ctx, "product", id, "editar", { before, after: p });
  });
}

export const productSupplierSchema = z.object({
  supplier_id: z.coerce.number().int().positive(),
  unit_cost: z.coerce.number().min(0),
  inbound_freight: z.coerce.number().min(0).default(0),
  lead_days: z.coerce.number().int().min(0),
  availability_checked: z.boolean().default(false),
  is_primary: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

export async function upsertProductSupplier(ctx: Ctx, productId: number, input: unknown) {
  const s = productSupplierSchema.parse(input);
  return tx(async (c) => {
    if (s.is_primary) await c.query(`update draum.product_suppliers set is_primary = false where product_id = $1`, [productId]);
    await c.query(
      `insert into draum.product_suppliers(product_id, supplier_id, unit_cost, inbound_freight, lead_days, availability_checked_at, is_primary, notes)
       values ($1,$2,$3,$4,$5, case when $6 then now() else null end, $7, $8)
       on conflict (product_id, supplier_id) do update set unit_cost = excluded.unit_cost, inbound_freight = excluded.inbound_freight,
         lead_days = excluded.lead_days, is_primary = excluded.is_primary, notes = excluded.notes,
         availability_checked_at = case when $6 then now() else draum.product_suppliers.availability_checked_at end`,
      [productId, s.supplier_id, s.unit_cost, s.inbound_freight, s.lead_days, s.availability_checked, s.is_primary, s.notes ?? null]);
    await audit(c, ctx, "product_supplier", `${productId}:${s.supplier_id}`, "salvar", s);
  });
}

export async function markAvailabilityChecked(ctx: Ctx, productSupplierId: number) {
  return tx(async (c) => {
    await c.query(`update draum.product_suppliers set availability_checked_at = now() where id = $1`, [productSupplierId]);
    await audit(c, ctx, "product_supplier", productSupplierId, "disponibilidade_verificada");
  });
}

export async function removeProductSupplier(ctx: Ctx, id: number) {
  return tx(async (c) => {
    await c.query(`delete from draum.product_suppliers where id = $1`, [id]);
    await audit(c, ctx, "product_supplier", id, "remover");
  });
}

export async function listProducts(f: { search?: string; category?: string; status?: string; supplierId?: number } = {}) {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.search) { params.push(`%${f.search}%`); where.push(`(p.name ilike $${params.length} or p.code ilike $${params.length} or exists (select 1 from draum.product_variants v2 where v2.product_id=p.id and v2.sku ilike $${params.length}))`); }
  if (f.category) { params.push(f.category); where.push(`p.category = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`p.status = $${params.length}`); }
  if (f.supplierId) { params.push(f.supplierId); where.push(`exists (select 1 from draum.product_suppliers ps2 where ps2.product_id = p.id and ps2.supplier_id = $${params.length})`); }
  return q<any>(
    `select p.*,
       (select count(*) from draum.product_variants v where v.product_id = p.id and v.active) as variant_count,
       (select coalesce(sum(i.qty_physical - i.qty_reserved),0) from draum.product_variants v join draum.inventory i on i.variant_id = v.id where v.product_id = p.id) as available,
       (select coalesce(sum(i.qty_reserved),0) from draum.product_variants v join draum.inventory i on i.variant_id = v.id where v.product_id = p.id) as reserved,
       (select bool_or(i.min_qty > 0 and i.qty_physical - i.qty_reserved <= i.min_qty) from draum.product_variants v join draum.inventory i on i.variant_id = v.id where v.product_id = p.id and v.active) as low_stock,
       ps.unit_cost as primary_cost, ps.inbound_freight as primary_freight, s.name as primary_supplier,
       (select string_agg(distinct v.color, ', ') from draum.product_variants v where v.product_id = p.id and v.active) as colors,
       (select string_agg(distinct v.size, ' · ') from draum.product_variants v where v.product_id = p.id and v.active) as sizes
     from draum.products p
     left join lateral (select * from draum.product_suppliers x where x.product_id = p.id order by is_primary desc, unit_cost asc limit 1) ps on true
     left join draum.suppliers s on s.id = ps.supplier_id
     where ${where.join(" and ")} order by p.created_at desc`, params);
}

export async function getProduct(id: number) {
  const product = await q1<any>(`select * from draum.products where id = $1`, [id]);
  if (!product) return null;
  const variants = await q<any>(
    `select v.*, coalesce(i.qty_physical,0) qty_physical, coalesce(i.qty_reserved,0) qty_reserved,
            coalesce(i.qty_physical - i.qty_reserved,0) qty_available, coalesce(i.qty_in_transit,0) qty_in_transit,
            coalesce(i.min_qty,0) min_qty, coalesce(i.avg_cost,0) avg_cost
       from draum.product_variants v left join draum.inventory i on i.variant_id = v.id
      where v.product_id = $1 order by v.color, array_position(array['PP','P','M','G','GG','XG','U'], v.size), v.size`, [id]);
  const suppliers = await q<any>(
    `select ps.*, s.name as supplier_name from draum.product_suppliers ps join draum.suppliers s on s.id = ps.supplier_id
      where ps.product_id = $1 order by ps.is_primary desc, s.name`, [id]);
  return { product, variants, suppliers };
}

/** Lista de variantes vendáveis para o formulário de pedido */
export async function sellableVariants() {
  return q<any>(
    `select v.id, v.sku, v.color, v.size, p.id as product_id, p.name, p.category, p.sale_price, p.promo_price, p.modality, p.image_url,
            coalesce(i.qty_physical - i.qty_reserved, 0) as available, coalesce(i.avg_cost,0) avg_cost,
            coalesce((select json_agg(json_build_object('supplier_id', ps.supplier_id, 'name', s.name, 'unit_cost', ps.unit_cost,
                   'inbound_freight', ps.inbound_freight, 'lead_days', ps.lead_days, 'checked_at', ps.availability_checked_at,
                   'is_primary', ps.is_primary) order by ps.is_primary desc)
               from draum.product_suppliers ps join draum.suppliers s on s.id = ps.supplier_id where ps.product_id = p.id and s.active), '[]') as suppliers
       from draum.product_variants v join draum.products p on p.id = v.product_id
       left join draum.inventory i on i.variant_id = v.id
      where v.active and p.status = 'ativo' and p.sale_price > 0 order by p.name, v.color, v.size`);
}

// ───────── Importação CSV ─────────
// Colunas: codigo_produto(opcional), nome, categoria, descricao, preco_venda, preco_promocional, modalidade, cor, codigo_cor, tamanho, imagem_url
export interface ImportReport { created: number; variants: number; errors: { line: number; message: string }[] }

export async function importProductsCsv(ctx: Ctx, rows: Record<string, string>[], dryRun = false): Promise<ImportReport> {
  const report: ImportReport = { created: 0, variants: 0, errors: [] };
  type G = { line: number; product: any; code?: string; variants: any[] };
  const groups = new Map<string, G>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const cat = strip(r.categoria || "").toLowerCase();
    const catKey = Object.keys(CATEGORIES).find((k) => strip(k).toLowerCase() === cat || strip(CATEGORIES[k].label).toLowerCase() === cat);
    if (!r.nome?.trim()) return report.errors.push({ line, message: "nome vazio" });
    if (!catKey) return report.errors.push({ line, message: `categoria inválida: "${r.categoria}"` });
    if (!r.cor?.trim() || !r.tamanho?.trim()) return report.errors.push({ line, message: "cor e tamanho são obrigatórios" });
    const price = Number(String(r.preco_venda ?? "").replace(/\./g, "").replace(",", "."));
    if (!(price >= 0) || r.preco_venda === "" || r.preco_venda == null) return report.errors.push({ line, message: "preco_venda inválido" });
    const promoRaw = String(r.preco_promocional ?? "").trim();
    const promo = promoRaw ? Number(promoRaw.replace(/\./g, "").replace(",", ".")) : null;
    const key = (r.codigo_produto?.trim() || "") + "|" + r.nome.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, {
      line, code: r.codigo_produto?.trim() || undefined,
      product: { name: r.nome.trim(), category: catKey, description: r.descricao || null, image_url: r.imagem_url || null,
        sale_price: price, promo_price: promo, modality: (["pronta", "pre", "ambas"].includes(r.modalidade) ? r.modalidade : "ambas"), status: "ativo" },
      variants: [],
    });
    groups.get(key)!.variants.push({ color: r.cor.trim(), color_code: r.codigo_cor?.trim() || undefined, size: r.tamanho.trim() });
  });
  if (dryRun || report.errors.length) return { ...report, created: dryRun ? groups.size : 0 };
  for (const g of groups.values()) {
    try {
      await createProduct(ctx, g.product, g.variants, g.code);
      report.created++; report.variants += g.variants.length;
    } catch (e: any) {
      report.errors.push({ line: g.line, message: e.message });
    }
  }
  return report;
}

export const unitCostWithFreight = (ps: { unit_cost: number; inbound_freight: number }) => round2(Number(ps.unit_cost) + Number(ps.inbound_freight));
