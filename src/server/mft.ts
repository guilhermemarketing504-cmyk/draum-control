import { parse, HTMLElement } from "node-html-parser";
import { BusinessError, Ctx, q, q1, audit, requireAdmin, getSettings, StoreSettings } from "./core";
import { tx, getPool } from "@/lib/db";
import { suggestColorCode, buildSku, normalizeSize } from "./products";
import { priceFromCost, repriceMft } from "./store";

/*
  Robô da distribuidora MFT (mftmoodrevenda.com.br — plataforma Wbuy)
  O que é público (sem login): nome, descrição, fotos por cor, cores (com hex) e, por cor, os tamanhos
  com a quantidade em estoque (atributo max do campo de quantidade). O preço só aparece para revendedor
  logado, e o login tem reCAPTCHA: por isso o custo é informado no CONTROL (tela de custos) e não lido pelo robô.
*/

export const MFT_BASE = "https://www.mftmoodrevenda.com.br/";

/** Categoria da MFT → categoria do CONTROL */
export const MFT_CATEGORIES: Record<string, string> = {
  "conjunto-calca": "conjuntos", "conjunto-short": "conjuntos", calca: "leggings", short: "shorts",
  macaquito: "macaquinhos", macacao: "macacoes", blusa: "camisetas", top: "tops", acessorios: "outras",
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

// A MFT limita o ritmo de acessos (HTTP 429): no máximo 1 requisição por vez, com intervalo mínimo entre elas.
const MIN_INTERVAL_MS = Number(process.env.MFT_REQUEST_INTERVAL_MS ?? 1500);
let lastRequest = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let queue: Promise<unknown> = Promise.resolve();

async function throttledFetch(url: URL): Promise<Response> {
  const run = async () => {
    const wait = lastRequest + MIN_INTERVAL_MS + Math.random() * 400 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    return fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store" });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export async function fetchHtml(path: string): Promise<string> {
  const url = new URL(path, MFT_BASE);
  for (let attempt = 1; ; attempt++) {
    const res = await throttledFetch(url);
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep((Number.isFinite(ra) && ra > 0 ? ra * 1000 : 15_000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`MFT respondeu ${res.status} em ${path}`);
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") ?? "";
    // o site da MFT é servido em ISO-8859-1
    const charset = /utf-?8/i.test(ct) ? "utf-8" : "windows-1252";
    return new TextDecoder(charset).decode(buf);
  }
}

export interface ListedProduct { slug: string; name: string; category: string }

/** Lê as vitrines de categoria (100 itens por página) */
export function parseListing(html: string): { slug: string; name: string }[] {
  const root = parse(html);
  return root.querySelectorAll(".item[data-sku]").map((it) => {
    const a = it.querySelector("a.foto_wrapper") ?? it.querySelector("a[href]");
    const slug = (a?.getAttribute("href") ?? "").replace(/^\/+|\/+$/g, "");
    const name = (it.querySelector("h3.produto")?.getAttribute("title") ?? it.querySelector("h3")?.text ?? "").trim();
    return { slug, name };
  }).filter((p) => p.slug && !p.slug.startsWith("login") && !p.slug.includes("?"));
}

export async function listCatalog(): Promise<ListedProduct[]> {
  const found = new Map<string, ListedProduct>();
  for (const [cat, mapped] of Object.entries(MFT_CATEGORIES)) {
    for (let page = 1; page <= 10; page++) {
      const items = parseListing(await fetchHtml(`${cat}/?page=${page}`));
      for (const it of items) if (!found.has(it.slug)) found.set(it.slug, { ...it, category: mapped });
      if (items.length < 100) break;
    }
  }
  return [...found.values()];
}

export interface ParsedColor { id: string; name: string; hex: string | null; sizes: { size: string; stock: number; sku: string }[]; images: string[] }
export interface ParsedProduct { externalId: string; name: string; description: string | null; colors: ParsedColor[]; images: string[] }

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&rarr;/g, "→")
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function blockText(el: HTMLElement): string {
  const html = el.innerHTML
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(html).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export function parseProduct(html: string): ParsedProduct {
  const externalId = html.match(/var produto_id\s*=\s*'(\d+)'/)?.[1];
  if (!externalId) throw new Error("Página sem identificador de produto");
  const root = parse(html);
  const name = (root.querySelector('meta[itemprop="name"]')?.getAttribute("content") ?? root.querySelector("h1")?.text ?? "").trim();

  // Fotos por cor: <a class="fancybox" data-fancybox-group="d-{produto}-{cor}" href="…">
  const imagesByColor = new Map<string, string[]>();
  const allImages: string[] = [];
  for (const a of root.querySelectorAll(".fotos .big a.fancybox, a.fancybox[data-fancybox-group]")) {
    const href = a.getAttribute("href") ?? a.getAttribute("data-standard");
    if (!href || !/^https?:\/\//.test(href) || allImages.includes(href)) continue;
    const cor = a.getAttribute("data-fancybox-group")?.split("-")[2] ?? "";
    allImages.push(href);
    (imagesByColor.get(cor) ?? imagesByColor.set(cor, []).get(cor)!).push(href);
  }

  // Cores e tamanhos: cada bloco .l tem o nome da cor, o swatch e os campos de quantidade (max = estoque)
  const colors: ParsedColor[] = [];
  for (const sw of root.querySelectorAll(".cor.mt")) {
    const block = sw.parentNode as HTMLElement;
    const prim = sw.querySelector(".cor_primaria");
    const id = prim?.getAttribute("data-cor") ?? "";
    const colorName = (prim?.getAttribute("data-cornome") ?? block.querySelector(".variacao_cor_nome")?.text ?? "Única").trim();
    const hex = prim?.getAttribute("style")?.match(/#([0-9a-f]{3,8})/i)?.[0] ?? null;
    const sizes = block.querySelectorAll(".vars .it").map((it) => {
      const input = it.querySelector("input");
      return {
        size: normalizeSize((it.querySelector(".t")?.text || it.getAttribute("title") || "U").split(" - ")[0]),
        stock: Math.max(0, parseInt(input?.getAttribute("max") ?? "0", 10) || 0),
        sku: input?.getAttribute("data-sku") ?? "",
      };
    }).filter((s) => s.size && s.sku);
    if (!id || !sizes.length) continue;
    colors.push({ id, name: colorName, hex, sizes, images: imagesByColor.get(id) ?? [] });
  }

  const info = root.querySelector("section.info_wrapper");
  let description: string | null = info ? blockText(info).replace(/^Sobre o produto\s*/i, "").trim() : null;
  if (!description) description = decodeEntities(root.querySelector('meta[itemprop="description"]')?.getAttribute("content") ?? "").trim() || null;
  return { externalId, name, description, colors, images: allImages };
}

/** Executa tarefas com concorrência limitada */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = e as Error; }
    }
  }));
  return out;
}

export interface SyncReport { runId: number; seen: number; created: number; updated: number; paused: number; withoutCost: number; costs?: number; errors: string[] }

let running = false;
export const isSyncRunning = () => running;

/** Sincroniza o catálogo da MFT com o CONTROL. ctx = null quando disparado pelo agendador. */
export interface CatalogItem { listed: ListedProduct; parsed: ParsedProduct; cost?: number | null }

/** Leitura pelo servidor (pode ser bloqueada pela MFT fora do Brasil) */
export async function syncMft(ctx: Ctx | null): Promise<SyncReport> {
  if (ctx) requireAdmin(ctx);
  return runSync(ctx, "servidor", async () => {
    const listed = await listCatalog();
    if (listed.length < 10) {
      const sample = await fetchHtml("todos-os-produtos/").catch((e) => String(e));
      const title = sample.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? sample.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(`Catálogo veio com apenas ${listed.length} peças (a MFT entregou: "${title}"). Use a leitura pelo navegador. Nada foi alterado.`);
    }
    const pages = await pool(listed, 1, async (l) => ({ listed: l, parsed: parseProduct(await fetchHtml(`${l.slug}/`)) }));
    const errors: string[] = [];
    const items: CatalogItem[] = [];
    for (const r of pages) if (r instanceof Error) errors.push(r.message); else items.push(r);
    return { items, errors, total: listed.length };
  });
}

/** Leitura feita no navegador do revendedor (logado na MFT): traz também o custo */
export async function importMftFromBrowser(raw: unknown): Promise<SyncReport> {
  const body = raw as { items?: any[]; total?: number; errors?: string[] };
  if (!Array.isArray(body?.items)) throw new BusinessError("Envio inválido.");
  const items: CatalogItem[] = body.items.slice(0, 2000).map((it) => ({
    listed: { slug: String(it.slug), name: String(it.name ?? ""), category: MFT_CATEGORIES[it.category] ?? (Object.values(MFT_CATEGORIES).includes(it.category) ? it.category : "outras") },
    parsed: {
      externalId: String(it.externalId), name: String(it.name ?? ""), description: it.description ? String(it.description).slice(0, 5000) : null,
      images: (Array.isArray(it.images) ? it.images : []).filter((u: any) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 60),
      colors: (Array.isArray(it.colors) ? it.colors : []).map((c: any) => ({
        id: String(c.id), name: String(c.name ?? "Única").slice(0, 60), hex: typeof c.hex === "string" && /^#[0-9a-f]{3,8}$/i.test(c.hex) ? c.hex : null,
        images: (Array.isArray(c.images) ? c.images : []).filter((u: any) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 30),
        sizes: (Array.isArray(c.sizes) ? c.sizes : []).map((z: any) => ({ size: normalizeSize(String(z.size ?? "U").split(" - ")[0]), stock: Math.max(0, Math.trunc(Number(z.stock)) || 0), sku: String(z.sku ?? "") }))
          .filter((z: any) => z.size && z.sku),
      })).filter((c: any) => c.id && c.sizes.length),
    },
    cost: Number.isFinite(Number(it.cost)) && Number(it.cost) > 0 ? Math.round(Number(it.cost) * 100) / 100 : null,
  })).filter((i) => /^\d+$/.test(i.parsed.externalId) && i.listed.slug && i.parsed.colors.length);
  return runSync(null, "navegador", async () => ({ items, errors: (body.errors ?? []).map(String).slice(0, 50), total: Number(body.total) || items.length }));
}

async function runSync(ctx: Ctx | null, origin: "servidor" | "navegador",
  gather: () => Promise<{ items: CatalogItem[]; errors: string[]; total: number }>): Promise<SyncReport> {
  if (running) throw new BusinessError("Já existe uma sincronização em andamento. Aguarde alguns minutos.");
  running = true;
  const s = await getSettings();
  const supplierId = s.store.mft_supplier_id
    ?? (await q1<{ id: number }>(`select id from draum.suppliers where name = 'MFT (revenda)'`))?.id;
  if (!supplierId) { running = false; throw new BusinessError("Fornecedor MFT não encontrado. Rode as migrações."); }
  const run = await q1<{ id: number }>(`insert into draum.supplier_sync_runs(supplier_id, logged_in) values ($1,$2) returning id`, [supplierId, origin === "navegador"]);
  const report: SyncReport = { runId: run!.id, seen: 0, created: 0, updated: 0, paused: 0, withoutCost: 0, errors: [] };
  try {
    const { items, errors, total } = await gather();
    report.errors.push(...errors);
    if (items.length < 10) throw new Error(`Leitura com apenas ${items.length} peças. Nada foi alterado.`);
    const seenIds: string[] = [];
    let costs = 0;
    for (const it of items) {
      try {
        const res = await upsertMftProduct(it.listed, it.parsed, supplierId, s.store);
        seenIds.push(it.parsed.externalId);
        report.seen++;
        if (res === "created") report.created++; else report.updated++;
        if (it.cost) {
          await q(`update draum.product_suppliers ps set unit_cost = $2 from draum.products p
                    where ps.product_id = p.id and p.source = 'mft' and p.external_id = $1 and ps.is_primary`, [it.parsed.externalId, it.cost]);
          costs++;
        }
      } catch (e) {
        report.errors.push(`${it.listed.slug}: ${(e as Error).message}`);
      }
    }
    report.costs = costs;
    if (costs) await tx((c) => repriceMft(c, s.store).then(() => undefined));
    // Peças que saíram do catálogo da MFT: pausa (só quando a leitura foi completa)
    if (report.errors.length <= Math.max(5, total * 0.1) && report.seen >= total * 0.9) {
      const paused = await q<{ id: number }>(
        `update draum.products set status = 'pausado', updated_at = now()
          where source = 'mft' and status = 'ativo' and not (external_id = any($1)) returning id`, [seenIds]);
      report.paused = paused.length;
    }
    report.withoutCost = (await q1<{ n: number }>(
      `select count(*) n from draum.products p join draum.product_suppliers ps on ps.product_id = p.id and ps.is_primary
        where p.source = 'mft' and ps.unit_cost = 0 and p.status <> 'pausado'`))!.n;
    const note = [origin === "navegador" ? `Leitura pelo navegador${costs ? `, ${costs} custos atualizados` : ""}.` : null, ...report.errors.slice(0, 20)].filter(Boolean).join("\n");
    await q(`update draum.supplier_sync_runs set finished_at = now(), status = 'ok', products_seen = $2, products_created = $3,
               products_updated = $4, products_paused = $5, without_cost = $6, message = $7 where id = $1`,
      [run!.id, report.seen, report.created, report.updated, report.paused, report.withoutCost, note || null]);
    if (ctx) await audit(getPool(), ctx, "supplier", supplierId, "sincronizar_mft", report);
    return report;
  } catch (e) {
    await q(`update draum.supplier_sync_runs set finished_at = now(), status = 'erro', message = $2 where id = $1`, [run!.id, (e as Error).message]);
    throw e instanceof BusinessError ? e : new BusinessError(`Falha ao sincronizar com a MFT: ${(e as Error).message}`);
  } finally {
    running = false;
  }
}

async function upsertMftProduct(l: ListedProduct, p: ParsedProduct, supplierId: number, st: StoreSettings): Promise<"created" | "updated"> {
  return tx(async (c) => {
    const code = `MFT-${p.externalId}`;
    let prod = await q1<any>(`select id, code, status from draum.products where source = 'mft' and external_id = $1`, [p.externalId], c);
    const totalStock = p.colors.reduce((a, col) => a + col.sizes.reduce((b, sz) => b + sz.stock, 0), 0);
    let created = false;
    if (!prod) {
      const slugTaken = await q1(`select 1 from draum.products where slug = $1`, [l.slug], c);
      prod = await q1<any>(
        `insert into draum.products(code, name, category, description, image_url, sale_price, modality, status, source, external_id, external_url, slug, synced_at)
         values ($1,$2,$3,$4,$5,0,'pre','ativo','mft',$6,$7,$8,now()) returning id, code, status`,
        [code, l.name || p.name, l.category, p.description, p.images[0] ?? null, p.externalId, MFT_BASE + l.slug + "/",
          slugTaken ? `${l.slug}-${p.externalId}` : l.slug], c);
      created = true;
    } else {
      // Nome, categoria e preço podem ter sido ajustados no CONTROL: o robô só atualiza descrição, fotos e disponibilidade
      await c.query(
        `update draum.products set description = coalesce($2, description), image_url = coalesce($3, image_url), external_url = $4,
           status = case when status = 'pausado' and $5 > 0 then 'ativo' else status end, synced_at = now(), updated_at = now()
         where id = $1`, [prod.id, p.description, p.images[0] ?? null, MFT_BASE + l.slug + "/", totalStock]);
    }

    // Fornecedor: disponibilidade verificada agora (o custo é mantido; vem da tela de custos)
    await c.query(
      `insert into draum.product_suppliers(product_id, supplier_id, unit_cost, lead_days, availability_checked_at, is_primary)
       values ($1,$2,0,$3,now(),true)
       on conflict (product_id, supplier_id) do update set lead_days = excluded.lead_days, availability_checked_at = now(), is_primary = true`,
      [prod.id, supplierId, st.mft_lead_days]);

    // Variantes (cor × tamanho), com o estoque da MFT
    const existing = await q<any>(`select id, color, color_code, size, external_sku from draum.product_variants where product_id = $1`, [prod.id], c);
    const codeByColor = new Map<string, string>();
    existing.forEach((v) => codeByColor.set(v.color, v.color_code));
    const usedCodes = new Set(existing.map((v) => v.color_code));
    const seenSkus: string[] = [];
    for (const col of p.colors) {
      let cc = codeByColor.get(col.name);
      if (!cc) {
        const base = suggestColorCode(col.name).slice(0, 3);
        cc = base; let n = 1;
        while (usedCodes.has(cc)) cc = base + String(n++);
        usedCodes.add(cc); codeByColor.set(col.name, cc);
      }
      for (const sz of col.sizes) {
        seenSkus.push(sz.sku);
        const match = existing.find((v) => v.external_sku === sz.sku) ?? existing.find((v) => v.color === col.name && v.size === sz.size);
        if (match) {
          await c.query(`update draum.product_variants set color = $2, color_hex = $3, external_sku = $4, supplier_stock = $5, active = true where id = $1`,
            [match.id, col.name, col.hex, sz.sku, sz.stock]);
        } else {
          const v = await q1<{ id: number }>(
            `insert into draum.product_variants(product_id, sku, color, color_code, size, color_hex, external_sku, supplier_stock)
             values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
            [prod.id, buildSku(prod.code, cc, sz.size), col.name, cc, sz.size, col.hex, sz.sku, sz.stock], c);
          await c.query(`insert into draum.inventory(variant_id) values ($1) on conflict do nothing`, [v!.id]);
        }
      }
    }
    // Variante que sumiu da MFT: sem estoque na fábrica (não desativa, para não travar pedidos em aberto)
    await c.query(`update draum.product_variants set supplier_stock = 0 where product_id = $1 and external_sku is not null and not (external_sku = any($2))`,
      [prod.id, seenSkus]);

    // Fotos da distribuidora (substitui as externas; mantém as enviadas pelo CONTROL)
    await c.query(`delete from draum.product_images where product_id = $1 and url is not null`, [prod.id]);
    let pos = 100;
    for (const col of p.colors) for (const url of col.images)
      await c.query(`insert into draum.product_images(product_id, color, url, position) values ($1,$2,$3,$4)`, [prod.id, col.name, url, pos++]);
    const loose = p.images.filter((u) => !p.colors.some((col) => col.images.includes(u)));
    for (const url of loose) await c.query(`insert into draum.product_images(product_id, url, position) values ($1,$2,$3)`, [prod.id, url, pos++]);

    return created ? "created" : "updated";
  });
}

// ───────── Custos (informados pelo revendedor) ─────────
export async function listMftCosts() {
  return q<any>(
    `select p.id, p.name, p.code, p.category, p.status, p.sale_price, p.external_url, p.image_url,
            ps.id as ps_id, ps.unit_cost, ps.inbound_freight,
            (select coalesce(sum(v.supplier_stock),0) from draum.product_variants v where v.product_id = p.id) as supplier_stock
       from draum.products p join draum.product_suppliers ps on ps.product_id = p.id and ps.is_primary
      where p.source = 'mft' order by (ps.unit_cost = 0) desc, p.category, p.name`);
}

/** Grava custos em lote e recalcula o preço de venda pela margem configurada */
export async function saveMftCosts(ctx: Ctx, costs: { productId: number; cost: number }[]) {
  requireAdmin(ctx);
  const s = await getSettings();
  return tx(async (c) => {
    let n = 0;
    for (const { productId, cost } of costs) {
      if (!(cost >= 0) || !Number.isFinite(cost)) continue;
      const r = await c.query(
        `update draum.product_suppliers ps set unit_cost = $2 from draum.products p
          where ps.product_id = p.id and p.id = $1 and p.source = 'mft' and ps.is_primary and ps.unit_cost is distinct from $2`, [productId, cost]);
      if (r.rowCount) n++;
    }
    await repriceMft(c, s.store);
    await audit(c, ctx, "supplier", s.store.mft_supplier_id, "custos_mft", { alterados: n });
    return { changed: n, example: priceFromCost(100, s.store) };
  });
}

export async function lastSyncRuns(limit = 5) {
  return q<any>(`select * from draum.supplier_sync_runs order by started_at desc limit $1`, [limit]);
}

// ───────── Favorito de leitura pelo navegador ─────────
import { randomBytes, timingSafeEqual } from "crypto";

/** Chave do favorito (gerada uma vez e guardada nas configurações da loja) */
export async function getImportToken(): Promise<string> {
  const s = await getSettings();
  const cur = (s.store as any).import_token as string | undefined;
  if (cur && cur.length >= 32) return cur;
  const token = randomBytes(24).toString("base64url");
  await q(`update draum.settings set value = value || jsonb_build_object('import_token', $1::text) where key = 'store'`, [token]);
  return token;
}

export async function checkImportToken(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 32) return false;
  const s = await getSettings();
  const cur = (s.store as any).import_token as string | undefined;
  if (!cur) return false;
  const a = Buffer.from(token), b = Buffer.from(cur);
  return a.length === b.length && timingSafeEqual(a, b);
}
