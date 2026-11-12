import { z } from "zod";
import { BusinessError, Ctx, q, q1, audit, round2, requireAdmin } from "./core";
import { tx } from "@/lib/db";
import { FUNNEL, stageIndex, advanceFunnel } from "./funnel";

export const LEAD_SOURCES: Record<string, string> = {
  instagram: "Instagram", indicacao: "Indicação", whatsapp: "WhatsApp", embaixadora: "Embaixadora", evento: "Evento", site: "Site", outro: "Outro",
};

/** Normaliza WhatsApp para dígitos com DDI 55 (formato do link wa.me) */
export function normalizeWhatsapp(v?: string | null) {
  if (!v) return null;
  let d = v.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12 || d.length > 13) throw new BusinessError(`WhatsApp inválido: ${v}. Use DDD + número.`);
  return d;
}

const customerSchema = z.object({
  name: z.string().trim().min(2, "Nome obrigatório"),
  whatsapp: z.string().optional().nullable(),
  instagram: z.string().trim().optional().nullable(),
  email: z.string().trim().email("E-mail inválido").optional().nullable().or(z.literal("")),
  city: z.string().trim().optional().nullable(),
  neighborhood: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  product_prefs: z.string().trim().optional().nullable(),
  sizes: z.string().trim().optional().nullable(),
  lead_source: z.enum(Object.keys(LEAD_SOURCES) as [string, ...string[]]).optional().nullable(),
  vip_joined_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
  consent_whatsapp: z.boolean().default(false),
  consent_email: z.boolean().default(false),
  consent_source: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  campaign_id: z.coerce.number().int().positive().optional().nullable(),
  ambassador_id: z.coerce.number().int().positive().optional().nullable(),
});

function clean(c: z.infer<typeof customerSchema>) {
  return {
    ...c, whatsapp: normalizeWhatsapp(c.whatsapp), email: c.email || null, vip_joined_at: c.vip_joined_at || null,
    instagram: c.instagram ? c.instagram.replace(/^@/, "") : null,
  };
}

export async function createCustomer(ctx: Ctx, raw: unknown) {
  const c0 = clean(customerSchema.parse(raw));
  return tx(async (c) => {
    if (c0.whatsapp) {
      const dup = await q1<any>(`select id, name from draum.customers where whatsapp=$1`, [c0.whatsapp], c);
      if (dup) throw new BusinessError(`Já existe cliente com este WhatsApp: ${dup.name}.`);
    }
    const stage = c0.vip_joined_at ? "entrou_vip" : "novo_lead";
    const r = await q1<{ id: number }>(
      `insert into draum.customers(name, whatsapp, instagram, email, city, neighborhood, address, product_prefs, sizes, lead_source, vip_joined_at,
         funnel_stage, consent_whatsapp, consent_email, consent_at, consent_source, notes, campaign_id, ambassador_id)
       values ($1,$2,$3,$4,coalesce($5,'Belém'),$6,$7,$8,$9,$10,$11,$12,$13,$14, case when $13 or $14 then now() end, $15,$16,$17,$18) returning id`,
      [c0.name, c0.whatsapp, c0.instagram, c0.email, c0.city || null, c0.neighborhood || null, c0.address || null, c0.product_prefs || null, c0.sizes || null,
        c0.lead_source ?? null, c0.vip_joined_at, stage, c0.consent_whatsapp, c0.consent_email, c0.consent_source || null, c0.notes || null,
        c0.campaign_id ?? null, c0.ambassador_id ?? null], c);
    await c.query(`insert into draum.funnel_events(customer_id, stage) values ($1,'novo_lead')`, [r!.id]);
    if (stage === "entrou_vip") await c.query(`insert into draum.funnel_events(customer_id, stage) values ($1,'entrou_vip')`, [r!.id]);
    await audit(c, ctx, "customer", r!.id, "criar");
    return r!;
  });
}

export async function updateCustomer(ctx: Ctx, id: number, raw: unknown) {
  const c0 = clean(customerSchema.parse(raw));
  return tx(async (c) => {
    const before = await q1<any>(`select * from draum.customers where id=$1 for update`, [id], c);
    if (!before) throw new BusinessError("Cliente não encontrado.");
    if (c0.whatsapp) {
      const dup = await q1<any>(`select id, name from draum.customers where whatsapp=$1 and id<>$2`, [c0.whatsapp, id], c);
      if (dup) throw new BusinessError(`Já existe cliente com este WhatsApp: ${dup.name}.`);
    }
    const consentChanged = before.consent_whatsapp !== c0.consent_whatsapp || before.consent_email !== c0.consent_email;
    await c.query(
      `update draum.customers set name=$2, whatsapp=$3, instagram=$4, email=$5, city=$6, neighborhood=$7, address=$8, product_prefs=$9, sizes=$10,
         lead_source=$11, vip_joined_at=$12, consent_whatsapp=$13, consent_email=$14, consent_source=$15, notes=$16, campaign_id=$17, ambassador_id=$18,
         consent_at = case when $19 then now() else consent_at end where id=$1`,
      [id, c0.name, c0.whatsapp, c0.instagram, c0.email, c0.city || null, c0.neighborhood || null, c0.address || null, c0.product_prefs || null, c0.sizes || null,
        c0.lead_source ?? null, c0.vip_joined_at, c0.consent_whatsapp, c0.consent_email, c0.consent_source || null, c0.notes || null,
        c0.campaign_id ?? null, c0.ambassador_id ?? null, consentChanged]);
    if (c0.vip_joined_at && !before.vip_joined_at) await advanceFunnel(c, id, "entrou_vip");
    await audit(c, ctx, "customer", id, "editar", consentChanged ? { consent: { whatsapp: c0.consent_whatsapp, email: c0.consent_email } } : undefined);
  });
}

/** Mudança manual de etapa (permite retroceder, com registro) */
export async function setStage(ctx: Ctx, id: number, stage: string) {
  if (stageIndex(stage) < 0) throw new BusinessError("Etapa inválida.");
  await tx(async (c) => {
    await c.query(`update draum.customers set funnel_stage=$2 where id=$1`, [id, stage]);
    await c.query(`insert into draum.funnel_events(customer_id, stage) values ($1,$2)`, [id, stage]);
    await audit(c, ctx, "customer", id, "etapa", { stage });
  });
}

export async function logContact(ctx: Ctx, customerId: number, channel: string, note: string) {
  await tx(async (c) => {
    await c.query(`insert into draum.contact_log(customer_id, channel, note, user_id) values ($1,$2,$3,$4)`, [customerId, channel, note || null, ctx.userId]);
    await c.query(`update draum.customers set last_contact_at = now() where id=$1`, [customerId]);
  });
}

/** Exclusão/anonimização (LGPD): clientes com pedidos são anonimizados para preservar a contabilidade. */
export async function deleteCustomer(ctx: Ctx, id: number) {
  requireAdmin(ctx);
  return tx(async (c) => {
    const n = (await q1<{ n: number }>(`select count(*) n from draum.orders where customer_id=$1`, [id], c))!.n;
    if (n > 0) {
      await c.query(`update draum.customers set name='Cliente anonimizado #'||id, whatsapp=null, instagram=null, email=null, address=null, neighborhood=null,
          product_prefs=null, sizes=null, notes=null, consent_whatsapp=false, consent_email=false where id=$1`, [id]);
      await c.query(`update draum.orders set address=null where customer_id=$1`, [id]);
      await c.query(`delete from draum.contact_log where customer_id=$1`, [id]);
      await audit(c, ctx, "customer", id, "anonimizar");
      return { anonymized: true };
    }
    await c.query(`delete from draum.customers where id=$1`, [id]);
    await audit(c, ctx, "customer", id, "excluir");
    return { anonymized: false };
  });
}

export async function listCustomers(f: { search?: string; stage?: string; source?: string; vip?: string; buyers?: string } = {}) {
  const params: unknown[] = []; const where = ["true"];
  if (f.search) { params.push(`%${f.search}%`); where.push(`(c.name ilike $${params.length} or c.whatsapp ilike $${params.length} or c.instagram ilike $${params.length} or c.email ilike $${params.length})`); }
  if (f.stage) { params.push(f.stage); where.push(`c.funnel_stage = $${params.length}`); }
  if (f.source) { params.push(f.source); where.push(`c.lead_source = $${params.length}`); }
  if (f.vip === "sim") where.push(`c.vip_joined_at is not null`);
  if (f.vip === "nao") where.push(`c.vip_joined_at is null`);
  const rows = await q<any>(
    `select c.*, coalesce(st.orders,0) orders, coalesce(st.spent,0) spent, st.last_order
       from draum.customers c left join lateral (
         select count(*) orders, sum(o.total) spent, max(o.created_at) last_order from draum.orders o where o.customer_id = c.id and o.paid_at is not null and o.status <> 'cancelado'
       ) st on true where ${where.join(" and ")} order by c.created_at desc limit 1000`, params);
  if (f.buyers === "sim") return rows.filter((r) => r.orders > 0);
  if (f.buyers === "nao") return rows.filter((r) => r.orders === 0);
  if (f.buyers === "recorrentes") return rows.filter((r) => r.orders > 1);
  return rows;
}

export async function getCustomer(id: number) {
  const customer = await q1<any>(`select c.*, cp.name as campaign_name, a.name as ambassador_name from draum.customers c
      left join draum.campaigns cp on cp.id = c.campaign_id left join draum.ambassadors a on a.id = c.ambassador_id where c.id=$1`, [id]);
  if (!customer) return null;
  const orders = await q<any>(`select id, number, created_at, total, status, financial_status from draum.orders where customer_id=$1 order by created_at desc`, [id]);
  const contacts = await q<any>(`select l.*, u.name as user_name from draum.contact_log l left join draum.users u on u.id = l.user_id where customer_id=$1 order by l.id desc limit 50`, [id]);
  const events = await q<any>(`select * from draum.funnel_events where customer_id=$1 order by id`, [id]);
  const spent = orders.filter((o) => o.status !== "cancelado" && o.financial_status === "pago").reduce((a, o) => a + Number(o.total), 0);
  return { customer, orders, contacts, events, spent: round2(spent) };
}

export async function crmMetrics() {
  const totals = await q1<any>(`select count(*) leads, count(*) filter (where vip_joined_at is not null) vip,
      count(*) filter (where consent_whatsapp) consented from draum.customers where name not like 'Cliente anonimizado%'`);
  const bySource = await q<any>(`select coalesce(lead_source,'nao_informado') source, count(*) n from draum.customers group by 1 order by 2 desc`);
  const buyers = await q1<any>(`select count(distinct customer_id) buyers,
      count(distinct customer_id) filter (where cnt > 1) recurring from (
        select customer_id, count(*) over (partition by customer_id) cnt from draum.orders where paid_at is not null and status <> 'cancelado') x`);
  const vipValue = await q1<{ s: number }>(`select coalesce(sum(o.total),0) s from draum.orders o join draum.customers c on c.id=o.customer_id
      where c.vip_joined_at is not null and o.paid_at is not null and o.status <> 'cancelado'`);
  // Conversão por etapa: clientes que ALCANÇARAM cada etapa (pelo histórico de eventos ou etapa atual)
  const reached = await q<any>(`select stage, count(distinct customer_id) n from (
      select customer_id, stage from draum.funnel_events union select id, funnel_stage from draum.customers) x group by stage`);
  const reachedMap = Object.fromEntries(reached.map((r) => [r.stage, r.n]));
  // Quem está em etapa superior também passou pelas anteriores
  const counts = FUNNEL.map((f, i) => ({
    ...f, current: 0,
    reached: Math.max(...FUNNEL.slice(i).map((g) => reachedMap[g.key] ?? 0), 0),
  }));
  const current = await q<any>(`select funnel_stage, count(*) n from draum.customers group by 1`);
  current.forEach((c) => { const x = counts.find((k) => k.key === c.funnel_stage); if (x) x.current = c.n; });
  const vipGrowth = await q<any>(`select to_char(date_trunc('week', vip_joined_at), 'YYYY-MM-DD') wk, count(*) n from draum.customers
      where vip_joined_at is not null group by 1 order by 1`);
  return {
    leads: totals.leads, vip: totals.vip, consented: totals.consented, buyers: buyers?.buyers ?? 0, recurring: buyers?.recurring ?? 0,
    nonBuyers: totals.leads - (buyers?.buyers ?? 0), vipValue: round2(vipValue!.s), bySource, funnel: counts, vipGrowth,
    vipConversionPct: totals.vip ? round2((Number(await q1<any>(`select count(distinct o.customer_id) n from draum.orders o join draum.customers c on c.id=o.customer_id where c.vip_joined_at is not null and o.paid_at is not null and o.status<>'cancelado'`).then((r) => r.n)) / totals.vip) * 100) : 0,
  };
}

/** Importação CSV de contatos. Exige confirmação de que os contatos autorizaram o cadastro. */
export async function importCustomersCsv(ctx: Ctx, rows: Record<string, string>[], authorized: boolean) {
  if (!authorized) throw new BusinessError("Confirme que os contatos autorizaram o cadastro e o contato pela DRAUM (LGPD).");
  const report = { created: 0, skipped: 0, errors: [] as { line: number; message: string }[] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const yes = (v?: string) => ["sim", "s", "1", "true", "yes", "x"].includes((v ?? "").trim().toLowerCase());
    try {
      await createCustomer(ctx, {
        name: r.nome, whatsapp: r.whatsapp, instagram: r.instagram, email: r.email || "", city: r.cidade, neighborhood: r.bairro,
        product_prefs: r.preferencias, sizes: r.tamanhos, lead_source: LEAD_SOURCES[r.origem] ? r.origem : r.origem ? "outro" : null,
        vip_joined_at: r.data_vip || "", consent_whatsapp: yes(r.consentimento_whatsapp), consent_email: yes(r.consentimento_email),
        consent_source: "importação CSV",
      });
      report.created++;
    } catch (e: any) {
      if (String(e.message).startsWith("Já existe")) report.skipped++;
      else report.errors.push({ line: i + 2, message: e.message ?? "erro" });
    }
  }
  return report;
}

/** Mensagens prontas para copiar e enviar pelo WhatsApp (sem envio automático) */
export function messageTemplates(name: string) {
  const first = name.split(" ")[0];
  return [
    { key: "boas_vindas", label: "Boas-vindas ao VIP", text: `Oi, ${first}! Que bom ter você no DRAUM PRIVATE ACCESS. Aqui você vê as coleções antes de todo mundo e escolhe primeiro cores e tamanhos. Qualquer dúvida, é só chamar.` },
    { key: "lancamento", label: "Acesso antecipado", text: `${first}, o acesso antecipado da nova coleção DRAUM já está aberto para o grupo VIP. Quer que eu separe seu tamanho?` },
    { key: "pre_venda", label: "Pré-venda", text: `${first}, esta peça está em pré-venda: confirmamos o pedido com o fornecedor após o pagamento e te passamos o prazo exato de entrega. Posso reservar a sua?` },
    { key: "delivery_day", label: "Delivery Day", text: `${first}, seu pedido entra no DRAUM DELIVERY DAY desta terça, com entrega gratuita. Vou te avisar quando sair para entrega.` },
    { key: "pos_venda", label: "Pós-venda", text: `${first}, como foi a experiência com sua peça DRAUM? Seu retorno ajuda a gente a fazer cada coleção melhor.` },
  ];
}
