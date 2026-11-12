import Link from "next/link";
import { dashboard } from "@/server/dashboard";
import { listProducts, CATEGORIES } from "@/server/products";
import { listSuppliers } from "@/server/suppliers";
import { todayISO, addDays } from "@/server/core";
import { requireSession } from "@/lib/auth";
import { PageHeader, Stat, Section, Alert, Badge, FilterBar } from "@/components/ui";
import { TwoLines, Bars, PairedBars } from "@/components/charts";
import { Field } from "@/components/forms";
import { brl, int, pct, dateBR } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireSession();
  const from = sp.de ?? addDays(todayISO(), -29), to = sp.ate ?? todayISO();
  const [d, products, suppliers] = await Promise.all([
    dashboard({ from, to, productId: sp.produto ? Number(sp.produto) : undefined, supplierId: sp.fornecedor ? Number(sp.fornecedor) : undefined, mode: (sp.modo as any) || undefined }),
    listProducts(), listSuppliers(),
  ]);
  const k = d.kpis, g = d.goals, c = d.charts, p = d.priorities;
  const admin = user.role === "admin";
  const hasSales = k.ordersTotal > 0;
  const progress = (v: number, goal: number) => (goal ? Math.min(100, (v / goal) * 100) : 0);

  return (
    <>
      <PageHeader eyebrow={`Olá, ${user.name.split(" ")[0]}`} title="Visão executiva"
        description={`Lançamento comercial: Black Friday, 27/11/2026. Próximo Delivery Day: ${dateBR(d.nextTuesday)}.`}
        actions={<Link href="/pedidos/novo" className="btn-primary">Novo pedido</Link>} />
      {sp.negado && <div className="mb-6"><Alert tone="crit">Seu perfil não tem acesso a essa área.</Alert></div>}
      {admin && d.settingsPending.length > 0 && <div className="mb-6"><Alert>Configuração pendente: {d.settingsPending.join(", ")}. Enquanto zerados, margem e caixa comprometido ficam otimistas. <Link className="link" href="/configuracoes">Configurar</Link></Alert></div>}

      <FilterBar>
        <Field label="De"><input className="input w-36" type="date" name="de" defaultValue={from} /></Field>
        <Field label="Até"><input className="input w-36" type="date" name="ate" defaultValue={to} /></Field>
        <Field label="Produto"><select className="input w-48" name="produto" defaultValue={sp.produto ?? ""}><option value="">Todos</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Fornecedor"><select className="input w-44" name="fornecedor" defaultValue={sp.fornecedor ?? ""}><option value="">Todos</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Modalidade"><select className="input w-40" name="modo" defaultValue={sp.modo ?? ""}><option value="">Todas</option><option value="pronta">Pronta-entrega</option><option value="pre">Pré-venda</option></select></Field>
      </FilterBar>

      <div className="label mb-3">Vendas no período{d.filtered ? " · filtrado" : ""}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3 mb-6">
        <Stat label="Faturamento bruto" value={brl(k.gross)} hint={`após descontos ${brl(k.net)}`} />
        <Stat label="Receita recebida" value={brl(k.received)} hint="conciliada" />
        <Stat label="Pedidos realizados" value={int(k.ordersTotal)} href="/pedidos" />
        <Stat label="Pedidos pagos" value={int(k.ordersPaid)} />
        <Stat label="Pedidos pendentes" value={int(k.ordersPending)} tone={k.ordersPending ? "warn" : undefined} href="/pedidos?status=aguardando_pagamento" />
        <Stat label="Ticket médio" value={brl(k.avgTicket)} hint={`meta ${brl(g.avg_ticket)}`} />
        <Stat label="Margem de contribuição" value={k.marginPct != null ? pct(k.marginPct) : "—"} tone={k.marginPct != null && k.marginPct < d.minMargin ? "crit" : undefined} hint={k.marginPct != null ? brl(k.margin) : "sem pedidos pagos"} />
        <Stat label="CMV" value={brl(k.cogs)} hint="itens entregues" />
      </div>

      <div className="label mb-3">Caixa e operação</div>
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3 mb-8">
        <Stat label="Caixa disponível" value={brl(k.cashFree)} tone={k.cashFree < 0 ? "crit" : undefined} hint="livre estimado" href={admin ? "/financeiro" : undefined} />
        <Stat label="Caixa comprometido" value={brl(k.cashCommitted)} href={admin ? "/financeiro?aba=comprometido" : undefined} hint={k.unreconciled ? `${brl(k.unreconciled)} a conciliar` : undefined} />
        <Stat label="Despesas" value={brl(k.expenses)} hint="no período" />
        <Stat label="Estoque total" value={`${int(k.stockUnits)} un.`} hint={`${brl(k.stockValue)} ao custo · ${k.stockReserved} reservadas`} href="/estoque" />
        <Stat label="Estoque baixo" value={int(k.lowStock)} tone={k.lowStock ? "warn" : undefined} href="/estoque?baixo=1" />
        <Stat label="Pré-vendas aguardando fornecedor" value={int(k.presalesToBuy + k.presalesBought)} hint={`${k.presalesToBuy} a comprar · ${k.presalesBought} compradas`} href="/pre-vendas" />
        <Stat label="Prontos para entrega" value={int(k.readyOrders)} hint={`${k.tuesdayStops} na rota de terça`} href="/entregas" />
        <Stat label="Entregas atrasadas" value={int(k.lateOrders)} tone={k.lateOrders ? "crit" : undefined} />
      </div>

      <div className="grid xl:grid-cols-[1fr_380px] gap-6 mb-6 items-start">
        <Section title="Prioridades operacionais do dia">
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line">
            <Priority title="Pagamentos a conciliar" empty="Nenhum pagamento aguardando." items={p.toReconcile.map((x: any) => ({ href: `/pedidos/${x.order_id}`, label: `${x.number} · ${x.name}`, right: brl(x.amount) }))} />
            <Priority title="Conferir e embalar" empty="Nada a embalar." items={p.toPack.map((x: any) => ({ href: `/pedidos/${x.id}`, label: `${x.number} · ${x.name}` }))} />
            <Priority title="Pré-vendas com risco de prazo" empty="Sem riscos de prazo." items={p.presales.map((x: any) => ({ href: `/pedidos/${x.order_id}`, label: `${x.order_number} · ${x.sku}`, right: <Badge value={x.risk.level} label={x.risk.label} /> }))} />
            <Priority title="Estoque baixo" empty="Nenhum SKU abaixo do mínimo." items={p.lowStock.map((x: any) => ({ href: `/estoque?q=${x.sku}`, label: `${x.sku}`, right: `${x.available}/${x.min_qty}` }))} />
          </div>
        </Section>
        <Section title="Metas de lançamento">
          <div className="card-pad space-y-4 text-[12.5px]">
            {[
              ["Membros VIP", k.vipMembers, g.vip_members, int],
              [`Pedidos pagos até ${dateBR(g.paid_orders_deadline)}`, k.ordersPaid, g.paid_orders, int],
              ["Faturamento bruto", k.gross, g.gross_revenue, brl],
            ].map(([label, v, goal, f]: any) => (
              <div key={label}><div className="flex justify-between mb-1.5"><span>{label}</span><span className="num">{f(v)} / {f(goal)}</span></div>
                <div className="h-1.5 bg-offwhite rounded-full"><div className="h-full bg-espresso rounded-full" style={{ width: `${progress(v, goal)}%` }} /></div></div>
            ))}
            <div className="flex justify-between"><span>Conversão de leads VIP</span><span className="num">{pct(k.vipConversionPct)}</span></div>
            <div className="flex justify-between"><span>Margem-alvo</span><span className="num">{pct(g.contribution_margin_pct)}</span></div>
            <p className="text-[11.5px] text-muted">Metas iniciais configuráveis, não resultados realizados. Os indicadores do período seguem os filtros acima.</p>
          </div>
        </Section>
      </div>

      {!hasSales && <div className="mb-6"><Alert tone="info">Ainda não há pedidos no período. Os gráficos de vendas aparecem conforme os registros reais forem lançados.</Alert></div>}
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Faturamento por período × recebido"><div className="card-pad"><TwoLines data={c.revenueSeries} x="date" a={{ key: "faturamento", label: "Faturamento bruto" }} b={{ key: "recebido", label: "Recebido (conciliado)" }} /></div></Section>
        <Section title="Evolução das vendas (acumulado)"><div className="card-pad"><TwoLines data={c.revenueSeries} x="date" a={{ key: "acumulado", label: "Faturamento acumulado" }} /></div></Section>
        <Section title="Pedidos por modalidade"><div className="card-pad"><Bars data={c.modes} x="name" y="value" label="Pedidos" /></div></Section>
        <Section title="Produtos mais vendidos (peças)"><div className="card-pad"><Bars data={c.topProducts} x="name" y="qty" label="Peças" horizontal /></div></Section>
        <Section title="Vendas por categoria"><div className="card-pad"><Bars data={c.categories.map((x: any) => ({ ...x, name: CATEGORIES[x.name]?.label ?? x.name }))} x="name" y="value" label="Receita" money horizontal /></div></Section>
        <Section title="Evolução do grupo VIP (membros acumulados)"><div className="card-pad"><TwoLines data={c.vipSeries} x="semana" a={{ key: "membros", label: "Membros VIP" }} money={false} /></div></Section>
        <Section title="Receitas × despesas (caixa, por semana)"><div className="card-pad"><PairedBars data={c.flows} x="semana" a={{ key: "entradas", label: "Entradas conciliadas" }} b={{ key: "saidas", label: "Saídas" }} /></div></Section>
        <Section title="Margem bruta por produto (%)"><div className="card-pad"><Bars data={c.productMargins.map((x: any) => ({ name: x.name, m: x.marginPct }))} x="name" y="m" label="Margem bruta" horizontal pct /></div></Section>
      </div>
    </>
  );
}

function Priority({ title, items, empty }: { title: string; empty: string; items: { href: string; label: string; right?: React.ReactNode }[] }) {
  return (
    <div className="p-5">
      <div className="label mb-3">{title} {items.length > 0 && <span className="text-mineral">· {items.length}</span>}</div>
      {items.length === 0 ? <p className="text-[12.5px] text-muted">{empty}</p> : (
        <ul className="space-y-2">{items.map((i, n) => <li key={n} className="flex justify-between gap-3 text-[13px]"><Link className="hover:underline truncate" href={i.href}>{i.label}</Link><span className="num shrink-0">{i.right}</span></li>)}</ul>
      )}
    </div>
  );
}
