import { Settings, round2, BusinessError, q, q1, Db } from "./core";
import { getPool } from "@/lib/db";

/*
  FÓRMULAS (documentadas em docs/REGRAS_FINANCEIRAS.md)

  Receita líquida do pedido  = Σ(qtd × preço unitário) − descontos            (frete cobrado não entra)
  Custo de mercadoria (CMV)  = Σ(qtd × custo unitário)                          (pronta: custo médio; pré: custo fornecedor + frete de aquisição)
  Taxa de pagamento          = taxa real do pagamento conciliado; antes disso, % configurada da forma de pagamento × total cobrado
  Tributos estimados         = % configurada × receita líquida
  Embalagem                  = custo configurado por pedido
  Entrega                    = custo real rateado da rota; antes disso, custo estimado configurado (entrega local) − frete cobrado do cliente
  Margem de contribuição     = receita líquida − CMV − taxa − tributos − embalagem − entrega
  Margem %                   = margem de contribuição ÷ receita líquida
*/

export interface MarginInput {
  lines: { qty: number; unitPrice: number; discount: number; unitCost: number }[];
  paymentMethod?: string | null;
  fulfillment: string;
  shippingCharged?: number;
  actualFee?: number | null;
  actualDeliveryCost?: number | null;
}

export interface MarginResult {
  gross: number; discount: number; netRevenue: number; cogs: number; fee: number; tax: number;
  packaging: number; delivery: number; margin: number; marginPct: number;
}

export function computeMargin(input: MarginInput, s: Settings): MarginResult {
  const gross = round2(input.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));
  const discount = round2(input.lines.reduce((a, l) => a + l.discount, 0));
  const netRevenue = round2(gross - discount);
  const cogs = round2(input.lines.reduce((a, l) => a + l.qty * l.unitCost, 0));
  const charged = netRevenue + (input.shippingCharged ?? 0);
  const feePct = (input.paymentMethod && s.payment_fee_pct?.[input.paymentMethod]) || 0;
  const fee = input.actualFee != null ? round2(input.actualFee) : round2((charged * feePct) / 100);
  const tax = round2((netRevenue * (s.tax_pct || 0)) / 100);
  const packaging = round2(s.packaging_cost || 0);
  const deliveryCost = input.actualDeliveryCost != null
    ? input.actualDeliveryCost
    : input.fulfillment === "entrega_local" ? s.delivery_cost_estimate || 0 : 0;
  const delivery = round2(deliveryCost - (input.shippingCharged ?? 0));
  const margin = round2(netRevenue - cogs - fee - tax - packaging - delivery);
  const marginPct = netRevenue > 0 ? round2((margin / netRevenue) * 100) : 0;
  return { gross, discount, netRevenue, cogs, fee, tax, packaging, delivery, margin, marginPct };
}

export { simulatePrice } from "@/lib/simulate";

export interface Promotion {
  id: number; name: string; kind: string; pct: number; starts_at: Date; ends_at: Date; min_items: number;
  all_products: boolean; requires_vip: boolean; coupon_code: string | null; campaign_id: number | null; active: boolean;
  product_ids: number[] | null;
}

export async function getPromotion(id: number, db: Db = getPool()) {
  return q1<Promotion>(
    `select p.*, (select array_agg(product_id) from draum.promotion_products pp where pp.promotion_id = p.id) as product_ids
       from draum.promotions p where p.id = $1`, [id], db);
}

export async function listPromotions() {
  return q<Promotion & { campaign_name: string | null }>(
    `select p.*, c.name as campaign_name, (select array_agg(product_id) from draum.promotion_products pp where pp.promotion_id = p.id) as product_ids
       from draum.promotions p left join draum.campaigns c on c.id = p.campaign_id order by p.starts_at`);
}

/**
 * Valida a promoção para os itens do pedido. Descontos NÃO são cumulativos:
 * com promoção, o preço base é o preço de venda (ignora preço promocional do produto).
 * Retorna o desconto por linha, aplicado somente nos produtos elegíveis.
 */
/** Preço com desconto da Black Friday terminando em ,90 — sempre arredonda para baixo, então o desconto nunca fica menor que o anunciado */
export function promoUnitPrice(unit: number, pct: number) {
  const p = round2(unit - (unit * pct) / 100);
  const r = round2(Math.floor(p - 0.9 + 1e-9) + 0.9);
  return r > 0 ? r : p;
}

export function applyPromotion(
  promo: Promotion,
  lines: { productId: number; qty: number; unitPrice: number }[],
  ctx: { now: Date; customerIsVip: boolean; couponCode?: string | null }
): number[] {
  if (!promo.active) throw new BusinessError(`A promoção "${promo.name}" está inativa.`);
  if (ctx.now < new Date(promo.starts_at) || ctx.now > new Date(promo.ends_at))
    throw new BusinessError(`A promoção "${promo.name}" não está vigente agora.`);
  if (promo.requires_vip && !ctx.customerIsVip) throw new BusinessError(`A promoção "${promo.name}" é exclusiva para membros do DRAUM PRIVATE ACCESS.`);
  if (promo.coupon_code && promo.coupon_code.toUpperCase() !== (ctx.couponCode ?? "").toUpperCase())
    throw new BusinessError(`A promoção "${promo.name}" exige o cupom correto.`);
  const eligible = (pid: number) => promo.all_products || (promo.product_ids ?? []).map(Number).includes(Number(pid));
  const eligibleQty = lines.filter((l) => eligible(l.productId)).reduce((a, l) => a + l.qty, 0);
  if (eligibleQty === 0) throw new BusinessError(`Nenhum item do pedido é elegível para "${promo.name}".`);
  if (eligibleQty < promo.min_items) throw new BusinessError(`"${promo.name}" exige no mínimo ${promo.min_items} peça(s) elegível(is).`);
  return lines.map((l) => !eligible(l.productId) ? 0
    : promo.kind === "black_friday" ? round2(l.qty * (l.unitPrice - promoUnitPrice(l.unitPrice, Number(promo.pct))))
    : round2((l.qty * l.unitPrice * Number(promo.pct)) / 100));
}
