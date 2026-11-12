import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";
import { cashPosition, financialIndicators, listEntries, listObligations, pendingPayments, ENTRY_CATEGORIES } from "@/server/finance";
import { getSettings, pendingSettings, todayISO, addDays } from "@/server/core";
import { q } from "@/lib/db";
import { PageHeader, Section, Stat, Empty, Badge, Tabs, Alert, FilterBar } from "@/components/ui";
import { ActionForm, ActionButton, Field, Disclosure } from "@/components/forms";
import { PairedBars } from "@/components/charts";
import { Simulator } from "@/components/Simulator";
import { createEntryAction, toggleReconciledAction, addPayableAction, payPayableAction } from "@/app/actions/finance";
import { reconcilePaymentAction } from "@/app/actions/orders";
import { brl, dateBR, dateTimeBR } from "@/lib/format";

export const metadata = { title: "Financeiro" };
const KIND: Record<string, string> = { mercadoria: "Fornecedor (pré-venda)", tributo: "Tributos estimados", entrega: "Entregas a realizar", reembolso: "Reembolsos", conta_pagar: "Contas a pagar" };

export default async function Financeiro({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const tab = sp.aba ?? "painel";
  const from = sp.de ?? addDays(todayISO(), -30), to = sp.ate ?? todayISO();
  const [pos, ind, s, pend] = await Promise.all([cashPosition(), financialIndicators(from, to), getSettings(), pendingPayments()]);
  const missing = pendingSettings(s);
  return (
    <>
      <PageHeader eyebrow="Gestão de caixa e margem" title="Financeiro" description="Faturamento ≠ recebimento ≠ margem ≠ lucro ≠ caixa disponível." />
      {missing.length > 0 && <div className="mb-6"><Alert>Parâmetros zerados afetam margem e caixa comprometido: {missing.join(", ")}. <Link className="link" href="/configuracoes">Configurar</Link></Alert></div>}
      <Tabs current={tab} tabs={[
        { key: "painel", label: "Painel", href: "/financeiro" }, { key: "lancamentos", label: "Lançamentos", href: "/financeiro?aba=lancamentos" },
        { key: "comprometido", label: "Caixa comprometido", href: "/financeiro?aba=comprometido" }, { key: "simulador", label: "Simulador de preço", href: "/financeiro?aba=simulador" },
        { key: "formulas", label: "Fórmulas", href: "/financeiro?aba=formulas" },
      ]} />

      {tab === "painel" && <Painel pos={pos} ind={ind} from={from} to={to} pend={pend} contingencyPct={s.contingency_pct} />}
      {tab === "lancamentos" && <Lancamentos sp={sp} />}
      {tab === "comprometido" && <Comprometido pos={pos} />}
      {tab === "simulador" && (
        <Section title="Simulador de preço e promoção"><div className="card-pad">
          <Simulator defaults={{ feePct: s.payment_fee_pct?.cartao_credito ?? 0, taxPct: s.tax_pct, packaging: s.packaging_cost, deliveryCost: s.delivery_cost_estimate, targetMarginPct: s.min_margin_pct }} />
        </div></Section>
      )}
      {tab === "formulas" && <Formulas pct={s.contingency_pct} />}
    </>
  );
}

async function Painel({ pos, ind, from, to, pend, contingencyPct }: any) {
  const weekly = await q<any>(`select to_char(date_trunc('week', occurred_on),'YYYY-MM-DD') semana,
      coalesce(sum(amount) filter (where direction='entrada' and reconciled),0)::float entradas, coalesce(sum(amount) filter (where direction='saida'),0)::float saidas
      from draum.cash_entries where occurred_on between $1 and $2 group by 1 order by 1`, [from, to]);
  return (
    <>
      <div className="grid md:grid-cols-4 gap-3 mb-3">
        <Stat label="Saldo de caixa (base conciliada)" value={brl(pos.balance)} hint="entradas conciliadas − todas as saídas" />
        <Stat label="Caixa comprometido" value={brl(pos.committed)} hint="obrigações de pedidos pagos" href="/financeiro?aba=comprometido" />
        <Stat label={`Reserva de contingência (${contingencyPct}%)`} value={brl(pos.contingency)} hint={pos.safetyReserve ? `+ reserva fixa ${brl(pos.safetyReserve)}` : "sobre a parte não comprometida"} />
        <Stat label="Caixa livre estimado" value={brl(pos.free)} tone={pos.free < 0 ? "crit" : undefined} hint="pode financiar reposição e despesas" />
      </div>
      {pos.informedPayments > 0 && <div className="mb-6"><Alert>{brl(pos.informedPayments)} em pagamentos informados aguardam conciliação e <b>não</b> estão no saldo.</Alert></div>}
      <FilterBar>
        <Field label="De"><input className="input" type="date" name="de" defaultValue={from} /></Field>
        <Field label="Até"><input className="input" type="date" name="ate" defaultValue={to} /></Field>
      </FilterBar>
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-3 mb-6">
        <Stat label="Receita bruta" value={brl(ind.gross)} hint={`${ind.orders} pedidos`} />
        <Stat label="Descontos" value={brl(ind.discounts)} />
        <Stat label="Receita após descontos" value={brl(ind.netSales)} />
        <Stat label="Recebido (conciliado)" value={brl(ind.received)} />
        <Stat label="Entradas efetivas" value={brl(ind.cashIn)} />
        <Stat label="Saídas efetivas" value={brl(ind.cashOut)} />
        <Stat label="Despesas operacionais" value={brl(ind.opex)} />
      </div>
      <div className="grid xl:grid-cols-[1fr_420px] gap-6 items-start">
        <Section title="Entradas × saídas por semana"><div className="card-pad"><PairedBars data={weekly} x="semana" a={{ key: "entradas", label: "Entradas conciliadas" }} b={{ key: "saidas", label: "Saídas" }} /></div></Section>
        <Section title={`Pagamentos a conciliar (${pend.length})`}>
          {pend.length === 0 ? <Empty title="Nada pendente" /> : (
            <ul className="divide-y divide-line">{pend.map((p: any) => (
              <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 text-[13px]">
                <div><Link className="font-mono text-[12px] link" href={`/pedidos/${p.order_id}`}>{p.number}</Link> · {p.customer_name}<div className="text-[11.5px] text-muted">{dateTimeBR(p.informed_at)} · {p.external_ref ?? "sem ID"}</div></div>
                <div className="flex items-center gap-3"><span className="num">{brl(p.amount)}</span>
                  <ActionButton action={reconcilePaymentAction} fields={{ payment_id: p.id }} label="Conciliar" className="btn-primary btn-sm" confirm={`Confirma que ${brl(p.amount)} entrou na conta?`} /></div>
              </li>))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

async function Lancamentos({ sp }: { sp: Record<string, string> }) {
  const rows = await listEntries({ from: sp.de, to: sp.ate, direction: sp.tipo, category: sp.cat });
  const manual = Object.entries(ENTRY_CATEGORIES).filter(([k]) => !["venda", "reembolso", "compra_mercadoria"].includes(k));
  return (
    <>
      <div className="mb-5"><Disclosure label="Novo lançamento">
        <div className="card card-pad max-w-3xl">
          <ActionForm action={createEntryAction} submitLabel="Registrar" reset className="grid sm:grid-cols-3 gap-3">
            <Field label="Categoria"><select className="input" name="category">{manual.map(([k, v]) => <option key={k} value={k}>{v.dir === "entrada" ? "↑" : "↓"} {v.label}</option>)}</select></Field>
            <Field label="Valor (R$)"><input className="input" name="amount" type="number" step="0.01" min="0.01" required /></Field>
            <Field label="Data"><input className="input" name="occurred_on" type="date" defaultValue={todayISO()} required /></Field>
            <Field label="Descrição" className="sm:col-span-2"><input className="input" name="description" required /></Field>
            <label className="flex items-center gap-2 text-[13px] self-end h-9"><input type="checkbox" name="reconciled" /> Já conferido no extrato</label>
          </ActionForm>
          <p className="text-[11.5px] text-muted mt-3">Vendas, compras de mercadoria e reembolsos são lançados automaticamente pelos fluxos. Saídas manuais não podem exceder o caixa livre. Entradas só contam no saldo depois de conferidas no extrato.</p>
        </div>
      </Disclosure></div>
      <FilterBar>
        <input className="input w-36" type="date" name="de" defaultValue={sp.de} /><input className="input w-36" type="date" name="ate" defaultValue={sp.ate} />
        <input type="hidden" name="aba" value="lancamentos" />
        <select className="input w-32" name="tipo" defaultValue={sp.tipo ?? ""}><option value="">Entradas e saídas</option><option value="entrada">Entradas</option><option value="saida">Saídas</option></select>
        <select className="input w-48" name="cat" defaultValue={sp.cat ?? ""}><option value="">Todas as categorias</option>{Object.entries(ENTRY_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      </FilterBar>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty title="Sem lançamentos" /> : (
          <table className="table"><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Origem</th><th className="text-right">Valor</th><th>Extrato</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}><td>{dateBR(e.occurred_on)}</td><td>{ENTRY_CATEGORIES[e.category]?.label}</td><td>{e.description}</td>
                <td className="text-[12px]">{e.order_number ?? e.po_number ?? (e.created_by ? `manual · ${e.user_name}` : "")}</td>
                <td className={`text-right num ${e.direction === "saida" ? "text-crit" : ""}`}>{e.direction === "saida" ? "− " : "+ "}{brl(e.amount)}</td>
                <td>{e.payment_id ? <Badge value="conciliado" /> : <ActionButton action={toggleReconciledAction} fields={{ id: e.id, value: String(!e.reconciled) }} label={e.reconciled ? "conciliado ✓" : "conferir"} className={e.reconciled ? "chip-ok cursor-pointer" : "btn-secondary btn-sm"} />}</td></tr>))}
            </tbody></table>
        )}
      </div>
    </>
  );
}

async function Comprometido({ pos }: any) {
  const rows = await listObligations("aberta");
  return (
    <div className="grid xl:grid-cols-[1fr_360px] gap-6 items-start">
      <Section title="Obrigações abertas (caixa comprometido)">
        {rows.length === 0 ? <Empty title="Nenhuma obrigação aberta" /> : (
          <table className="table"><thead><tr><th>Tipo</th><th>Descrição</th><th>Referência</th><th>Vencimento</th><th className="text-right">Valor</th><th></th></tr></thead>
            <tbody>{rows.map((o: any) => (
              <tr key={o.id}><td>{KIND[o.kind]}</td><td>{o.description}</td>
                <td className="text-[12px]">{o.order_id ? <Link className="link" href={`/pedidos/${o.order_id}`}>{o.order_number}</Link> : o.purchase_order_id ? <Link className="link" href={`/pre-vendas/compras/${o.purchase_order_id}`}>{o.po_number}</Link> : "—"}</td>
                <td>{dateBR(o.due_on)}</td><td className="text-right num">{brl(o.amount)}</td>
                <td>{o.kind === "conta_pagar" && !o.purchase_order_id && (
                  <ActionForm action={payPayableAction} submitLabel="Pagar" submitClass="btn-secondary btn-sm" inline className="flex gap-2">
                    <input type="hidden" name="id" value={o.id} />
                    <select className="input h-7 w-40" name="category">{Object.entries(ENTRY_CATEGORIES).filter(([k, v]) => v.dir === "saida" && !["reembolso", "compra_mercadoria"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                  </ActionForm>)}</td></tr>))}
            </tbody></table>
        )}
      </Section>
      <div className="space-y-6">
        <Section title="Composição"><ul className="card-pad space-y-2 text-[13px]">
          {Object.entries(KIND).map(([k, l]) => <li key={k} className="flex justify-between"><span>{l}</span><span className="num">{brl(pos.committedByKind[k] ?? 0)}</span></li>)}
          <li className="vao my-2" /><li className="flex justify-between font-medium"><span>Total comprometido</span><span className="num">{brl(pos.committed)}</span></li>
        </ul></Section>
        <Section title="Nova conta a pagar"><div className="card-pad">
          <ActionForm action={addPayableAction} submitLabel="Registrar" reset className="space-y-3">
            <Field label="Descrição"><input className="input" name="description" required /></Field>
            <Field label="Valor (R$)"><input className="input" name="amount" type="number" step="0.01" min="0.01" required /></Field>
            <Field label="Vencimento"><input className="input" name="due_on" type="date" /></Field>
          </ActionForm>
        </div></Section>
      </div>
    </div>
  );
}

function Formulas({ pct }: { pct: number }) {
  const F = [
    ["Faturamento bruto", "Σ (quantidade × preço de venda) dos pedidos não cancelados, antes de descontos."],
    ["Receita após descontos", "Faturamento bruto − descontos concedidos. Frete cobrado não entra."],
    ["Recebimento", "Somente pagamentos conciliados com o extrato. Pagamento informado (comprovante) não conta."],
    ["Saldo de caixa (base conciliada)", "Σ entradas conciliadas − Σ todas as saídas registradas (as saídas contam mesmo antes da conferência: critério conservador)."],
    ["Caixa comprometido", "Σ obrigações abertas: custo das pré-vendas pagas ainda não pago ao fornecedor + tributos estimados não recolhidos + custo estimado das entregas locais não realizadas + reembolsos aprovados + contas a pagar."],
    ["Reserva de contingência", `${pct}% × Σ por pedido em aberto (recebido conciliado − taxas − obrigações abertas ou já pagas em nome do pedido). Aplicada só à parte não comprometida, sem dupla contagem.`],
    ["Caixa livre estimado", "Saldo conciliado − comprometido − contingência − reserva de segurança fixa."],
    ["Margem de contribuição", "Receita após descontos − custo das peças − taxas de pagamento − tributos estimados − embalagem − (custo de entrega − frete cobrado)."],
    ["CMV", "Σ quantidade × custo unitário dos itens entregues no período (pronta: custo médio; pré-venda: custo confirmado + frete de aquisição)."],
    ["Resultado operacional estimado", "Margem de contribuição − despesas operacionais (operacional, marketing, embalagens avulsas, outras)."],
    ["Regra de financiamento das compras", "Ao pagar um fornecedor, só o valor reservado pelos próprios pedidos vinculados é usado. O excedente (reposição, frete extra, custo maior) precisa caber no caixa livre."],
  ];
  return (
    <Section title="Fórmulas financeiras do sistema">
      <dl className="divide-y divide-line">{F.map(([k, v]) => <div key={k} className="px-5 py-3.5 grid md:grid-cols-[260px_1fr] gap-2"><dt className="font-medium">{k}</dt><dd className="text-espresso">{v}</dd></div>)}</dl>
    </Section>
  );
}
