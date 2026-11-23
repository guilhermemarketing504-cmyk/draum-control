import { BusinessError, Ctx, q, q1, round2, getSettings } from "./core";
import { informPayment, reconcilePayment } from "./orders";

/*
  Checkout integrado da InfinitePay (Pix e cartão em até 12x)
  - Cria o link de pagamento do pedido (valor em centavos; order_nsu = número do pedido).
  - A confirmação vem pelo webhook e pelo retorno do cliente; as duas passam por /payment_check,
    porque o webhook não tem assinatura. Só um pagamento confirmado pela API é registrado.
  - O pagamento entra no CONTROL já conciliado: a confirmação vem da própria InfinitePay.
*/

const API = "https://api.checkout.infinitepay.io";
const SYSTEM: Ctx = { userId: null as unknown as number, role: "admin", name: "InfinitePay" };

export const normalizeHandle = (h: string | null | undefined) => (h ?? "").trim().replace(/^\$/, "").replace(/\s+/g, "");

async function post(path: string, body: unknown) {
  const res = await fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

/** Procura a URL de pagamento na resposta (o nome do campo não é documentado) */
function findUrl(o: any): string | null {
  if (!o || typeof o !== "object") return null;
  for (const k of ["url", "link", "checkout_url", "payment_url"]) if (typeof o[k] === "string" && /^https:\/\//.test(o[k])) return o[k];
  for (const v of Object.values(o)) {
    if (typeof v === "string" && /^https:\/\/[^ ]*(checkout|infinitepay|invoice)/i.test(v)) return v;
    if (v && typeof v === "object") { const u = findUrl(v); if (u) return u; }
  }
  return null;
}

export async function createPaymentLink(orderNumber: string, baseUrl: string) {
  const s = await getSettings();
  const handle = normalizeHandle(s.store.infinitepay_handle);
  if (!handle) throw new BusinessError("Pagamento online ainda não configurado.");
  const o = await q1<any>(
    `select o.*, c.name, c.whatsapp, c.email from draum.orders o join draum.customers c on c.id = o.customer_id where o.number = $1`, [orderNumber]);
  if (!o) throw new BusinessError("Pedido não encontrado.");
  if (o.status === "cancelado") throw new BusinessError("Pedido cancelado.");
  const items = await q<any>(
    `select oi.qty, oi.total, p.name, v.color, v.size from draum.order_items oi
       join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id
      where oi.order_id = $1 and oi.status <> 'cancelado' order by oi.id`, [o.id]);
  // Uma linha por item com o total já descontado: o valor cobrado é exatamente o total do pedido
  const lines = items.map((i) => ({ quantity: 1, price: Math.round(Number(i.total) * 100), description: `${i.qty}× ${i.name} — ${i.color} / ${i.size}`.slice(0, 120) }));
  const cents = lines.reduce((a, l) => a + l.price, 0);
  const totalCents = Math.round(Number(o.total) * 100);
  if (cents !== totalCents && lines.length) lines[lines.length - 1].price += totalCents - cents; // frete/arredondamento
  const body: any = {
    handle, items: lines, order_nsu: o.number,
    redirect_url: `${baseUrl}/loja/pedido/${encodeURIComponent(o.number)}`,
    webhook_url: `${baseUrl}/api/infinitepay/webhook`,
    customer: { name: o.name, ...(o.email ? { email: o.email } : {}), ...(o.whatsapp ? { phone_number: `+${o.whatsapp}` } : {}) },
  };
  const r = await post("/links", body);
  const url = findUrl(r.json);
  if (!r.ok || !url) {
    console.error("[infinitepay] falha ao criar link", r.status, r.text.slice(0, 300));
    const msg = /external_checkout_not_enabled/.test(r.text) ? "O checkout integrado não está ativado na InfinitePay (ou a InfiniteTag está incorreta)." : "Não foi possível abrir o pagamento agora.";
    throw new BusinessError(msg);
  }
  await q(`update draum.orders set payment_method = coalesce(payment_method, 'link_pagamento') where id = $1`, [o.id]);
  return url;
}

/** Confere na InfinitePay e registra o pagamento (idempotente: webhook e retorno podem chegar os dois) */
export async function confirmPayment(input: { orderNsu: string; transactionNsu: string; slug: string }) {
  const s = await getSettings();
  const handle = normalizeHandle(s.store.infinitepay_handle);
  if (!handle || !input.orderNsu || !input.transactionNsu || !input.slug) return { paid: false };
  const already = await q1(`select 1 from draum.payments where external_ref = $1 and status <> 'rejeitado'`, [input.transactionNsu]);
  if (already) return { paid: true, already: true };
  const r = await post("/payment_check", { handle, order_nsu: input.orderNsu, transaction_nsu: input.transactionNsu, slug: input.slug });
  if (!r.ok || !r.json?.success || !r.json?.paid) return { paid: false };
  const o = await q1<any>(`select id, total, status from draum.orders where number = $1`, [input.orderNsu]);
  if (!o) return { paid: false };
  const amount = round2(Math.min(Number(r.json.amount ?? 0) / 100, Number(o.total)) || Number(o.total));
  const method = r.json.capture_method === "pix" ? "pix" : "cartao_credito";
  try {
    const p = await informPayment(SYSTEM, o.id, { amount, method, externalRef: input.transactionNsu });
    await reconcilePayment(SYSTEM, p.id);
  } catch (e) {
    // Corrida entre webhook e retorno: o segundo encontra o pagamento já registrado
    if (await q1(`select 1 from draum.payments where external_ref = $1`, [input.transactionNsu])) return { paid: true, already: true };
    throw e;
  }
  return { paid: true, method, installments: r.json.installments ?? 1 };
}

export async function orderPublicStatus(number: string) {
  return q1<any>(
    `select o.number, o.total, o.status, o.financial_status, o.fulfillment, o.promised_date, c.name
       from draum.orders o join draum.customers c on c.id = o.customer_id where o.number = $1`, [number]);
}
