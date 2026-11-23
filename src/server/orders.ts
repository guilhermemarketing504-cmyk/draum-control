import { z } from "zod";
import { BusinessError, Ctx, Tx, q, q1, round2, audit, requireAdmin, getSettings, todayISO, addDays, Settings } from "./core";
import { tx } from "@/lib/db";
import { reserve, release, dispatchOut, stockIn } from "./inventory";
import { computeMargin, applyPromotion, getPromotion } from "./pricing";
import { advanceFunnel } from "./funnel";

export const PAYMENT_METHODS: Record<string, string> = {
  pix: "Pix", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito",
  link_pagamento: "Link de pagamento", dinheiro: "Dinheiro", transferencia: "Transferência",
};

export const ITEM_STATUS: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento", reservado: "Reservado (separação)", aguardando_compra: "Aguardando compra ao fornecedor",
  comprado: "Comprado ao fornecedor", recebido: "Recebido e conferido", embalado: "Embalado", pronto: "Pronto para envio",
  em_rota: "Em rota", entregue: "Entregue", cancelado: "Cancelado", devolvido: "Devolvido", trocado: "Trocado",
};
export const ORDER_STATUS: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento", pago: "Pagamento confirmado", em_andamento: "Em preparação",
  entregue_parcial: "Entregue parcialmente", entregue: "Entregue", finalizado: "Finalizado", cancelado: "Cancelado",
};
export const FIN_STATUS: Record<string, string> = {
  aguardando: "Aguardando", informado: "Pagamento informado (não conciliado)", pago: "Pago e conciliado",
  parcialmente_reembolsado: "Parcialmente reembolsado", reembolsado: "Reembolsado",
};

const itemSchema = z.object({
  variantId: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().positive().max(50),
  mode: z.enum(["pronta", "pre"]),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  customerPromisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  termsAccepted: z.boolean().optional(),
});

export const orderSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  promotionId: z.coerce.number().int().positive().optional().nullable(),
  couponCode: z.string().trim().optional().nullable(),
  paymentMethod: z.enum(Object.keys(PAYMENT_METHODS) as [string, ...string[]]).optional().nullable(),
  fulfillment: z.enum(["entrega_local", "retirada", "envio"]),
  address: z.string().trim().optional().nullable(),
  neighborhood: z.string().trim().optional().nullable(),
  shippingCharged: z.coerce.number().min(0).default(0),
  notes: z.string().trim().optional().nullable(),
  idempotencyKey: z.string().min(8).optional().nullable(),
  campaignId: z.coerce.number().int().positive().optional().nullable(),
  ambassadorId: z.coerce.number().int().positive().optional().nullable(),
  attribution: z.enum(["cupom", "link", "registro_explicito"]).optional().nullable(),
  marginOverrideReason: z.string().trim().optional().nullable(),
  channel: z.enum(["control", "loja"]).optional().nullable(),
});
export type OrderInput = z.infer<typeof orderSchema>;

const br = (iso: string) => iso.split("-").reverse().join("/");

interface PreparedLine {
  variantId: number; productId: number; sku: string; name: string; mode: "pronta" | "pre"; qty: number;
  unitPrice: number; discount: number; unitCost: number; supplierId: number | null; supplierName?: string;
  leadDays: number | null; checkedAt: Date | null; expectedReady: string | null; promised: string | null; terms: string | null;
}

/** Calcula preços, descontos, custos e validações sem gravar nada (usado também para pré-visualização). */
export async function prepareOrder(c: Tx | undefined, input: OrderInput, s: Settings) {
  const db = c;
  const customer = await q1<any>(`select * from draum.customers where id = $1`, [input.customerId], db);
  if (!customer) throw new BusinessError("Cliente não encontrado.");
  const today = todayISO();
  const now = new Date();
  const lines: PreparedLine[] = [];
  const warnings: string[] = [];

  for (const it of input.items) {
    const v = await q1<any>(
      `select v.id, v.sku, v.active, p.id as product_id, p.name, p.status, p.modality, p.sale_price, p.promo_price,
              coalesce(i.avg_cost,0) avg_cost
         from draum.product_variants v join draum.products p on p.id = v.product_id
         left join draum.inventory i on i.variant_id = v.id where v.id = $1`, [it.variantId], db);
    if (!v || !v.active || v.status !== "ativo") throw new BusinessError(`Variante indisponível para venda (id ${it.variantId}).`);
    if (it.mode === "pronta" && v.modality === "pre") throw new BusinessError(`${v.sku} é vendido apenas em pré-venda.`);
    if (it.mode === "pre" && v.modality === "pronta") throw new BusinessError(`${v.sku} não está habilitado para pré-venda.`);

    const line: PreparedLine = {
      variantId: v.id, productId: v.product_id, sku: v.sku, name: v.name, mode: it.mode, qty: it.qty,
      unitPrice: Number(v.sale_price), discount: 0, unitCost: Number(v.avg_cost), supplierId: null,
      leadDays: null, checkedAt: null, expectedReady: null, promised: it.customerPromisedDate ?? null, terms: null,
    };
    // Sem promoção do pedido, vale o preço promocional do produto (como desconto explícito; não cumulativo)
    if (!input.promotionId && v.promo_price != null) line.discount = round2(it.qty * (Number(v.sale_price) - Number(v.promo_price)));

    if (it.mode === "pre") {
      if (!it.supplierId) throw new BusinessError(`Selecione o fornecedor da pré-venda de ${v.sku}.`);
      const ps = await q1<any>(
        `select ps.*, s.name as supplier_name, s.active from draum.product_suppliers ps join draum.suppliers s on s.id = ps.supplier_id
          where ps.product_id = $1 and ps.supplier_id = $2`, [v.product_id, it.supplierId], db);
      if (!ps || !ps.active) throw new BusinessError(`O fornecedor selecionado não está vinculado a ${v.name}.`);
      if (!ps.availability_checked_at) throw new BusinessError(`Disponibilidade de ${v.name} no fornecedor ${ps.supplier_name} ainda não foi verificada. Verifique antes de confirmar a pré-venda.`);
      const ageDays = (now.getTime() - new Date(ps.availability_checked_at).getTime()) / 86400000;
      if (ageDays > s.availability_valid_days) throw new BusinessError(`A verificação de disponibilidade com ${ps.supplier_name} tem mais de ${s.availability_valid_days} dias. Confirme novamente com o fornecedor.`);
      const expected = addDays(today, ps.lead_days);
      const minPromise = addDays(expected, s.presale_buffer_days);
      if (!it.customerPromisedDate) throw new BusinessError(`Informe o prazo prometido ao cliente para ${v.sku} (mínimo ${minPromise}).`);
      if (it.customerPromisedDate < minPromise) throw new BusinessError(`Prazo prometido para ${v.sku} (${it.customerPromisedDate}) é anterior ao mínimo seguro ${minPromise} (prazo do fornecedor ${ps.lead_days} dias + folga de ${s.presale_buffer_days}).`);
      if (!it.termsAccepted) throw new BusinessError(`O cliente precisa aceitar as condições de fornecimento da pré-venda de ${v.sku}.`);
      Object.assign(line, {
        unitCost: round2(Number(ps.unit_cost) + Number(ps.inbound_freight)), supplierId: ps.supplier_id, supplierName: ps.supplier_name,
        leadDays: ps.lead_days, checkedAt: ps.availability_checked_at, expectedReady: expected,
        terms: `Pré-venda: peça adquirida do fornecedor ${ps.supplier_name} após a confirmação do pagamento. Prazo do fornecedor: ${ps.lead_days} dia(s); previsão de chegada ${br(expected)}; entrega prometida até ${br(it.customerPromisedDate)}. Disponibilidade verificada em ${br(todayISO(new Date(ps.availability_checked_at)))}.`,
      });
    } else if (!line.unitCost) {
      const ps = await q1<any>(`select unit_cost, inbound_freight from draum.product_suppliers where product_id = $1 order by is_primary desc limit 1`, [v.product_id], db);
      if (ps) line.unitCost = round2(Number(ps.unit_cost) + Number(ps.inbound_freight));
      else warnings.push(`${v.sku} sem custo cadastrado: margem pode estar superestimada.`);
    }
    lines.push(line);
  }

  // Promoção do pedido
  let promotion = null;
  if (input.promotionId) {
    promotion = await getPromotion(input.promotionId, db as any);
    if (!promotion) throw new BusinessError("Promoção não encontrada.");
    const discounts = applyPromotion(promotion, lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice })), {
      now, customerIsVip: !!customer.vip_joined_at, couponCode: input.couponCode,
    });
    lines.forEach((l, i) => (l.discount = discounts[i]));
  }

  const margin = computeMargin({
    lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, unitCost: l.unitCost })),
    paymentMethod: input.paymentMethod, fulfillment: input.fulfillment, shippingCharged: input.shippingCharged,
  }, s);
  const marginBelow = margin.discount > 0 && margin.marginPct < s.min_margin_pct;
  if (!marginBelow && margin.marginPct < s.min_margin_pct && margin.netRevenue > 0)
    warnings.push(`Margem estimada ${margin.marginPct}% abaixo da meta de ${s.min_margin_pct}%.`);
  return { customer, lines, promotion, margin, marginBelow, warnings };
}

export async function previewOrder(input: unknown) {
  const parsed = orderSchema.parse(input);
  const s = await getSettings();
  const r = await prepareOrder(undefined, parsed, s);
  return { lines: r.lines, margin: r.margin, marginBelow: r.marginBelow, warnings: r.warnings, minMarginPct: s.min_margin_pct };
}

export async function createOrder(ctx: Ctx, raw: unknown) {
  const input = orderSchema.parse(raw);
  if (input.fulfillment === "entrega_local" && !input.address) throw new BusinessError("Informe o endereço para entrega local.");
  return tx(async (c) => {
    if (input.idempotencyKey) {
      const existing = await q1<{ id: number; number: string }>(`select id, number from draum.orders where idempotency_key = $1`, [input.idempotencyKey], c);
      if (existing) return { ...existing, duplicate: true, margin: null as any, warnings: [] as string[] };
    }
    const s = await getSettings(c);
    const prep = await prepareOrder(c, input, s);
    let overrideBy: number | null = null;
    if (prep.marginBelow) {
      if (ctx.role !== "admin" || !input.marginOverrideReason)
        throw new BusinessError(`O desconto reduz a margem para ${prep.margin.marginPct}% (mínimo ${s.min_margin_pct}%). É necessária aprovação de um administrador com justificativa.`, "margem");
      overrideBy = ctx.userId;
    }

    // Atribuição de marketing: somente com rastreamento confiável
    let ambassadorId: number | null = null, attribution: string | null = null, campaignId = input.campaignId ?? prep.promotion?.campaign_id ?? null;
    if (input.couponCode) {
      const amb = await q1<{ id: number }>(`select id from draum.ambassadors where upper(referral_code) = upper($1) and status = 'ativa'`, [input.couponCode], c);
      if (amb) { ambassadorId = amb.id; attribution = "cupom"; }
      else if (prep.promotion?.coupon_code) attribution = "cupom";
    }
    if (!ambassadorId && input.ambassadorId) {
      if (!input.attribution || input.attribution === "cupom") throw new BusinessError("Para atribuir a venda a uma embaixadora sem cupom, informe a origem: link rastreado ou registro explícito.");
      ambassadorId = input.ambassadorId; attribution = input.attribution;
    }
    if (input.campaignId && !attribution) attribution = input.attribution ?? "registro_explicito";

    const promised = prep.lines.map((l) => l.promised).filter(Boolean).sort().pop() ?? null;
    const subtotal = prep.margin.gross, discountTotal = prep.margin.discount;
    const total = round2(subtotal - discountTotal + input.shippingCharged);
    const order = await q1<{ id: number; number: string }>(
      `insert into draum.orders(customer_id, idempotency_key, subtotal, discount_total, shipping_charged, total, payment_method,
         promotion_id, margin_override_by, margin_override_reason, campaign_id, ambassador_id, attribution, coupon_code,
         fulfillment, address, neighborhood, promised_date, notes, created_by, channel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id, number`,
      [input.customerId, input.idempotencyKey ?? null, subtotal, discountTotal, input.shippingCharged, total, input.paymentMethod ?? null,
        input.promotionId ?? null, overrideBy, overrideBy ? input.marginOverrideReason : null, campaignId, ambassadorId, attribution,
        input.couponCode || null, input.fulfillment, input.address || prep.customer.address || null,
        input.neighborhood || prep.customer.neighborhood || null, promised, input.notes || null, ctx.userId, input.channel ?? "control"], c);

    for (const l of prep.lines) {
      const item = await q1<{ id: number }>(
        `insert into draum.order_items(order_id, variant_id, mode, qty, unit_price, discount, total, unit_cost, supplier_id,
           supplier_lead_days, supplier_checked_at, expected_ready_date, customer_promised_date, terms_accepted, terms_accepted_at, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [order!.id, l.variantId, l.mode, l.qty, l.unitPrice, l.discount, round2(l.qty * l.unitPrice - l.discount), l.unitCost,
          l.supplierId, l.leadDays, l.checkedAt, l.expectedReady, l.promised, l.terms, l.terms ? new Date() : null,
          l.mode === "pronta" ? "reservado" : "aguardando_pagamento"], c);
      // Pronta-entrega: reserva atômica imediata (impede venda duplicada da mesma unidade)
      if (l.mode === "pronta") await reserve(c, l.variantId, l.qty, item!.id, ctx.userId);
    }
    await advanceFunnel(c, input.customerId, "pedido_iniciado");
    await audit(c, ctx, "order", order!.id, "criar", { number: order!.number, total, margin: prep.margin, override: input.marginOverrideReason ?? null });
    return { ...order!, duplicate: false, margin: prep.margin, warnings: prep.warnings };
  });
}

// ───────── Pagamentos ─────────
/** Registra um pagamento INFORMADO (comprovante/aviso). Não entra no caixa até ser conciliado. */
export async function informPayment(ctx: Ctx, orderId: number, input: { amount: number; method: string; externalRef?: string; feeAmount?: number }) {
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new BusinessError("Valor do pagamento inválido.");
  if (!PAYMENT_METHODS[input.method]) throw new BusinessError("Forma de pagamento inválida.");
  return tx(async (c) => {
    const o = await q1<any>(`select * from draum.orders where id = $1 for update`, [orderId], c);
    if (!o) throw new BusinessError("Pedido não encontrado.");
    if (o.status === "cancelado") throw new BusinessError("Pedido cancelado não aceita pagamentos.");
    const paid = await q1<{ s: number }>(`select coalesce(sum(amount),0) s from draum.payments where order_id = $1 and status <> 'rejeitado'`, [orderId], c);
    if (round2(paid!.s + amount) > Number(o.total)) throw new BusinessError(`Valor excede o saldo do pedido (restante R$ ${round2(o.total - paid!.s).toFixed(2)}).`);
    if (input.externalRef) {
      const dup = await q1(`select 1 from draum.payments where external_ref = $1 and status <> 'rejeitado'`, [input.externalRef], c);
      if (dup) throw new BusinessError("Já existe um pagamento com este identificador de transação.");
    }
    const p = await q1<{ id: number }>(
      `insert into draum.payments(order_id, amount, method, fee_amount, external_ref, informed_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [orderId, amount, input.method, round2(Number(input.feeAmount ?? 0)), input.externalRef || null, ctx.userId], c);
    if (o.financial_status === "aguardando") await c.query(`update draum.orders set financial_status = 'informado' where id = $1`, [orderId]);
    await audit(c, ctx, "payment", p!.id, "informar", { orderId, amount });
    return p!;
  });
}

/**
 * Conciliação bancária (somente administrador): confirma que o dinheiro entrou na conta.
 * Só aqui o valor passa a contar no caixa. Quando o pedido fica totalmente pago:
 *  - itens de pré-venda passam a "aguardando compra"
 *  - criam-se as obrigações (caixa comprometido): mercadoria das pré-vendas, tributos e entrega.
 */
export async function reconcilePayment(ctx: Ctx, paymentId: number, feeAmount?: number) {
  requireAdmin(ctx);
  return tx(async (c) => {
    const p = await q1<any>(`select * from draum.payments where id = $1 for update`, [paymentId], c);
    if (!p) throw new BusinessError("Pagamento não encontrado.");
    if (p.status !== "informado") throw new BusinessError("Este pagamento já foi processado.");
    const o = await q1<any>(`select * from draum.orders where id = $1 for update`, [p.order_id], c);
    if (o.status === "cancelado") throw new BusinessError("Pedido cancelado: rejeite o pagamento e registre o estorno.");
    const s = await getSettings(c);
    const fee = feeAmount != null ? round2(feeAmount) : p.fee_amount > 0 ? Number(p.fee_amount)
      : round2((Number(p.amount) * (s.payment_fee_pct?.[p.method] ?? 0)) / 100);
    await c.query(`update draum.payments set status='conciliado', fee_amount=$2, reconciled_at=now(), reconciled_by=$3 where id=$1`, [paymentId, fee, ctx.userId]);
    const entry = await q1<{ id: number }>(
      `insert into draum.cash_entries(direction, category, amount, description, reconciled, order_id, payment_id, created_by)
       values ('entrada','venda',$1,$2,true,$3,$4,$5) returning id`,
      [p.amount, `Recebimento ${o.number}`, o.id, paymentId, ctx.userId], c);
    if (fee > 0) await c.query(
      `insert into draum.cash_entries(direction, category, amount, description, reconciled, order_id, payment_id, created_by)
       values ('saida','taxa_financeira',$1,$2,true,$3,$4,$5)`, [fee, `Taxa ${PAYMENT_METHODS[p.method] ?? p.method} ${o.number}`, o.id, paymentId, ctx.userId]);

    const tot = await q1<{ s: number }>(`select coalesce(sum(amount),0) s from draum.payments where order_id=$1 and status='conciliado'`, [o.id], c);
    let fullyPaid = false;
    if (round2(tot!.s) >= Number(o.total) && !o.paid_at) {
      fullyPaid = true;
      await c.query(`update draum.orders set financial_status='pago', status='pago', paid_at=now(), payment_method=coalesce(payment_method,$2) where id=$1`, [o.id, p.method]);
      await c.query(`update draum.order_items set status='aguardando_compra' where order_id=$1 and mode='pre' and status='aguardando_pagamento'`, [o.id]);
      // Obrigações → caixa comprometido
      const preItems = await q<any>(`select id, qty, unit_cost from draum.order_items where order_id=$1 and mode='pre' and status <> 'cancelado'`, [o.id], c);
      for (const it of preItems)
        await c.query(`insert into draum.obligations(kind, amount, order_id, order_item_id, description) values ('mercadoria',$1,$2,$3,$4)`,
          [round2(it.qty * it.unit_cost), o.id, it.id, `Compra ao fornecedor (pré-venda) ${o.number}`]);
      const net = round2(Number(o.subtotal) - Number(o.discount_total));
      const tax = round2((net * (s.tax_pct || 0)) / 100);
      if (tax > 0) await c.query(`insert into draum.obligations(kind, amount, order_id, description) values ('tributo',$1,$2,$3)`, [tax, o.id, `Tributos estimados ${o.number}`]);
      if (o.fulfillment === "entrega_local" && s.delivery_cost_estimate > 0)
        await c.query(`insert into draum.obligations(kind, amount, order_id, description) values ('entrega',$1,$2,$3)`, [s.delivery_cost_estimate, o.id, `Entrega local ${o.number}`]);
      const prior = await q1<{ n: number }>(`select count(*) n from draum.orders where customer_id=$1 and paid_at is not null and id <> $2 and status <> 'cancelado'`, [o.customer_id, o.id], c);
      await advanceFunnel(c, o.customer_id, prior!.n > 0 ? "recompra" : "compra_realizada");
    }
    await audit(c, ctx, "payment", paymentId, "conciliar", { orderId: o.id, amount: p.amount, fee, fullyPaid, cashEntry: entry!.id });
    return { fullyPaid };
  });
}

export async function rejectPayment(ctx: Ctx, paymentId: number, reason: string) {
  requireAdmin(ctx);
  return tx(async (c) => {
    const p = await q1<any>(`select * from draum.payments where id=$1 for update`, [paymentId], c);
    if (!p || p.status !== "informado") throw new BusinessError("Somente pagamentos informados (não conciliados) podem ser rejeitados.");
    await c.query(`update draum.payments set status='rejeitado' where id=$1`, [paymentId]);
    const left = await q1<{ n: number }>(`select count(*) n from draum.payments where order_id=$1 and status<>'rejeitado'`, [p.order_id], c);
    if (left!.n === 0) await c.query(`update draum.orders set financial_status='aguardando' where id=$1 and financial_status='informado'`, [p.order_id]);
    await audit(c, ctx, "payment", paymentId, "rejeitar", { reason });
  });
}

// ───────── Status operacional ─────────
async function recomputeOrderStatus(c: Tx, orderId: number) {
  const o = await q1<any>(`select status, paid_at from draum.orders where id=$1`, [orderId], c);
  if (!o || o.status === "cancelado" || o.status === "finalizado") return;
  const items = await q<{ status: string }>(`select status from draum.order_items where order_id=$1`, [orderId], c);
  const active = items.filter((i) => !["cancelado"].includes(i.status));
  const done = (s: string) => ["entregue", "devolvido", "trocado"].includes(s);
  let status = o.paid_at ? "pago" : "aguardando_pagamento";
  if (active.length && active.every((i) => done(i.status))) status = "entregue";
  else if (active.some((i) => i.status === "entregue")) status = "entregue_parcial";
  else if (o.paid_at && active.some((i) => !["reservado", "aguardando_compra", "aguardando_pagamento"].includes(i.status))) status = "em_andamento";
  await c.query(`update draum.orders set status=$2 where id=$1`, [orderId, status]);
}
export { recomputeOrderStatus };

/** Conferência e embalagem: itens fisicamente disponíveis e pagos ficam "pronto para envio". */
export async function markItemsReady(ctx: Ctx, orderId: number, itemIds: number[]) {
  return tx(async (c) => {
    const o = await q1<any>(`select * from draum.orders where id=$1 for update`, [orderId], c);
    if (!o?.paid_at) throw new BusinessError("O pedido precisa estar com pagamento conciliado antes da embalagem.");
    for (const id of itemIds) {
      const it = await q1<any>(`select * from draum.order_items where id=$1 and order_id=$2 for update`, [id, orderId], c);
      if (!it) throw new BusinessError("Item não pertence ao pedido.");
      if (!["reservado", "recebido", "embalado"].includes(it.status))
        throw new BusinessError(`Item ${id} está "${ITEM_STATUS[it.status]}" e não pode ser embalado agora.`);
      await c.query(`update draum.order_items set status='pronto' where id=$1`, [id]);
    }
    await recomputeOrderStatus(c, orderId);
    await audit(c, ctx, "order", orderId, "conferir_embalar", { itemIds });
  });
}

/** Retirada na loja ou envio por transportadora: baixa estoque dos itens prontos. */
export async function handOver(ctx: Ctx, orderId: number, itemIds: number[], method: "retirada" | "envio", note?: string) {
  return tx(async (c) => {
    const o = await q1<any>(`select * from draum.orders where id=$1 for update`, [orderId], c);
    if (!o?.paid_at) throw new BusinessError("Pedido sem pagamento conciliado.");
    for (const id of itemIds) {
      const it = await q1<any>(`select * from draum.order_items where id=$1 and order_id=$2 for update`, [id, orderId], c);
      if (!it || it.status !== "pronto") throw new BusinessError("Só itens conferidos e embalados (pronto para envio) podem sair.");
      await dispatchOut(c, it.variant_id, it.qty, it.id, ctx.userId, method === "retirada" ? "Retirada pelo cliente" : "Envio");
      await c.query(`update draum.order_items set status=$2, delivered_at = case when $2='entregue' then now() else null end where id=$1`,
        [id, method === "retirada" ? "entregue" : "em_rota"]);
    }
    await recomputeOrderStatus(c, orderId);
    if (method === "retirada") await advanceFunnel(c, o.customer_id, "pos_venda");
    await audit(c, ctx, "order", orderId, method, { itemIds, note });
  });
}

export async function confirmShipmentDelivered(ctx: Ctx, orderId: number, itemIds: number[]) {
  return tx(async (c) => {
    for (const id of itemIds) {
      const r = await c.query(`update draum.order_items set status='entregue', delivered_at=now() where id=$1 and order_id=$2 and status='em_rota'`, [id, orderId]);
      if (!r.rowCount) throw new BusinessError("Item não está em rota.");
    }
    const o = await q1<any>(`select customer_id from draum.orders where id=$1`, [orderId], c);
    await advanceFunnel(c, o.customer_id, "pos_venda");
    await recomputeOrderStatus(c, orderId);
    await audit(c, ctx, "order", orderId, "confirmar_entrega", { itemIds });
  });
}

export async function finalizeOrder(ctx: Ctx, orderId: number) {
  return tx(async (c) => {
    const o = await q1<any>(`select status from draum.orders where id=$1 for update`, [orderId], c);
    if (o?.status !== "entregue") throw new BusinessError("Só pedidos totalmente entregues podem ser finalizados.");
    await c.query(`update draum.orders set status='finalizado' where id=$1`, [orderId]);
    await audit(c, ctx, "order", orderId, "finalizar");
  });
}

// ───────── Cancelamento e reembolso ─────────
export async function cancelOrder(ctx: Ctx, orderId: number, reason: string) {
  if (!reason?.trim()) throw new BusinessError("Informe o motivo do cancelamento.");
  return tx(async (c) => {
    const o = await q1<any>(`select * from draum.orders where id=$1 for update`, [orderId], c);
    if (!o) throw new BusinessError("Pedido não encontrado.");
    if (o.status === "cancelado") throw new BusinessError("Pedido já cancelado.");
    const items = await q<any>(`select * from draum.order_items where order_id=$1 for update`, [orderId], c);
    if (items.some((i) => ["em_rota", "entregue", "devolvido", "trocado"].includes(i.status)))
      throw new BusinessError("Há itens já despachados ou entregues. Use o fluxo de devolução para esses itens.");
    if (o.paid_at && ctx.role !== "admin") throw new BusinessError("Pedidos pagos só podem ser cancelados por um administrador (envolve reembolso).", "permissao");

    for (const it of items) {
      if (it.status === "cancelado") continue;
      if (it.mode === "pronta" && ["reservado", "embalado", "pronto"].includes(it.status)) {
        await release(c, it.variant_id, it.qty, it.id, ctx.userId, "Cancelamento do pedido");
      }
      if (it.mode === "pre") {
        const poi = await q1<any>(
          `select poi.*, po.status as po_status, po.paid_at from draum.purchase_order_items poi join draum.purchase_orders po on po.id = poi.purchase_order_id
            where poi.order_item_id = $1`, [it.id], c);
        if (poi && poi.qty_received > 0) {
          // peça já recebida e reservada para o pedido: volta ao estoque livre
          await release(c, it.variant_id, poi.qty_received, it.id, ctx.userId, "Cancelamento: peça de pré-venda liberada para estoque");
        }
        if (poi) {
          // A compra ao fornecedor continua válida; a unidade vira reposição de estoque (desvincula do pedido).
          await c.query(`update draum.purchase_order_items set order_item_id = null where id = $1`, [poi.id]);
          if (!poi.paid_at) {
            // obrigação com o fornecedor continua aberta, agora vinculada à compra
            await c.query(`update draum.obligations set order_id = null, order_item_id = null, purchase_order_id = $2, kind='conta_pagar',
                            description = 'Compra a fornecedor (pré-venda cancelada)' where order_item_id = $1 and status='aberta'`, [it.id, poi.purchase_order_id]);
          }
        }
      }
      await c.query(`update draum.order_items set status='cancelado' where id=$1`, [it.id]);
    }
    await c.query(`update draum.obligations set status='cancelada', settled_at=now() where order_id=$1 and status='aberta' and kind in ('mercadoria','tributo','entrega')`, [orderId]);
    await c.query(`update draum.payments set status='rejeitado' where order_id=$1 and status='informado'`, [orderId]);
    await c.query(`update draum.orders set status='cancelado', cancelled_at=now(), cancel_reason=$2 where id=$1`, [orderId, reason]);

    let refundId: number | null = null;
    const paid = await q1<{ s: number }>(`select coalesce(sum(amount),0) s from draum.payments where order_id=$1 and status='conciliado'`, [orderId], c);
    if (paid!.s > 0) {
      const r = await q1<{ id: number }>(`insert into draum.refunds(order_id, amount, reason, created_by) values ($1,$2,$3,$4) returning id`, [orderId, paid!.s, reason, ctx.userId], c);
      refundId = r!.id;
      await c.query(`insert into draum.obligations(kind, amount, order_id, description) values ('reembolso',$1,$2,$3)`, [paid!.s, orderId, `Reembolso ${o.number}`]);
    }
    await audit(c, ctx, "order", orderId, "cancelar", { reason, refundId });
    return { refundId };
  });
}

export async function payRefund(ctx: Ctx, refundId: number) {
  requireAdmin(ctx);
  return tx(async (c) => {
    const r = await q1<any>(`select * from draum.refunds where id=$1 for update`, [refundId], c);
    if (!r || r.status !== "aprovado") throw new BusinessError("Reembolso não está pendente.");
    const o = await q1<any>(`select * from draum.orders where id=$1 for update`, [r.order_id], c);
    const e = await q1<{ id: number }>(
      `insert into draum.cash_entries(direction, category, amount, description, reconciled, order_id, refund_id, created_by)
       values ('saida','reembolso',$1,$2,true,$3,$4,$5) returning id`, [r.amount, `Reembolso ${o.number}`, o.id, refundId, ctx.userId], c);
    await c.query(`update draum.refunds set status='pago', paid_at=now() where id=$1`, [refundId]);
    const ob = await q1<any>(`select id from draum.obligations where order_id=$1 and kind='reembolso' and status='aberta' and amount=$2 order by id limit 1`, [o.id, r.amount], c);
    if (ob) await c.query(`update draum.obligations set status='liquidada', settled_at=now(), settled_by_entry=$2 where id=$1`, [ob.id, e!.id]);
    const totals = await q1<{ paid: number; refunded: number }>(
      `select (select coalesce(sum(amount),0) from draum.payments where order_id=$1 and status='conciliado') paid,
              (select coalesce(sum(amount),0) from draum.refunds where order_id=$1 and status='pago') refunded`, [o.id], c);
    await c.query(`update draum.orders set financial_status=$2 where id=$1`, [o.id, totals!.refunded >= totals!.paid ? "reembolsado" : "parcialmente_reembolsado"]);
    await audit(c, ctx, "refund", refundId, "pagar", { amount: r.amount });
  });
}

// ───────── Troca e devolução (itens já entregues) ─────────
export async function registerReturn(ctx: Ctx, input: {
  orderItemId: number; kind: "troca" | "devolucao"; qty: number; reason: string; restock: boolean;
  newVariantId?: number | null; refundAmount?: number | null;
}) {
  if (!input.reason?.trim()) throw new BusinessError("Informe o motivo.");
  return tx(async (c) => {
    const it = await q1<any>(`select oi.*, o.number, o.customer_id from draum.order_items oi join draum.orders o on o.id = oi.order_id where oi.id=$1 for update of oi`, [input.orderItemId], c);
    if (!it) throw new BusinessError("Item não encontrado.");
    if (it.status !== "entregue") throw new BusinessError("Troca/devolução só se aplica a itens entregues. Para itens não entregues, cancele o pedido.");
    if (input.qty < 1 || input.qty > it.qty) throw new BusinessError("Quantidade inválida.");
    const unitCost = Number(it.unit_cost);
    if (input.restock) await stockIn(c, it.variant_id, input.qty, unitCost, { userId: ctx.userId, note: `${input.kind} ${it.number}`, type: "devolucao" });

    let refundId: number | null = null;
    let newItemId: number | null = null;
    if (input.kind === "devolucao") {
      const proportional = round2((Number(it.total) * input.qty) / it.qty);
      const amount = input.refundAmount != null ? round2(input.refundAmount) : proportional;
      if (amount > proportional) throw new BusinessError("O reembolso não pode superar o valor pago pelo item.");
      if (amount > 0) {
        if (ctx.role !== "admin") throw new BusinessError("Reembolsos exigem administrador.", "permissao");
        const r = await q1<{ id: number }>(`insert into draum.refunds(order_id, amount, reason, created_by) values ($1,$2,$3,$4) returning id`, [it.order_id, amount, input.reason, ctx.userId], c);
        refundId = r!.id;
        await c.query(`insert into draum.obligations(kind, amount, order_id, description) values ('reembolso',$1,$2,$3)`, [amount, it.order_id, `Reembolso devolução ${it.number}`]);
      }
      if (input.qty === it.qty) await c.query(`update draum.order_items set status='devolvido' where id=$1`, [it.id]);
    } else {
      if (!input.newVariantId) throw new BusinessError("Escolha a variante de troca.");
      if (input.qty !== it.qty) throw new BusinessError("Troca parcial: registre a quantidade total do item ou divida o item.");
      const nv = await q1<any>(`select v.id, v.product_id from draum.product_variants v where v.id=$1 and v.active`, [input.newVariantId], c);
      if (!nv) throw new BusinessError("Variante de troca inválida.");
      const n = await q1<{ id: number }>(
        `insert into draum.order_items(order_id, variant_id, mode, qty, unit_price, discount, total, unit_cost, status)
         values ($1,$2,'pronta',$3,$4,$5,$6,$7,'reservado') returning id`,
        [it.order_id, nv.id, it.qty, it.unit_price, it.discount, it.total, it.unit_cost], c);
      newItemId = n!.id;
      await reserve(c, nv.id, it.qty, newItemId, ctx.userId);
      await c.query(`update draum.order_items set status='trocado' where id=$1`, [it.id]);
      await c.query(`update draum.orders set status='em_andamento' where id=$1`, [it.order_id]);
    }
    const ret = await q1<{ id: number }>(
      `insert into draum.returns(order_item_id, kind, qty, reason, restock, new_variant_id, refund_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [it.id, input.kind, input.qty, input.reason, input.restock, input.newVariantId ?? null, refundId, ctx.userId], c);
    await recomputeOrderStatus(c, it.order_id);
    await audit(c, ctx, "return", ret!.id, input.kind, { ...input, refundId, newItemId });
    return { returnId: ret!.id, refundId, newItemId };
  });
}

// ───────── Consultas ─────────
export async function listOrders(f: { search?: string; status?: string; financial?: string; mode?: string; from?: string; to?: string } = {}) {
  const params: unknown[] = [];
  const where = ["true"];
  if (f.search) { params.push(`%${f.search}%`); where.push(`(o.number ilike $${params.length} or c.name ilike $${params.length} or c.whatsapp ilike $${params.length})`); }
  if (f.status) { params.push(f.status); where.push(`o.status = $${params.length}`); }
  if (f.financial) { params.push(f.financial); where.push(`o.financial_status = $${params.length}`); }
  if (f.mode === "pre") where.push(`exists (select 1 from draum.order_items x where x.order_id = o.id and x.mode='pre')`);
  if (f.mode === "pronta") where.push(`not exists (select 1 from draum.order_items x where x.order_id = o.id and x.mode='pre')`);
  if (f.mode === "misto") where.push(`exists (select 1 from draum.order_items x where x.order_id=o.id and x.mode='pre') and exists (select 1 from draum.order_items x where x.order_id=o.id and x.mode='pronta')`);
  if (f.from) { params.push(f.from); where.push(`o.created_at >= $${params.length}::date`); }
  if (f.to) { params.push(f.to); where.push(`o.created_at < ($${params.length}::date + 1)`); }
  return q<any>(
    `select o.*, c.name as customer_name, c.whatsapp,
       (select sum(qty) from draum.order_items x where x.order_id = o.id and x.status <> 'cancelado') as pieces,
       (select string_agg(distinct x.mode, ',') from draum.order_items x where x.order_id = o.id) as modes,
       (select coalesce(sum(amount),0) from draum.payments p where p.order_id = o.id and p.status='conciliado') as paid_amount
     from draum.orders o join draum.customers c on c.id = o.customer_id
     where ${where.join(" and ")} order by o.created_at desc limit 500`, params);
}

export async function getOrder(id: number) {
  const order = await q1<any>(
    `select o.*, c.name as customer_name, c.whatsapp, c.email, c.vip_joined_at, pr.name as promotion_name,
            cp.name as campaign_name, a.name as ambassador_name, u.name as created_by_name, ou.name as override_by_name
       from draum.orders o join draum.customers c on c.id = o.customer_id
       left join draum.promotions pr on pr.id = o.promotion_id left join draum.campaigns cp on cp.id = o.campaign_id
       left join draum.ambassadors a on a.id = o.ambassador_id left join draum.users u on u.id = o.created_by
       left join draum.users ou on ou.id = o.margin_override_by where o.id = $1`, [id]);
  if (!order) return null;
  const items = await q<any>(
    `select oi.*, v.sku, v.color, v.size, p.name as product_name, p.image_url, s.name as supplier_name,
            poi.qty_received, po.number as po_number, po.id as po_id, po.status as po_status, po.tracking_code
       from draum.order_items oi join draum.product_variants v on v.id = oi.variant_id join draum.products p on p.id = v.product_id
       left join draum.suppliers s on s.id = oi.supplier_id
       left join draum.purchase_order_items poi on poi.order_item_id = oi.id
       left join draum.purchase_orders po on po.id = poi.purchase_order_id
      where oi.order_id = $1 order by oi.id`, [id]);
  const payments = await q<any>(`select p.*, u.name as informed_by_name, r.name as reconciled_by_name from draum.payments p
      left join draum.users u on u.id = p.informed_by left join draum.users r on r.id = p.reconciled_by where order_id=$1 order by id`, [id]);
  const refunds = await q<any>(`select * from draum.refunds where order_id=$1 order by id`, [id]);
  const returns = await q<any>(`select r.*, v.sku as new_sku from draum.returns r join draum.order_items oi on oi.id = r.order_item_id
      left join draum.product_variants v on v.id = r.new_variant_id where oi.order_id=$1 order by r.id`, [id]);
  const stops = await q<any>(`select ds.*, dr.route_date, dr.status as route_status from draum.delivery_stops ds join draum.delivery_routes dr on dr.id = ds.route_id where ds.order_id=$1 order by dr.route_date`, [id]);
  const history = await q<any>(`select a.*, u.name as user_name from draum.audit_log a left join draum.users u on u.id=a.user_id
      where (a.entity='order' and a.entity_id=$1) or (a.entity='payment' and a.data->>'orderId'=$1) order by a.id desc limit 50`, [String(id)]);
  const s = await getSettings();
  const fee = payments.filter((p) => p.status === "conciliado").reduce((a, p) => a + Number(p.fee_amount), 0);
  const routeCost = stops.filter((x) => x.allocated_cost != null).reduce((a, x) => a + Number(x.allocated_cost), 0);
  const activeItems = items.filter((i) => !["cancelado", "trocado"].includes(i.status));
  const margin = computeMargin({
    lines: activeItems.map((i) => ({ qty: i.qty, unitPrice: Number(i.unit_price), discount: Number(i.discount), unitCost: Number(i.unit_cost) })),
    paymentMethod: order.payment_method, fulfillment: order.fulfillment, shippingCharged: Number(order.shipping_charged),
    actualFee: payments.some((p) => p.status === "conciliado") ? fee : null,
    actualDeliveryCost: stops.some((x) => x.allocated_cost != null) ? routeCost : null,
  }, s);
  return { order, items, payments, refunds, returns, stops, history, margin };
}
