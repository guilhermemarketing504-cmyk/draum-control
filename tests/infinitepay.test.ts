import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { q, q1, closePool } from "@/lib/db";
import { users, fixture } from "./helpers";
import { createPaymentLink, confirmPayment, normalizeHandle } from "@/server/infinitepay";
import { placeStoreOrder } from "@/server/store";
import { getSettings, Ctx } from "@/server/core";

let admin: Ctx;
beforeAll(async () => {
  ({ admin } = await users());
  const s = await getSettings();
  await q(`update draum.settings set value=$1 where key='store'`, [JSON.stringify({ ...s.store, whatsapp: "5591985295411", infinitepay_handle: "atacado-In7" })]);
});
afterAll(async () => { vi.unstubAllGlobals(); await closePool(); });

async function storeOrder() {
  const f = await fixture(admin, { stock: 2, price: 150 });
  await q(`update draum.products set modality='pronta' where id=$1`, [f.productId]);
  return placeStoreOrder({ items: [{ variantId: f.variantM, qty: 2 }], name: "Cliente Cartão", whatsapp: `9198${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    email: "c@x.com", fulfillment: "retirada", idempotencyKey: `ip-${Date.now()}-${Math.random()}` });
}

describe("InfinitePay", () => {
  it("tira o $ da InfiniteTag", () => { expect(normalizeHandle(" $atacado-In7 ")).toBe("atacado-In7"); });

  it("cria o link com o total do pedido em centavos e os dados da cliente", async () => {
    const o = await storeOrder();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: "https://checkout.infinitepay.io/atacado-In7/abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const url = await createPaymentLink(o.number, "https://loja.test");
    expect(url).toBe("https://checkout.infinitepay.io/atacado-In7/abc");
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ handle: "atacado-In7", order_nsu: o.number, webhook_url: "https://loja.test/api/infinitepay/webhook" });
    expect(body.items.reduce((a: number, i: any) => a + i.price * i.quantity, 0)).toBe(30000);
    expect(body.customer.phone_number).toMatch(/^\+5591/);
  });

  it("só registra o pagamento conferido na InfinitePay, uma única vez, e marca o pedido como pago", async () => {
    const o = await storeOrder();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, paid: false }), { status: 200 })));
    expect((await confirmPayment({ orderNsu: o.number, transactionNsu: "tx-falso", slug: "s1" })).paid).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, paid: true, amount: 30000, paid_amount: 30000, installments: 3, capture_method: "credit_card" }), { status: 200 })));
    const tx = `tx-${Date.now()}`;
    expect((await confirmPayment({ orderNsu: o.number, transactionNsu: tx, slug: "s1" })).paid).toBe(true);
    expect((await confirmPayment({ orderNsu: o.number, transactionNsu: tx, slug: "s1" })).already).toBe(true);
    const order = await q1<any>(`select * from draum.orders where number=$1`, [o.number]);
    expect(order).toMatchObject({ financial_status: "pago", status: "pago" });
    const pays = await q<any>(`select * from draum.payments where order_id=$1`, [order.id]);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ status: "conciliado", method: "cartao_credito", external_ref: tx });
  });
});
