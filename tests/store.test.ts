import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { q, q1, closePool } from "@/lib/db";
import { users, fixture, setSetting } from "./helpers";
import { priceFromCost, listStoreProducts, getStoreProduct, placeStoreOrder, cartLines, storeDeliveryDate } from "@/server/store";
import { parseProduct, parseListing, saveMftCosts, importMftFromBrowser, getImportToken, checkImportToken } from "@/server/mft";
import { getSettings, Ctx, BusinessError } from "@/server/core";
import { createProduct } from "@/server/products";
import { adjustStock } from "@/server/inventory";

let admin: Ctx;
beforeAll(async () => {
  ({ admin } = await users());
  const s = await getSettings();
  await setSetting("store", { ...s.store, whatsapp: "5591985295411" });
});
afterAll(async () => { await closePool(); });

// Trecho real (simplificado) da página de produto da MFT
const MFT_HTML = `<html><head><meta itemprop="name" content="Conjunto Motion"></head><body>
<script>var produto_id = '5842544';</script>
<h1>Conjunto Motion</h1>
<div class="fotos"><div class="big">
 <div class="item" data-cor="547124"><a href="https://cdn.x/motion-azul-1.jpeg" class="fancybox" data-fancybox-group="d-5842544-547124"><img src="https://cdn.x/motion-azul-1.jpeg"></a></div>
 <div class="item" data-cor="547124"><a href="https://cdn.x/motion-azul-2.jpeg" class="fancybox" data-fancybox-group="d-5842544-547124"><img></a></div>
 <div class="item" data-cor="547142"><a href="https://cdn.x/motion-vinho-1.jpeg" class="fancybox" data-fancybox-group="d-5842544-547142"><img></a></div>
</div></div>
<div class="l"><p class="variacao_cor_nome">Azul</p><div class="cor mt"><div class="item pop" data-cor="547124"><div class="cor_primaria" data-cor="547124" data-cornome="Azul" data-sku="5842544.214275.547124.323164" style="background-color:#abd3de"></div></div></div>
 <div class="vars"><div class="it" title="M"><div class="t"><p>M</p></div><input type="number" class="form-control" min="1" max="28" data-sku="5842544.214275.547124.323164" disabled=""></div>
 <div class="it" title="g"><div class="t"><p>g</p></div><input type="number" class="form-control" min="1" max="33" data-sku="5842544.214275.547124.323165" disabled=""></div></div></div>
<div class="l"><p class="variacao_cor_nome">Vinho</p><div class="cor mt"><div class="item pop" data-cor="547142"><div class="cor_primaria" data-cor="547142" data-cornome="Vinho" style="background-color:#8e1060"></div></div></div>
 <div class="vars"><div class="it" title="M"><div class="t"><p>M</p></div><input type="number" class="form-control" min="1" max="2" data-sku="5842544.214275.547142.323164" disabled=""></div></div></div>
<section class="info_wrapper"><h3>Sobre o produto</h3><p>Conjunto de inspiração esportiva.</p><p>Tabela de Medidas:<br>M &rarr; Veste do 36 ao 38</p></section>
</body></html>`;

describe("Robô da MFT — leitura das páginas", () => {
  it("lê cores, tamanhos com estoque, fotos por cor e descrição", () => {
    const p = parseProduct(MFT_HTML);
    expect(p.externalId).toBe("5842544");
    expect(p.name).toBe("Conjunto Motion");
    expect(p.colors.map((c) => c.name)).toEqual(["Azul", "Vinho"]);
    expect(p.colors[0]).toMatchObject({ id: "547124", hex: "#abd3de" });
    expect(p.colors[0].sizes).toEqual([
      { size: "M", stock: 28, sku: "5842544.214275.547124.323164" },
      { size: "G", stock: 33, sku: "5842544.214275.547124.323165" },
    ]);
    expect(p.colors[1].images).toEqual(["https://cdn.x/motion-vinho-1.jpeg"]);
    expect(p.images).toHaveLength(3);
    expect(p.description).toContain("M → Veste do 36 ao 38");
    expect(p.description).not.toMatch(/^Sobre o produto/);
  });

  it("lê a vitrine de categoria ignorando links de login", () => {
    const html = `<div class="item" data-id="1" data-sku="1.2.3.4"><a href="top-little/" class="foto_wrapper"></a><h3 class="produto" title="Top Little">Top Little</h3><a href="login/?redirect=top-little/">Login</a></div>`;
    expect(parseListing(html)).toEqual([{ slug: "top-little", name: "Top Little" }]);
  });
});

describe("Preço da loja", () => {
  it("margem de 50% sobre o preço (custo × 2) com final ,90", () => {
    expect(priceFromCost(85, { margin_pct: 50, price_ending: 0.9 })).toBe(169.9);   // 170,00 → 169,90
    expect(priceFromCost(40, { margin_pct: 50, price_ending: 0.9 })).toBe(79.9);
    expect(priceFromCost(42.5, { margin_pct: 50, price_ending: 0 })).toBe(85);
    expect(priceFromCost(61.75, { margin_pct: 50, price_ending: 0.9 })).toBe(123.9); // 123,50 → 123,90
    // nunca mais que 10 centavos abaixo da margem exata
    for (const c of [9.9, 32, 57, 85.45, 112, 125]) expect(priceFromCost(c, { margin_pct: 50, price_ending: 0.9 })).toBeGreaterThanOrEqual(c * 2 - 0.1 - 1e-9);
  });

  it("corte sexta 12h → entrega na terça seguinte", async () => {
    const s = await getSettings();
    expect(s.delivery_cutoff).toEqual({ weekday: 5, hour: 12 });
    expect(storeDeliveryDate(new Date("2026-11-27T11:59:00-03:00"), s)).toBe("2026-12-01"); // sexta 11h59
    expect(storeDeliveryDate(new Date("2026-11-27T12:01:00-03:00"), s)).toBe("2026-12-08"); // sexta 12h01
    expect(storeDeliveryDate(new Date("2026-11-23T10:00:00-03:00"), s)).toBe("2026-12-01"); // segunda
  });
});

async function mftProduct(cost: number | null, stock = 5) {
  const sup = await q1<{ id: number }>(`select id from draum.suppliers where name = 'MFT (revenda)'`);
  const ext = String(Math.floor(Math.random() * 1e9));
  const p = await createProduct(admin, { name: `Conjunto MFT ${ext}`, category: "conjuntos", sale_price: 0, modality: "pre", status: "ativo" },
    [{ color: "Azul", size: "M" }, { color: "Azul", size: "G" }], `MFT-${ext}`);
  await q(`update draum.products set source='mft', external_id=$2 where id=$1`, [p.id, ext]);
  await q(`update draum.product_variants set supplier_stock = $2 where product_id = $1`, [p.id, stock]);
  await q(`insert into draum.product_suppliers(product_id, supplier_id, unit_cost, lead_days, availability_checked_at, is_primary) values ($1,$2,0,2,now(),true)`, [p.id, sup!.id]);
  if (cost != null) await saveMftCosts(admin, [{ productId: p.id, cost }]);
  const variants = await q<{ id: number; size: string }>(`select id, size from draum.product_variants where product_id=$1 order by size desc`, [p.id]);
  return { id: p.id, variants };
}

describe("Loja online", () => {
  it("peça da MFT sem custo fica fora da loja; com custo entra com preço = custo × 2", async () => {
    const semCusto = await mftProduct(null);
    const comCusto = await mftProduct(85);
    const list = await listStoreProducts();
    expect(list.find((p) => p.id === semCusto.id)).toBeUndefined();
    const card = list.find((p) => p.id === comCusto.id)!;
    expect(card).toMatchObject({ price: 169.9, hasPre: true, hasPronta: false });
  });

  it("variante sem estoque na MFT não aparece para venda", async () => {
    const m = await mftProduct(60, 0);
    expect((await listStoreProducts()).find((p) => p.id === m.id)).toBeUndefined();
  });

  it("pedido misto: pronta-entrega reserva estoque e a encomenda vira pré-venda com o fornecedor MFT", async () => {
    const f = await fixture(admin, { stock: 1, price: 189.9 });
    await q(`update draum.products set modality = 'pronta' where id = $1`, [f.productId]); // peça única, só pronta-entrega
    const m = await mftProduct(85);
    const own = await getStoreProduct((await q1<any>(`select slug from draum.products where id=$1`, [f.productId])).slug);
    expect(own!.variants.find((v) => v.id === f.variantM)!.mode).toBe("pronta");

    const r = await placeStoreOrder({
      items: [{ variantId: f.variantM, qty: 1 }, { variantId: m.variants[0].id, qty: 2 }],
      name: "Cliente da Loja", whatsapp: "(91) 98111-2233", fulfillment: "entrega_local", neighborhood: "Umarizal", address: "Rua A, 10",
      acceptPre: true, idempotencyKey: `loja-${Date.now()}`,
    });
    expect(r.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5591985295411\?text=/);
    expect(decodeURIComponent(r.whatsappUrl)).toContain(r.number);
    const order = await q1<any>(`select * from draum.orders where number=$1`, [r.number]);
    expect(order).toMatchObject({ channel: "loja", status: "aguardando_pagamento", fulfillment: "entrega_local" });
    expect(Number(order.total)).toBe(round(189.9 + 2 * 169.9));
    const items = await q<any>(`select * from draum.order_items where order_id=$1 order by id`, [order.id]);
    expect(items[0]).toMatchObject({ mode: "pronta", status: "reservado" });
    expect(items[1]).toMatchObject({ mode: "pre", qty: 2 });
    expect(items[1].supplier_id).not.toBeNull();
    expect(items[1].customer_promised_date).toBe(storeDeliveryDate(new Date(), await getSettings()));
    const inv = await q1<any>(`select qty_reserved from draum.inventory where variant_id=$1`, [f.variantM]);
    expect(inv.qty_reserved).toBe(1);
    const cust = await q1<any>(`select * from draum.customers where id=$1`, [order.customer_id]);
    expect(cust).toMatchObject({ whatsapp: "5591981112233", lead_source: "site", consent_whatsapp: true });

    // A peça única acabou: some da loja e um segundo pedido é recusado
    const again = await cartLines([{ variantId: f.variantM, qty: 1 }]);
    expect(again.lines[0].mode).toBeNull();
    await expect(placeStoreOrder({
      items: [{ variantId: f.variantM, qty: 1 }], name: "Outra Cliente", whatsapp: "91981112244", fulfillment: "retirada", idempotencyKey: `loja-b-${Date.now()}`,
    })).rejects.toThrow(BusinessError);
  });

  it("exige aceite do prazo da encomenda e endereço para entrega", async () => {
    const m = await mftProduct(50);
    const base = { items: [{ variantId: m.variants[0].id, qty: 1 }], name: "Cliente Teste", whatsapp: "91981110000", idempotencyKey: `loja-c-${Date.now()}` };
    await expect(placeStoreOrder({ ...base, fulfillment: "retirada" })).rejects.toThrow(/encomenda/);
    await expect(placeStoreOrder({ ...base, fulfillment: "entrega_local", acceptPre: true })).rejects.toThrow(/endereço/);
  });

  it("mesma chave de pedido não duplica", async () => {
    const m = await mftProduct(50);
    const input = { items: [{ variantId: m.variants[0].id, qty: 1 }], name: "Cliente Teste", whatsapp: "91981110001", fulfillment: "retirada", acceptPre: true, idempotencyKey: `loja-d-${Date.now()}` };
    const a = await placeStoreOrder(input);
    const b = await placeStoreOrder(input);
    expect(b.number).toBe(a.number);
  });
});

describe("Leitura da MFT pelo navegador", () => {
  const item = (id: number, cost: number | null, stock = 10) => ({
    slug: `peca-${id}`, name: `Peça ${id}`, category: "conjunto-short", cost, externalId: String(900000 + id), description: "Descrição",
    images: [`https://cdn.x/${id}-a.jpg`],
    colors: [{ id: "1", name: "Azul", hex: "#abd3de", images: [`https://cdn.x/${id}-a.jpg`], sizes: [{ size: "M", stock, sku: `${id}.1.M` }, { size: "g - R$85,00", stock: 0, sku: `${id}.1.G` }] }],
  });
  it("cria as peças com custo e preço, e pausa o que saiu do catálogo", async () => {
    const r1 = await importMftFromBrowser({ items: Array.from({ length: 12 }, (_, i) => item(i, 50)), total: 12, errors: [] });
    expect(r1).toMatchObject({ seen: 12, created: 12, costs: 12 });
    const p = await q1<any>(`select p.*, ps.unit_cost from draum.products p join draum.product_suppliers ps on ps.product_id=p.id and ps.is_primary where p.external_id='900000'`);
    expect(p).toMatchObject({ source: "mft", category: "conjuntos", modality: "pre", status: "ativo", slug: "peca-0" });
    expect(Number(p.unit_cost)).toBe(50);
    expect(Number(p.sale_price)).toBe(99.9);
    const vs = await q<any>(`select size, supplier_stock from draum.product_variants where product_id=$1 order by size`, [p.id]);
    expect(vs).toEqual([{ size: "G", supplier_stock: 0 }, { size: "M", supplier_stock: 10 }]);
    // segunda leitura sem a peça 11: ela é pausada; custo novo é aplicado
    const r2 = await importMftFromBrowser({ items: Array.from({ length: 11 }, (_, i) => item(i, i === 0 ? 60 : 50)), total: 11, errors: [] });
    expect(r2.paused).toBeGreaterThanOrEqual(1);
    expect((await q1<any>(`select status from draum.products where external_id='900011'`)).status).toBe("pausado");
    expect(Number((await q1<any>(`select sale_price from draum.products where external_id='900000'`)).sale_price)).toBe(119.9);
  });
  it("ignora dados malformados e exige chave válida", async () => {
    await expect(importMftFromBrowser({ items: [{ slug: "x", externalId: "abc", colors: [] }] })).rejects.toThrow(/apenas 0/);
    const t = await getImportToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(await checkImportToken(t)).toBe(true);
    expect(await checkImportToken("x".repeat(40))).toBe(false);
    expect(await getImportToken()).toBe(t);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
void adjustStock;
