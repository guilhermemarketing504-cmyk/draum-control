import { q, q1, Ctx, getSettings } from "./core";
import { storePromotions } from "./store";

/** Mensagens de WhatsApp com texto pronto: o CONTROL abre a conversa e a pessoa da equipe só aperta enviar. */
export type NoticeKind = "pedido_confirmado" | "pedido_pendente" | "boas_vindas_vip" | "convite_grupo";

const first = (name: string) => (name ?? "").trim().split(/\s+/)[0] || "tudo bem";
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Data sem hora (coluna date): usa o dia do calendário, sem converter fuso */
const day = (d: Date | string | null) => {
  if (!d) return null;
  const [y, m, dd] = typeof d === "string" ? d.slice(0, 10).split("-").map(Number) : [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
};
const when = (d: Date) => {
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Belem" });
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Belem" })} às ${h.endsWith(":00") ? `${Number(h.slice(0, 2))}h` : h}`;
};

export function orderMessage(o: { customer_name: string; number: string; total: number; promised_date: string | null; status: string; fulfillment: string },
  items: { product_name: string; color: string; size: string; qty: number }[]) {
  const list = items.map((i) => `• ${i.qty > 1 ? `${i.qty}x ` : ""}${i.product_name} (${i.color}, ${i.size})`).join("\n");
  if (o.status === "aguardando_pagamento")
    return `Oi, ${first(o.customer_name)}! Aqui é da DRAUM.\n\nVi que o seu pedido ${o.number} ainda está aguardando o pagamento:\n${list}\n\nTotal: ${brl(o.total)}\n\nQuer que eu te mande o Pix ou o link do cartão? Assim já garanto as suas peças.`;
  const entrega = o.fulfillment === "retirada" ? "Assim que estiver pronto eu te aviso para retirar." :
    o.promised_date ? `A entrega é gratuita em Belém, na ${day(o.promised_date)}.` : "Eu te aviso assim que sair para entrega.";
  return `Oi, ${first(o.customer_name)}! Aqui é da DRAUM.\n\nO seu pedido ${o.number} está confirmado:\n${list}\n\nTotal: ${brl(o.total)}\n${entrega}\n\nQualquer dúvida é só responder aqui. Obrigado por escolher a DRAUM.`;
}

export async function vipWelcomeMessage(name: string, baseUrl: string) {
  const [s, promos] = await Promise.all([getSettings(), storePromotions()]);
  const vip = promos.find((p) => p.requiresVip);
  const link = s.store.vip_code ? `${baseUrl}/loja/vip/${s.store.vip_code}` : `${baseUrl}/loja`;
  const now = new Date();
  const oferta = !vip ? "Você recebe as novidades e as ofertas antes de todo mundo."
    : now < vip.startsAt ? `O seu acesso antecipado está garantido: ${vip.pct}% OFF em tudo a partir de ${when(vip.startsAt)}, antes de todo mundo.`
    : now <= vip.endsAt ? `Os seus ${vip.pct}% OFF em tudo já estão liberados, até ${when(new Date(vip.endsAt.getTime() - 60_000))}.`
    : "Você recebe as novidades e as ofertas antes de todo mundo.";
  return `Oi, ${first(name)}! Seja bem-vinda ao DRAUM Private Access.\n\n${oferta}\n\nO seu link de acesso é este: ${link}\nAbra sempre por ele, neste mesmo celular.\n\nEntrega gratuita em Belém toda terça. Qualquer dúvida, é só me chamar aqui.`;
}

export async function groupInviteMessage(name: string) {
  const vip = (await storePromotions()).find((p) => p.requiresVip);
  const now = new Date();
  const oferta = vip && now <= vip.endsAt
    ? `Lá dentro a Black Friday é ${vip.pct}% OFF em tudo${now < vip.startsAt ? `, a partir de ${when(vip.startsAt)}` : ""}, antes de todo mundo.`
    : "Lá dentro você vê as novidades e as ofertas antes de todo mundo.";
  return `Oi, ${first(name)}! Aqui é da DRAUM. Obrigado por se cadastrar na nossa loja.\n\nQuer entrar no DRAUM Private Access, o nosso grupo exclusivo? ${oferta}\n\nMe responde "QUERO" que eu te mando o convite.`;
}

export async function recordNotice(ctx: Ctx, kind: NoticeKind, refId: number) {
  await q(`insert into draum.whatsapp_notices(kind, ref_id, user_id) values ($1, $2, $3)
           on conflict (kind, ref_id) do update set sent_at = now(), user_id = excluded.user_id`, [kind, refId, ctx.userId]);
}

/** Fila da aba Mensagens: pedidos da loja e novos membros do grupo, com o que já foi avisado */
export async function noticeQueue() {
  const orders = await q<any>(
    `select o.id, o.number, o.total, o.status, o.fulfillment, o.promised_date, o.created_at, c.name as customer_name, c.whatsapp,
            n.sent_at, n.kind as sent_kind
       from draum.orders o join draum.customers c on c.id = o.customer_id
       left join lateral (select sent_at, kind from draum.whatsapp_notices w where w.ref_id = o.id and w.kind like 'pedido%' order by sent_at desc limit 1) n on true
      where o.channel = 'loja' and o.status <> 'cancelado' and o.created_at > now() - interval '21 days'
      order by o.created_at desc limit 100`);
  const items = orders.length ? await q<any>(
    `select i.order_id, p.name as product_name, v.color, v.size, i.qty from draum.order_items i
       join draum.product_variants v on v.id = i.variant_id join draum.products p on p.id = v.product_id
      where i.order_id = any($1) and i.status <> 'cancelado' order by i.id`, [orders.map((o) => o.id)]) : [];
  const vips = await q<any>(
    `select c.id, c.name, c.whatsapp, c.vip_joined_at, c.created_at, n.sent_at
       from draum.customers c left join draum.whatsapp_notices n on n.kind = 'boas_vindas_vip' and n.ref_id = c.id
      where c.whatsapp is not null and c.consent_whatsapp
        and (c.consent_source = 'acesso antecipado VIP (loja)' or c.vip_joined_at is not null)
      order by (n.sent_at is null) desc, coalesce(c.vip_joined_at::timestamptz, c.created_at) desc limit 200`);
  const leads = await q<any>(
    `select c.id, c.name, c.whatsapp, c.created_at, n.sent_at
       from draum.customers c left join draum.whatsapp_notices n on n.kind = 'convite_grupo' and n.ref_id = c.id
      where c.whatsapp is not null and c.consent_whatsapp and c.vip_joined_at is null
        and c.consent_source = 'lista de novidades (loja)'
      order by (n.sent_at is null) desc, c.created_at desc limit 200`);
  return { orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })), vips, leads };
}

export async function orderNotice(orderId: number) {
  const o = await q1<any>(`select o.id, o.number, o.total, o.status, o.fulfillment, o.promised_date, c.name as customer_name, c.whatsapp
                             from draum.orders o join draum.customers c on c.id = o.customer_id where o.id = $1`, [orderId]);
  if (!o) return null;
  const items = await q<any>(`select p.name as product_name, v.color, v.size, i.qty from draum.order_items i
       join draum.product_variants v on v.id = i.variant_id join draum.products p on p.id = v.product_id
      where i.order_id = $1 and i.status <> 'cancelado' order by i.id`, [orderId]);
  const sent = await q1<any>(`select sent_at from draum.whatsapp_notices where ref_id = $1 and kind like 'pedido%' order by sent_at desc limit 1`, [orderId]);
  return { whatsapp: o.whatsapp as string | null, text: orderMessage(o, items), kind: (o.status === "aguardando_pagamento" ? "pedido_pendente" : "pedido_confirmado") as NoticeKind, sentAt: sent?.sent_at ?? null };
}
