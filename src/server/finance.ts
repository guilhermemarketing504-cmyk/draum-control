import { z } from "zod";
import { BusinessError, Ctx, q, q1, round2, audit, requireAdmin, getSettings, Db } from "./core";
import { tx, getPool } from "@/lib/db";

/*
  REGRA CENTRAL: Faturamento ≠ Recebimento ≠ Margem ≠ Lucro ≠ Caixa disponível

  Saldo de caixa (base conciliada) = Σ entradas conciliadas − Σ todas as saídas registradas
      → entradas só contam depois de conciliadas com o extrato; saídas contam assim que registradas (conservador).
  Caixa comprometido = Σ obrigações abertas
      → mercadoria de pré-vendas pagas ainda não paga ao fornecedor, tributos estimados ainda não recolhidos,
        entregas locais ainda não realizadas, reembolsos aprovados e contas a pagar.
  Reserva de contingência = % configurada × max(0, Σ pedidos em aberto: recebido conciliado − taxas − obrigações abertas ou já liquidadas do pedido)
      → aplicada só sobre a parte NÃO comprometida (evita dupla contagem).
  Reserva de segurança = valor fixo configurado.
  Caixa livre estimado = saldo conciliado − comprometido − contingência − reserva de segurança.
*/

export interface CashPosition {
  reconciledIn: number; outflows: number; balance: number; unreconciledIn: number; informedPayments: number;
  committed: number; committedByKind: Record<string, number>; contingency: number; safetyReserve: number; free: number;
  openOrderReceipts: number;
}

export async function cashPosition(db: Db = getPool()): Promise<CashPosition> {
  const s = await getSettings(db);
  const r = await q1<any>(
    `select
       coalesce(sum(amount) filter (where direction='entrada' and reconciled),0) as rin,
       coalesce(sum(amount) filter (where direction='entrada' and not reconciled),0) as unrec,
       coalesce(sum(amount) filter (where direction='saida'),0) as out
     from draum.cash_entries`, [], db);
  const inf = await q1<{ s: number }>(`select coalesce(sum(amount),0) s from draum.payments where status='informado'`, [], db);
  const ob = await q<{ kind: string; s: number }>(`select kind, coalesce(sum(amount),0) s from draum.obligations where status='aberta' group by kind`, [], db);
  const committedByKind: Record<string, number> = {};
  ob.forEach((o) => (committedByKind[o.kind] = round2(o.s)));
  const committed = round2(ob.reduce((a, o) => a + Number(o.s), 0));
  // recebimentos de pedidos ainda não finalizados (não cancelados) e suas obrigações abertas
  // Base da contingência por pedido em aberto: recebido − taxas − obrigações (abertas ou já pagas em nome do pedido)
  const open = await q1<{ rec: number; obl: number }>(
    `select
       coalesce((select sum(p.amount - p.fee_amount) from draum.payments p join draum.orders o on o.id=p.order_id
                  where p.status='conciliado' and o.status not in ('finalizado','cancelado')),0) as rec,
       coalesce((select sum(b.amount) from draum.obligations b join draum.orders o on o.id=b.order_id
                  where b.status in ('aberta','liquidada') and o.status not in ('finalizado','cancelado')),0) as obl`, [], db);
  const uncommittedOpen = Math.max(0, Number(open!.rec) - Number(open!.obl));
  const contingency = round2((uncommittedOpen * (s.contingency_pct || 0)) / 100);
  const balance = round2(Number(r.rin) - Number(r.out));
  const safety = round2(s.safety_reserve_fixed || 0);
  return {
    reconciledIn: round2(r.rin), outflows: round2(r.out), balance, unreconciledIn: round2(r.unrec), informedPayments: round2(inf!.s),
    committed, committedByKind, contingency, safetyReserve: safety, free: round2(balance - committed - contingency - safety),
    openOrderReceipts: round2(open!.rec),
  };
}

export const ENTRY_CATEGORIES: Record<string, { label: string; dir: "entrada" | "saida" }> = {
  venda: { label: "Venda (recebimento)", dir: "entrada" },
  aporte: { label: "Aporte / saldo inicial", dir: "entrada" },
  outra_receita: { label: "Outra receita", dir: "entrada" },
  compra_mercadoria: { label: "Compra de mercadorias", dir: "saida" },
  frete_compra: { label: "Frete de compra", dir: "saida" },
  frete_entrega: { label: "Custo de entrega", dir: "saida" },
  embalagem: { label: "Embalagens", dir: "saida" },
  taxa_financeira: { label: "Taxas financeiras", dir: "saida" },
  tributo: { label: "Tributos", dir: "saida" },
  despesa_operacional: { label: "Despesa operacional", dir: "saida" },
  marketing: { label: "Marketing", dir: "saida" },
  reembolso: { label: "Reembolso", dir: "saida" },
  reinvestimento_estoque: { label: "Reinvestimento em estoque", dir: "saida" },
  outra_despesa: { label: "Outra despesa", dir: "saida" },
};
// Categorias que só nascem de fluxos do sistema (para manter consistência)
const SYSTEM_ONLY = ["venda", "reembolso", "compra_mercadoria"];

const entrySchema = z.object({
  category: z.string(),
  amount: z.coerce.number().positive("Valor deve ser maior que zero"),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(2, "Descreva o lançamento"),
  reconciled: z.boolean().default(false),
});

export async function createEntry(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const e = entrySchema.parse(raw);
  const cat = ENTRY_CATEGORIES[e.category];
  if (!cat) throw new BusinessError("Categoria inválida.");
  if (SYSTEM_ONLY.includes(e.category)) throw new BusinessError("Este tipo de lançamento é gerado automaticamente pelos fluxos de pedidos, compras e reembolsos.");
  return tx(async (c) => {
    if (cat.dir === "saida") {
      // Saídas manuais não podem consumir dinheiro comprometido com pedidos de clientes
      const pos = await cashPosition(c);
      if (e.amount > pos.free + 0.001 && e.category !== "tributo")
        throw new BusinessError(`Saída de R$ ${e.amount.toFixed(2)} excede o caixa livre estimado (R$ ${pos.free.toFixed(2)}). Recursos comprometidos com pedidos não podem ser usados.`);
    }
    const r = await q1<{ id: number }>(
      `insert into draum.cash_entries(direction, category, amount, occurred_on, description, reconciled, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [cat.dir, e.category, round2(e.amount), e.occurred_on, e.description, e.reconciled, ctx.userId], c);
    // Recolhimento de tributos liquida as obrigações de tributo abertas (até o valor pago)
    if (e.category === "tributo") {
      let left = e.amount;
      const obs = await q<any>(`select id, amount from draum.obligations where kind='tributo' and status='aberta' order by created_at for update`, [], c);
      for (const o of obs) {
        if (left + 0.001 < Number(o.amount)) break;
        left = round2(left - Number(o.amount));
        await c.query(`update draum.obligations set status='liquidada', settled_at=now(), settled_by_entry=$2 where id=$1`, [o.id, r!.id]);
      }
    }
    await audit(c, ctx, "cash_entry", r!.id, "criar", e);
    return r!;
  });
}

export async function setEntryReconciled(ctx: Ctx, id: number, reconciled: boolean) {
  requireAdmin(ctx);
  return tx(async (c) => {
    const e = await q1<any>(`select * from draum.cash_entries where id=$1 for update`, [id], c);
    if (!e) throw new BusinessError("Lançamento não encontrado.");
    if (e.payment_id) throw new BusinessError("Recebimentos de pedidos são conciliados pelo fluxo de pagamentos.");
    await c.query(`update draum.cash_entries set reconciled=$2 where id=$1`, [id, reconciled]);
    await audit(c, ctx, "cash_entry", id, reconciled ? "conciliar" : "desconciliar");
  });
}

export async function addPayable(ctx: Ctx, input: { amount: number; description: string; due_on?: string }) {
  requireAdmin(ctx);
  if (!(input.amount > 0) || !input.description) throw new BusinessError("Informe valor e descrição.");
  return tx(async (c) => {
    const r = await q1<{ id: number }>(`insert into draum.obligations(kind, amount, due_on, description) values ('conta_pagar',$1,$2,$3) returning id`,
      [round2(input.amount), input.due_on || null, input.description], c);
    await audit(c, ctx, "obligation", r!.id, "criar", input);
  });
}

export async function payPayable(ctx: Ctx, obligationId: number, category: string) {
  requireAdmin(ctx);
  return tx(async (c) => {
    const o = await q1<any>(`select * from draum.obligations where id=$1 for update`, [obligationId], c);
    if (!o || o.status !== "aberta" || o.kind !== "conta_pagar" || o.purchase_order_id)
      throw new BusinessError("Somente contas a pagar avulsas abertas podem ser pagas aqui (compras pagam-se pela tela de pré-vendas).");
    if (!ENTRY_CATEGORIES[category] || ENTRY_CATEGORIES[category].dir !== "saida" || SYSTEM_ONLY.includes(category)) throw new BusinessError("Categoria inválida.");
    const e = await q1<{ id: number }>(`insert into draum.cash_entries(direction, category, amount, description, created_by) values ('saida',$1,$2,$3,$4) returning id`,
      [category, o.amount, o.description, ctx.userId], c);
    await c.query(`update draum.obligations set status='liquidada', settled_at=now(), settled_by_entry=$2 where id=$1`, [obligationId, e!.id]);
    await audit(c, ctx, "obligation", obligationId, "pagar");
  });
}

export async function listEntries(f: { from?: string; to?: string; direction?: string; category?: string } = {}) {
  const params: unknown[] = []; const where = ["true"];
  if (f.from) { params.push(f.from); where.push(`e.occurred_on >= $${params.length}`); }
  if (f.to) { params.push(f.to); where.push(`e.occurred_on <= $${params.length}`); }
  if (f.direction) { params.push(f.direction); where.push(`e.direction = $${params.length}`); }
  if (f.category) { params.push(f.category); where.push(`e.category = $${params.length}`); }
  return q<any>(`select e.*, o.number as order_number, po.number as po_number, u.name as user_name from draum.cash_entries e
      left join draum.orders o on o.id = e.order_id left join draum.purchase_orders po on po.id = e.purchase_order_id
      left join draum.users u on u.id = e.created_by where ${where.join(" and ")} order by e.occurred_on desc, e.id desc limit 1000`, params);
}

export async function listObligations(status = "aberta") {
  return q<any>(`select b.*, o.number as order_number, po.number as po_number from draum.obligations b
      left join draum.orders o on o.id = b.order_id left join draum.purchase_orders po on po.id = b.purchase_order_id
      where b.status = $1 order by b.created_at desc`, [status]);
}

export async function pendingPayments() {
  return q<any>(`select p.*, o.number, o.total, c.name as customer_name from draum.payments p join draum.orders o on o.id = p.order_id
      join draum.customers c on c.id = o.customer_id where p.status='informado' order by p.informed_at`);
}

/** Indicadores financeiros do período (datas inclusivas, ISO) */
export async function financialIndicators(from: string, to: string) {
  const sales = await q1<any>(
    `select coalesce(sum(subtotal),0) gross, coalesce(sum(discount_total),0) discounts, count(*) n
       from draum.orders where status <> 'cancelado' and created_at >= $1::date and created_at < $2::date + 1`, [from, to]);
  const flows = await q1<any>(
    `select coalesce(sum(amount) filter (where direction='entrada' and reconciled),0) cin,
            coalesce(sum(amount) filter (where direction='saida'),0) cout,
            coalesce(sum(amount) filter (where direction='saida' and category in ('despesa_operacional','marketing','embalagem','outra_despesa')),0) opex,
            coalesce(sum(amount) filter (where direction='saida' and category not in ('compra_mercadoria','reinvestimento_estoque','reembolso')),0) expenses
       from draum.cash_entries where occurred_on between $1 and $2`, [from, to]);
  const received = await q1<{ s: number }>(`select coalesce(sum(amount),0) s from draum.payments where status='conciliado' and reconciled_at >= $1::date and reconciled_at < $2::date + 1`, [from, to]);
  return {
    gross: round2(sales.gross), discounts: round2(sales.discounts), netSales: round2(sales.gross - sales.discounts), orders: sales.n,
    cashIn: round2(flows.cin), cashOut: round2(flows.cout), opex: round2(flows.opex), expenses: round2(flows.expenses), received: round2(received!.s),
  };
}
