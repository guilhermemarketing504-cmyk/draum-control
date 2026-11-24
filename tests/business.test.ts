import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { q, q1, closePool } from "@/lib/db";
import { users, fixture, inv, paidOrder, promise, setSetting, addAporte } from "./helpers";
import { createOrder, informPayment, reconcilePayment, cancelOrder, payRefund, markItemsReady, handOver, registerReturn } from "@/server/orders";
import { purchaseNeeds, createPurchaseOrder, sendPurchaseOrder, payPurchaseOrder, receivePurchaseOrder, listPresales } from "@/server/presales";
import { cashPosition, createEntry } from "@/server/finance";
import { adjustStock } from "@/server/inventory";
import { savePromotion } from "@/server/marketing";
import { saveZone, createRoute, addStops, startRoute, completeStop, closeRoute, routeCandidates, firstEligibleTuesday, cutoffFor, nextTuesdays } from "@/server/delivery";
import { getSettings, todayISO, BusinessError, Ctx } from "@/server/core";
import { saveSettings } from "@/server/users";
import { simulatePrice } from "@/server/pricing";

let admin: Ctx, op: Ctx;
beforeAll(async () => { ({ admin, op } = await users()); });
afterAll(async () => { await closePool(); });

const pronta = (variantId: number, qty = 1) => ({ variantId, qty, mode: "pronta" as const });

describe("1. Venda de produto com estoque", () => {
  it("reserva automaticamente as unidades do pedido de pronta-entrega", async () => {
    const f = await fixture(admin, { stock: 3 });
    const o = await createOrder(op, { customerId: f.customerId, items: [pronta(f.variantM, 2)], fulfillment: "retirada", paymentMethod: "pix" });
    const i = await inv(f.variantM);
    expect(i).toMatchObject({ qty_physical: 3, qty_reserved: 2 });
    const order = await q1<any>(`select * from draum.orders where id=$1`, [o.id]);
    expect(order.status).toBe("aguardando_pagamento");
    expect(Number(order.total)).toBe(400);
    const moves = await q<any>(`select * from draum.stock_movements where variant_id=$1 and type='reserva'`, [f.variantM]);
    expect(moves).toHaveLength(1);
  });

  it("não cria pedido duplicado com a mesma chave de idempotência", async () => {
    const f = await fixture(admin, { stock: 2 });
    const input = { customerId: f.customerId, items: [pronta(f.variantM)], fulfillment: "retirada", idempotencyKey: "form-abc-12345" };
    const a = await createOrder(op, input);
    const b = await createOrder(op, input);
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
    expect((await inv(f.variantM))!.qty_reserved).toBe(1);
  });
});

describe("2. Tentativa de venda sem estoque", () => {
  it("bloqueia e não grava nada (transação desfeita)", async () => {
    const f = await fixture(admin, { stock: 1 });
    const before = (await q1<any>(`select count(*) n from draum.orders`))!.n;
    await expect(createOrder(op, { customerId: f.customerId, items: [pronta(f.variantM, 2)], fulfillment: "retirada" }))
      .rejects.toThrow(/Estoque insuficiente/);
    expect((await q1<any>(`select count(*) n from draum.orders`))!.n).toBe(before);
    expect((await inv(f.variantM))!.qty_reserved).toBe(0);
  });
});

describe("3. Reserva simultânea da última unidade", () => {
  it("apenas uma de várias vendas concorrentes consegue a última peça", async () => {
    const f = await fixture(admin, { stock: 1 });
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () =>
      createOrder(op, { customerId: f.customerId, items: [pronta(f.variantM)], fulfillment: "retirada" })));
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(4);
    expect(await inv(f.variantM)).toMatchObject({ qty_physical: 1, qty_reserved: 1 });
  });
});

describe("4. Pedido com itens mistos", () => {
  it("reserva a pronta-entrega, gera necessidade de compra para a pré-venda e acompanha cada item", async () => {
    const f = await fixture(admin, { stock: 2, leadDays: 5 });
    const o = await paidOrder(admin, {
      customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix",
      items: [pronta(f.variantM), { variantId: f.variantG, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(10), termsAccepted: true }],
    });
    const items = await q<any>(`select mode, status from draum.order_items where order_id=$1 order by id`, [o.id]);
    expect(items).toEqual([{ mode: "pronta", status: "reservado" }, { mode: "pre", status: "aguardando_compra" }]);
    expect((await inv(f.variantG))!.qty_physical).toBe(0); // pré-venda não cria estoque fictício
    const needs = await purchaseNeeds();
    expect(needs.find((n) => n.supplier_id === f.supplierId)?.items).toHaveLength(1);
    // entrega parcial: a peça de pronta-entrega pode sair antes
    await markItemsReady(admin, o.id, [(await q1<any>(`select id from draum.order_items where order_id=$1 and mode='pronta'`, [o.id])).id]);
    const readyId = (await q1<any>(`select id from draum.order_items where order_id=$1 and mode='pronta'`, [o.id])).id;
    await handOver(admin, o.id, [readyId], "retirada");
    const order = await q1<any>(`select status from draum.orders where id=$1`, [o.id]);
    expect(order.status).toBe("entregue_parcial");
    expect(await inv(f.variantM)).toMatchObject({ qty_physical: 1, qty_reserved: 0 });
  });
});

describe("5. Pré-venda paga", () => {
  it("exige disponibilidade verificada e prazo do fornecedor antes de confirmar", async () => {
    const f = await fixture(admin, { checked: false, leadDays: 10 });
    const item = { variantId: f.variantM, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(30), termsAccepted: true };
    await expect(createOrder(op, { customerId: f.customerId, fulfillment: "retirada", items: [item] })).rejects.toThrow(/ainda não foi verificada/);
    await q(`update draum.product_suppliers set availability_checked_at=now() where product_id=$1`, [f.productId]);
    await expect(createOrder(op, { customerId: f.customerId, fulfillment: "retirada", items: [{ ...item, customerPromisedDate: promise(5) }] }))
      .rejects.toThrow(/anterior ao mínimo seguro/);
    await expect(createOrder(op, { customerId: f.customerId, fulfillment: "retirada", items: [{ ...item, termsAccepted: false }] }))
      .rejects.toThrow(/aceitar as condições/);
    const o = await createOrder(op, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix", items: [item] });
    const it = await q1<any>(`select * from draum.order_items where order_id=$1`, [o.id]);
    expect(it.terms_accepted).toMatch(/Prazo do fornecedor: 10 dia/);
    expect(it.terms_accepted_at).not.toBeNull();
  });

  it("pagamento informado não vira caixa; conciliado compromete o custo da peça", async () => {
    const f = await fixture(admin, { cost: 80, leadDays: 5 });
    const before = await cashPosition();
    const o = await createOrder(op, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix",
      items: [{ variantId: f.variantM, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(12), termsAccepted: true }] });
    const p = await informPayment(op, o.id, { amount: 200, method: "pix", externalRef: `tx-${o.id}` });
    const mid = await cashPosition();
    expect(mid.balance).toBe(before.balance);                // informado ≠ recebido
    expect(mid.informedPayments).toBe(round(before.informedPayments + 200));
    await expect(reconcilePayment(op, p.id)).rejects.toThrow(/administradores/); // operador não concilia
    await reconcilePayment(admin, p.id);
    const after = await cashPosition();
    expect(after.balance).toBe(round(before.balance + 200));
    expect(after.committed).toBe(round(before.committed + 80)); // custo reservado para o fornecedor
    const pres = (await listPresales({ status: "abertas" })).find((x) => x.order_id === o.id)!;
    expect(pres.status).toBe("aguardando_compra");
    expect(Number(pres.reserved_for_purchase)).toBe(80);
    expect(Number(pres.value_received)).toBe(200);
  });
});

describe("6. Compra ao fornecedor", () => {
  it("liquida o valor reservado pelo próprio pedido e bloqueia uso de recursos de outros pedidos", async () => {
    const f = await fixture(admin, { cost: 70, leadDays: 4 });
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix",
      items: [{ variantId: f.variantM, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(10), termsAccepted: true }] });
    const itemId = (await q1<any>(`select id from draum.order_items where order_id=$1`, [o.id])).id;
    const cash0 = await cashPosition();
    // Compra incluindo reposição de estoque muito acima do caixa livre: deve ser bloqueada
    const big = await createPurchaseOrder(admin, { supplierId: f.supplierId, orderItemIds: [itemId], stockItems: [{ variantId: f.variantG, qty: 1, unitCost: Math.max(cash0.free, 0) + 1000 }] });
    await sendPurchaseOrder(admin, big.id);
    await expect(payPurchaseOrder(admin, big.id)).rejects.toThrow(/caixa livre/);
    const { cancelPurchaseOrder } = await import("@/server/presales");
    await cancelPurchaseOrder(admin, big.id, "teste");
    // Compra só da pré-venda: coberta pelo valor reservado
    const po = await createPurchaseOrder(admin, { supplierId: f.supplierId, orderItemIds: [itemId] });
    await sendPurchaseOrder(admin, po.id);
    expect((await q1<any>(`select status from draum.order_items where id=$1`, [itemId])).status).toBe("comprado");
    expect((await inv(f.variantM))!.qty_in_transit).toBe(1);
    const r = await payPurchaseOrder(admin, po.id);
    expect(r).toMatchObject({ outflow: 70, covered: 70, uncovered: 0 });
    const cash1 = await cashPosition();
    expect(cash1.balance).toBe(round(cash0.balance - 70));
    expect(cash1.committed).toBe(round(cash0.committed - 70));
    expect(cash1.free).toBeCloseTo(cash0.free, 2); // caixa livre não muda: o dinheiro já era do fornecedor
  });
});

describe("7. Recebimento parcial", () => {
  it("dá entrada e reserva só o que chegou, mantendo o vínculo com o pedido", async () => {
    const f = await fixture(admin, { cost: 50, leadDays: 3 });
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix",
      items: [{ variantId: f.variantM, qty: 2, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(9), termsAccepted: true }] });
    const itemId = (await q1<any>(`select id from draum.order_items where order_id=$1`, [o.id])).id;
    const po = await createPurchaseOrder(admin, { supplierId: f.supplierId, orderItemIds: [itemId] });
    await sendPurchaseOrder(admin, po.id);
    const poi = await q1<any>(`select id from draum.purchase_order_items where purchase_order_id=$1`, [po.id]);
    await receivePurchaseOrder(admin, po.id, [{ poItemId: poi.id, qty: 1 }]);
    expect(await inv(f.variantM)).toMatchObject({ qty_physical: 1, qty_reserved: 1, qty_in_transit: 1 });
    expect((await q1<any>(`select status from draum.order_items where id=$1`, [itemId])).status).toBe("comprado");
    expect((await q1<any>(`select status from draum.purchase_orders where id=$1`, [po.id])).status).toBe("recebido_parcial");
    await expect(receivePurchaseOrder(admin, po.id, [{ poItemId: poi.id, qty: 2 }])).rejects.toThrow(/excede/);
    await receivePurchaseOrder(admin, po.id, [{ poItemId: poi.id, qty: 1 }]);
    expect(await inv(f.variantM)).toMatchObject({ qty_physical: 2, qty_reserved: 2, qty_in_transit: 0 });
    expect((await q1<any>(`select status from draum.order_items where id=$1`, [itemId])).status).toBe("recebido");
    expect((await q1<any>(`select status from draum.purchase_orders where id=$1`, [po.id])).status).toBe("recebido");
  });
});

describe("8. Cancelamento e reembolso", () => {
  it("libera a reserva, cria reembolso comprometido e baixa o caixa ao pagar", async () => {
    const f = await fixture(admin, { stock: 1 });
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix", items: [pronta(f.variantM)] });
    await expect(cancelOrder(op, o.id, "desistência")).rejects.toThrow(/administrador/);
    const c0 = await cashPosition();
    const { refundId } = await cancelOrder(admin, o.id, "desistência da cliente");
    expect(await inv(f.variantM)).toMatchObject({ qty_physical: 1, qty_reserved: 0 });
    const c1 = await cashPosition();
    expect(c1.committed).toBe(round(c0.committed + 200));
    await payRefund(admin, refundId!);
    const c2 = await cashPosition();
    expect(c2.balance).toBe(round(c0.balance - 200));
    expect(c2.committed).toBe(c0.committed);
    expect((await q1<any>(`select status, financial_status from draum.orders where id=$1`, [o.id]))).toEqual({ status: "cancelado", financial_status: "reembolsado" });
  });

  it("cancelamento de pré-venda já comprada transforma a peça em reposição de estoque", async () => {
    const f = await fixture(admin, { cost: 40, leadDays: 3 });
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix",
      items: [{ variantId: f.variantM, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(8), termsAccepted: true }] });
    const itemId = (await q1<any>(`select id from draum.order_items where order_id=$1`, [o.id])).id;
    const po = await createPurchaseOrder(admin, { supplierId: f.supplierId, orderItemIds: [itemId] });
    await sendPurchaseOrder(admin, po.id);
    await cancelOrder(admin, o.id, "cliente desistiu");
    const ob = await q1<any>(`select * from draum.obligations where purchase_order_id=$1 and status='aberta'`, [po.id]);
    expect(ob.kind).toBe("conta_pagar"); // dívida com o fornecedor continua
    await payPurchaseOrder(admin, po.id);
    const poi = await q1<any>(`select id, order_item_id from draum.purchase_order_items where purchase_order_id=$1`, [po.id]);
    expect(poi.order_item_id).toBeNull();
    await receivePurchaseOrder(admin, po.id, [{ poItemId: poi.id, qty: 1 }]);
    expect(await inv(f.variantM)).toMatchObject({ qty_physical: 1, qty_reserved: 0 }); // estoque livre
  });
});

describe("9. Troca ou devolução", () => {
  it("devolução repõe estoque e gera reembolso; troca reserva a nova variante", async () => {
    const f = await fixture(admin, { stock: 3 });
    await adjustStock(admin, { variantId: f.variantG, newPhysical: 1, unitCost: 60, reason: "inventário" });
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix", items: [pronta(f.variantM, 2)] });
    const it = await q1<any>(`select id from draum.order_items where order_id=$1`, [o.id]);
    await expect(registerReturn(admin, { orderItemId: it.id, kind: "devolucao", qty: 1, reason: "x", restock: true })).rejects.toThrow(/entregues/);
    await markItemsReady(admin, o.id, [it.id]);
    await handOver(admin, o.id, [it.id], "retirada");
    expect((await inv(f.variantM))!.qty_physical).toBe(1);
    // troca do item inteiro (2 peças M) — só há 1 G: deve falhar sem efeitos
    await expect(registerReturn(admin, { orderItemId: it.id, kind: "troca", qty: 2, reason: "tamanho", restock: true, newVariantId: f.variantG })).rejects.toThrow(/Estoque insuficiente/);
    expect((await inv(f.variantM))!.qty_physical).toBe(1);
    // devolução de 1 peça com reembolso proporcional
    const r = await registerReturn(admin, { orderItemId: it.id, kind: "devolucao", qty: 1, reason: "não serviu", restock: true });
    expect((await inv(f.variantM))!.qty_physical).toBe(2);
    expect(Number((await q1<any>(`select amount from draum.refunds where id=$1`, [r.refundId]))!.amount)).toBe(200);

    // troca integral num novo pedido de 1 peça
    const o2 = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix", items: [pronta(f.variantM, 1)] });
    const it2 = await q1<any>(`select id from draum.order_items where order_id=$1`, [o2.id]);
    await markItemsReady(admin, o2.id, [it2.id]);
    await handOver(admin, o2.id, [it2.id], "retirada");
    const t = await registerReturn(admin, { orderItemId: it2.id, kind: "troca", qty: 1, reason: "trocar tamanho", restock: true, newVariantId: f.variantG });
    expect(await inv(f.variantG)).toMatchObject({ qty_physical: 1, qty_reserved: 1 });
    expect((await q1<any>(`select status from draum.order_items where id=$1`, [it2.id])).status).toBe("trocado");
    expect((await q1<any>(`select status from draum.order_items where id=$1`, [t.newItemId])).status).toBe("reservado");
    expect((await q1<any>(`select status from draum.orders where id=$1`, [o2.id])).status).toBe("em_andamento");
  });
});

describe("10. Desconto sem margem suficiente", () => {
  it("bloqueia promoção que derruba a margem abaixo de 30%, salvo aprovação do administrador", async () => {
    const f = await fixture(admin, { stock: 5, cost: 120, price: 200 }); // margem sem desconto 40%; com 20% → 25%
    const promo = await savePromotion(admin, null, {
      name: "Teste BF", kind: "black_friday", pct: 20, starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 86400e3).toISOString(),
      min_items: 1, all_products: false, requires_vip: false, active: true, product_ids: [f.productId],
    });
    const input = { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix", promotionId: promo.id, items: [pronta(f.variantM)] };
    await expect(createOrder(op, input)).rejects.toThrow(/reduz a margem para 24.95%/);
    await expect(createOrder(admin, input)).rejects.toThrow(/justificativa/);
    expect((await inv(f.variantM))!.qty_reserved).toBe(0);
    const ok = await createOrder(admin, { ...input, marginOverrideReason: "Peça de lançamento, aprovado pela direção" });
    const order = await q1<any>(`select discount_total, margin_override_by, margin_override_reason from draum.orders where id=$1`, [ok.id]);
    expect(Number(order.discount_total)).toBe(40.1);
    expect(order.margin_override_by).toBe(admin.userId);
    // descontos não cumulativos: duas peças (12%) não soma com a promoção escolhida
    expect(ok.margin.discount).toBe(40.1);
  });

  it("promoção VIP é recusada para cliente fora do grupo e fora da vigência", async () => {
    const f = await fixture(admin, { stock: 2, cost: 50 });
    await q(`update draum.customers set vip_joined_at = null where id=$1`, [f.customerId]);
    const vip = await q1<any>(`select id from draum.promotions where kind='vip'`);
    await expect(createOrder(op, { customerId: f.customerId, fulfillment: "retirada", promotionId: vip.id, items: [pronta(f.variantM)] })).rejects.toThrow(/exclusiva/);
    const bf = await q1<any>(`select id from draum.promotions where name='Black Friday DRAUM'`);
    await expect(createOrder(op, { customerId: f.customerId, fulfillment: "retirada", promotionId: bf.id, items: [pronta(f.variantM)] })).rejects.toThrow(/vigente/);
  });

  it("simulador calcula preço mínimo para a margem desejada", () => {
    const s = simulatePrice({ pieceCost: 60, inboundFreight: 5, packaging: 5, feePct: 3, taxPct: 6, deliveryCost: 10, discountPct: 20, targetMarginPct: 30, currentPrice: 200 });
    // fixos 80 / (1 − 0,39) = 131,15 líquido → 163,93 de tabela com 20% off
    expect(s.minNetPrice).toBeCloseTo(131.15, 2);
    expect(s.suggestedListPrice).toBeCloseTo(163.93, 2);
    expect(s.atCurrent!.marginPct).toBeGreaterThan(30);
  });
});

describe("11. Entrega de terça-feira", () => {
  it("roteiriza pedido pago até quinta 18h em bairro elegível, baixa estoque e rateia o custo real", async () => {
    const s0 = await getSettings();
    await setSetting("delivery_cost_estimate", 12);
    await saveZone(admin, { neighborhood: "Umarizal", eligible: true });
    const f = await fixture(admin, { stock: 2 });
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "entrega_local", address: "Rua Teste, 100", neighborhood: "Umarizal", paymentMethod: "pix", items: [pronta(f.variantM)] });
    const o2 = await paidOrder(admin, { customerId: f.customerId, fulfillment: "entrega_local", address: "Rua Teste, 200", neighborhood: "Marambaia", paymentMethod: "pix", items: [pronta(f.variantM)] });
    const s = await getSettings();
    const tuesday = firstEligibleTuesday(new Date(), s)!;
    expect(new Date().getTime()).toBeLessThanOrEqual(cutoffFor(tuesday, s).getTime());
    const cands = await routeCandidates(tuesday);
    const c1 = cands.find((c) => c.id === o.id)!, c2 = cands.find((c) => c.id === o2.id)!;
    expect(c1.eligible).toBe(true);
    expect(c2.eligible).toBe(false);
    expect(c2.reasons.join()).toMatch(/fora das regiões elegíveis/);
    // pedido pago depois do corte não entra nessa terça
    const late = await paidOrder(admin, { customerId: f.customerId, fulfillment: "entrega_local", address: "Rua X", neighborhood: "Umarizal", paymentMethod: "pix", items: [{ variantId: f.variantG, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(15), termsAccepted: true }] });
    expect((await routeCandidates(tuesday)).find((c) => c.id === late.id)!.reasons.join()).toMatch(/nenhum item disponível/);
    await q(`update draum.orders set paid_at = $2 where id=$1`, [o2.id, new Date(cutoffFor(tuesday, s).getTime() + 3600e3)]);
    await q(`update draum.orders set neighborhood='Umarizal' where id=$1`, [o2.id]);
    expect((await routeCandidates(tuesday)).find((c) => c.id === o2.id)!.reasons.join()).toMatch(/após o corte/);

    await expect(createRoute(admin, { routeDate: addDaysNotTuesday(tuesday) })).rejects.toThrow(/terças/);
    const route = await createRoute(admin, { routeDate: tuesday, driver: "Entregador teste", capacity: 10 });
    await addStops(admin, route.id, [o.id]);
    await expect(startRoute(admin, route.id)).rejects.toThrow(/embalagem pendente/);
    const itemId = (await q1<any>(`select id from draum.order_items where order_id=$1`, [o.id])).id;
    await markItemsReady(admin, o.id, [itemId]);
    const before = await inv(f.variantM);
    await startRoute(admin, route.id);
    const after = await inv(f.variantM);
    expect(after!.qty_physical).toBe(before!.qty_physical - 1);
    expect(after!.qty_reserved).toBe(before!.qty_reserved - 1);
    const stop = await q1<any>(`select id from draum.delivery_stops where route_id=$1`, [route.id]);
    await expect(completeStop(admin, stop.id, { delivered: true })).rejects.toThrow(/comprovante/);
    await completeStop(admin, stop.id, { delivered: true, proof: "Recebido por Ana (cliente)" });
    const cash0 = await cashPosition();
    await closeRoute(admin, route.id, 25);
    const cash1 = await cashPosition();
    expect(cash1.balance).toBe(round(cash0.balance - 25));
    expect(cash1.committed).toBe(round(cash0.committed - 12)); // estimativa de entrega liquidada
    expect(Number((await q1<any>(`select allocated_cost from draum.delivery_stops where id=$1`, [stop.id])).allocated_cost)).toBe(25);
    expect((await q1<any>(`select status from draum.orders where id=$1`, [o.id])).status).toBe("entregue");
    await setSetting("delivery_cost_estimate", s0.delivery_cost_estimate);
  });
});

function addDaysNotTuesday(t: string) { const d = new Date(t + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

describe("12. Cálculo do caixa comprometido", () => {
  it("segue as fórmulas documentadas, sem dupla contagem", async () => {
    const s0 = await getSettings();
    // zera o efeito de testes anteriores comparando deltas
    await saveSettings(admin, { ...s0, tax_pct: 6, contingency_pct: 10, delivery_cost_estimate: 0, payment_fee_pct: { ...s0.payment_fee_pct, pix: 1 } });
    const f = await fixture(admin, { cost: 90, leadDays: 5 });
    const c0 = await cashPosition();
    const o = await paidOrder(admin, { customerId: f.customerId, fulfillment: "retirada", paymentMethod: "pix",
      items: [{ variantId: f.variantM, qty: 1, mode: "pre", supplierId: f.supplierId, customerPromisedDate: promise(12), termsAccepted: true }] });
    const c1 = await cashPosition();
    // recebido 200, taxa pix 1% = 2 sai na hora; compromete 90 (fornecedor) + 12 (6% de tributos)
    expect(c1.balance).toBe(round(c0.balance + 200 - 2));
    expect(c1.committed).toBe(round(c0.committed + 90 + 12));
    // contingência = 10% × (recebidos de pedidos abertos − obrigações abertas desses pedidos)
    const open = await q1<any>(`select
        (select coalesce(sum(p.amount - p.fee_amount),0) from draum.payments p join draum.orders o on o.id=p.order_id where p.status='conciliado' and o.status not in ('finalizado','cancelado')) rec,
        (select coalesce(sum(b.amount),0) from draum.obligations b join draum.orders o on o.id=b.order_id where b.status in ('aberta','liquidada') and o.status not in ('finalizado','cancelado')) obl`);
    expect(c1.contingency).toBe(round(Math.max(0, open.rec - open.obl) * 0.1));
    expect(c1.free).toBe(round(c1.balance - c1.committed - c1.contingency - c1.safetyReserve));
    // saída manual maior que o caixa livre é recusada
    await expect(createEntry(admin, { category: "marketing", amount: c1.free + 50, occurred_on: todayISO(), description: "Anúncios", reconciled: true })).rejects.toThrow(/excede o caixa livre/);
    // recolhimento de tributo liquida obrigações de tributo
    const taxOpen = (await q1<any>(`select coalesce(sum(amount),0) s from draum.obligations where kind='tributo' and status='aberta'`)).s;
    await createEntry(admin, { category: "tributo", amount: taxOpen, occurred_on: todayISO(), description: "DAS do mês", reconciled: true });
    expect((await cashPosition()).committedByKind.tributo ?? 0).toBe(0);
    await saveSettings(admin, s0);
    expect(o.id).toBeGreaterThan(0);
  });
});

describe("13. Persistência", () => {
  it("os registros sobrevivem ao fechamento e reabertura da conexão", async () => {
    const f = await fixture(admin, { stock: 4 });
    const o = await createOrder(op, { customerId: f.customerId, fulfillment: "retirada", items: [pronta(f.variantM, 1)] });
    await closePool();
    const again = await q1<any>(`select number from draum.orders where id=$1`, [o.id]);
    expect(again.number).toBe(o.number);
    expect((await inv(f.variantM))!.qty_reserved).toBe(1);
  });
});

describe("14. Permissões", () => {
  it("operador não executa operações administrativas", async () => {
    const f = await fixture(admin, { stock: 1 });
    await expect(adjustStock(op, { variantId: f.variantM, newPhysical: 10, unitCost: 1, reason: "x" })).rejects.toThrow(/administradores/);
    await expect(createEntry(op, { category: "marketing", amount: 1, occurred_on: todayISO(), description: "x" })).rejects.toThrow(/administradores/);
    await expect(saveSettings(op, await getSettings())).rejects.toThrow(/administradores/);
    await expect(savePromotion(op, null, {})).rejects.toThrow(/administradores/);
    const { createUser } = await import("@/server/users");
    await expect(createUser(op, { name: "x", email: "x@x.com", password: "1234567890", role: "admin" })).rejects.toThrow(/administradores/);
    // primeiro acesso (/setup) não pode ser reaberto
    await expect(createUser(null, { name: "Invasor", email: "inv@x.com", password: "1234567890", role: "admin" })).rejects.toThrow(/já foi configurado/);
  });

  it("aportes de capital entram no caixa livre", async () => {
    const c0 = await cashPosition();
    await addAporte(admin, 1000);
    expect((await cashPosition()).free).toBeGreaterThan(c0.free + 899);
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }
export { BusinessError };
