import { q } from "./core";
import { listInventory } from "./inventory";
import { listPresales, purchaseNeeds } from "./presales";
import { listCustomers, crmMetrics } from "./crm";
import { listEntries } from "./finance";
import { listCampaigns, listAmbassadors } from "./marketing";

type Col = { key: string; label: string };
export interface ReportDef { title: string; description: string; usesPeriod: boolean; run: (from: string, to: string) => Promise<{ columns: Col[]; rows: any[] }> }

const c = (key: string, label: string): Col => ({ key, label });

export const REPORTS: Record<string, ReportDef> = {
  vendas_periodo: {
    title: "Vendas por período", description: "Pedidos com valores, descontos, recebimentos e status.", usesPeriod: true,
    run: async (from, to) => ({
      columns: [c("number", "Pedido"), c("date", "Data"), c("customer", "Cliente"), c("subtotal", "Bruto"), c("discount", "Desconto"), c("total", "Total"), c("paid", "Recebido conciliado"), c("status", "Status"), c("financial", "Financeiro"), c("modes", "Modalidade")],
      rows: await q(`select o.number, to_char(o.created_at,'YYYY-MM-DD') date, c.name customer, o.subtotal, o.discount_total discount, o.total,
          (select coalesce(sum(amount),0) from draum.payments p where p.order_id=o.id and p.status='conciliado') paid, o.status, o.financial_status financial,
          (select string_agg(distinct mode, '+') from draum.order_items i where i.order_id=o.id) modes
        from draum.orders o join draum.customers c on c.id=o.customer_id where o.created_at >= $1::date and o.created_at < $2::date + 1 order by o.created_at`, [from, to]),
    }),
  },
  vendas_produto: {
    title: "Vendas por produto", description: "Quantidade, receita e custo por SKU (pedidos não cancelados).", usesPeriod: true,
    run: async (from, to) => ({
      columns: [c("sku", "SKU"), c("name", "Produto"), c("qty", "Qtd"), c("net", "Receita líquida"), c("cost", "Custo"), c("margin", "Margem bruta"), c("margin_pct", "Margem %")],
      rows: await q(`select v.sku, p.name, sum(oi.qty) qty, sum(oi.total) net, sum(oi.qty*oi.unit_cost) cost, sum(oi.total - oi.qty*oi.unit_cost) margin,
          round(case when sum(oi.total)>0 then sum(oi.total - oi.qty*oi.unit_cost)/sum(oi.total)*100 end, 2) margin_pct
        from draum.order_items oi join draum.orders o on o.id=oi.order_id join draum.product_variants v on v.id=oi.variant_id join draum.products p on p.id=v.product_id
        where o.status<>'cancelado' and oi.status not in ('cancelado','trocado') and o.created_at >= $1::date and o.created_at < $2::date + 1
        group by v.sku, p.name order by qty desc`, [from, to]),
    }),
  },
  margens_produto: {
    title: "Margens por produto", description: "Preço, custo do fornecedor principal e margem bruta unitária de cada produto.", usesPeriod: false,
    run: async () => ({
      columns: [c("code", "Código"), c("name", "Produto"), c("sale_price", "Preço"), c("promo_price", "Preço promocional"), c("cost", "Custo + frete aquisição"), c("margin_pct", "Margem bruta %"), c("supplier", "Fornecedor principal")],
      rows: await q(`select p.code, p.name, p.sale_price, p.promo_price, (ps.unit_cost + ps.inbound_freight) cost,
          round(case when p.sale_price>0 and ps.unit_cost is not null then (p.sale_price - ps.unit_cost - ps.inbound_freight)/p.sale_price*100 end, 2) margin_pct, s.name supplier
        from draum.products p left join lateral (select * from draum.product_suppliers x where x.product_id=p.id order by is_primary desc limit 1) ps on true
        left join draum.suppliers s on s.id=ps.supplier_id order by p.name`),
    }),
  },
  estoque: {
    title: "Estoque disponível", description: "Físico, reservado, disponível, em trânsito e custo médio por SKU.", usesPeriod: false,
    run: async () => ({
      columns: [c("sku", "SKU"), c("name", "Produto"), c("color", "Cor"), c("size", "Tamanho"), c("qty_physical", "Físico"), c("qty_reserved", "Reservado"), c("qty_available", "Disponível"), c("qty_in_transit", "Em trânsito"), c("min_qty", "Mínimo"), c("avg_cost", "Custo médio"), c("location", "Localização")],
      rows: await listInventory(),
    }),
  },
  reposicao: {
    title: "Necessidade de reposição", description: "SKUs no ou abaixo do estoque mínimo e pré-vendas aguardando compra.", usesPeriod: false,
    run: async () => {
      const low = (await listInventory({ low: true })).map((r) => ({ origem: "estoque mínimo", sku: r.sku, name: r.name, qty: Math.max(r.min_qty - r.qty_available, 0) || 1, ref: `disponível ${r.qty_available} / mínimo ${r.min_qty}`, supplier: "" }));
      const needs = (await purchaseNeeds()).flatMap((g) => g.items.map((i: any) => ({ origem: "pré-venda", sku: i.sku, name: i.product_name, qty: i.qty, ref: `${i.order_number} · ${i.customer_name}`, supplier: g.supplier_name })));
      return { columns: [c("origem", "Origem"), c("sku", "SKU"), c("name", "Produto"), c("qty", "Qtd"), c("ref", "Referência"), c("supplier", "Fornecedor")], rows: [...needs, ...low] };
    },
  },
  pre_vendas: {
    title: "Pré-vendas pendentes", description: "Itens de pré-venda em aberto com prazos e risco.", usesPeriod: false,
    run: async () => ({
      columns: [c("order_number", "Pedido"), c("customer_name", "Cliente"), c("sku", "SKU"), c("qty", "Qtd"), c("supplier_name", "Fornecedor"), c("unit_cost", "Custo"), c("value_received", "Recebido"), c("reserved_for_purchase", "Reservado p/ compra"), c("status", "Status"), c("po_number", "Compra"), c("expected_arrival", "Previsão chegada"), c("customer_promised_date", "Prazo cliente"), c("risk", "Risco")],
      rows: (await listPresales({ status: "abertas" })).map((r) => ({ ...r, risk: r.risk.label })),
    }),
  },
  compras_fornecedor: {
    title: "Compras por fornecedor", description: "Ordens de compra com valores, pagamento e recebimento.", usesPeriod: true,
    run: async (from, to) => ({
      columns: [c("number", "Compra"), c("supplier", "Fornecedor"), c("status", "Status"), c("goods_total", "Mercadorias"), c("shipping_cost", "Frete"), c("ordered", "Enviada"), c("paid", "Paga"), c("expected_at", "Previsão"), c("tracking_code", "Rastreio")],
      rows: await q(`select po.number, s.name supplier, po.status, po.goods_total, po.shipping_cost, to_char(po.ordered_at,'YYYY-MM-DD') ordered,
          to_char(po.paid_at,'YYYY-MM-DD') paid, po.expected_at, po.tracking_code from draum.purchase_orders po join draum.suppliers s on s.id=po.supplier_id
          where po.created_at >= $1::date and po.created_at < $2::date + 1 order by s.name, po.created_at`, [from, to]),
    }),
  },
  clientes_vip: {
    title: "Clientes VIP", description: "Membros do DRAUM PRIVATE ACCESS com consentimentos e compras.", usesPeriod: false,
    run: async () => ({
      columns: [c("name", "Nome"), c("whatsapp", "WhatsApp"), c("instagram", "Instagram"), c("neighborhood", "Bairro"), c("vip_joined_at", "Entrada VIP"), c("funnel_stage", "Etapa"), c("orders", "Pedidos pagos"), c("spent", "Total comprado"), c("consent_whatsapp", "Consente WhatsApp"), c("consent_email", "Consente e-mail")],
      rows: await listCustomers({ vip: "sim" }),
    }),
  },
  conversao: {
    title: "Conversão comercial", description: "Funil: clientes que alcançaram cada etapa e conversão entre etapas.", usesPeriod: false,
    run: async () => {
      const m = await crmMetrics();
      return {
        columns: [c("label", "Etapa"), c("reached", "Alcançaram"), c("current", "Estão na etapa"), c("conv", "Conversão da etapa anterior %")],
        rows: m.funnel.map((f: any, i: number, arr: any[]) => ({ ...f, conv: i && arr[i - 1].reached ? Math.round((f.reached / arr[i - 1].reached) * 1000) / 10 : "" })),
      };
    },
  },
  despesas: {
    title: "Despesas", description: "Saídas de caixa por categoria.", usesPeriod: true,
    run: async (from, to) => ({
      columns: [c("occurred_on", "Data"), c("category", "Categoria"), c("description", "Descrição"), c("amount", "Valor"), c("reconciled", "Conciliado"), c("order_number", "Pedido"), c("po_number", "Compra")],
      rows: await listEntries({ from, to, direction: "saida" }),
    }),
  },
  fluxo_caixa: {
    title: "Fluxo de caixa", description: "Entradas e saídas efetivas com saldo acumulado (entradas só conciliadas).", usesPeriod: true,
    run: async (from, to) => {
      const rows = (await listEntries({ from, to })).reverse();
      let bal = 0;
      return {
        columns: [c("occurred_on", "Data"), c("direction", "Tipo"), c("category", "Categoria"), c("description", "Descrição"), c("amount", "Valor"), c("reconciled", "Conciliado"), c("balance", "Saldo acumulado (base conciliada)")],
        rows: rows.map((r) => { if (r.direction === "saida") bal -= Number(r.amount); else if (r.reconciled) bal += Number(r.amount); return { ...r, balance: Math.round(bal * 100) / 100 }; }),
      };
    },
  },
  entregas: {
    title: "Entregas", description: "Paradas do DRAUM DELIVERY DAY com status, comprovante e custo rateado.", usesPeriod: true,
    run: async (from, to) => ({
      columns: [c("route_date", "Rota"), c("number", "Pedido"), c("recipient", "Destinatário"), c("neighborhood", "Bairro"), c("status", "Status"), c("proof", "Comprovante"), c("occurrence", "Ocorrência"), c("allocated_cost", "Custo rateado"), c("driver", "Entregador")],
      rows: await q(`select r.route_date, o.number, ds.recipient, o.neighborhood, ds.status, ds.proof, ds.occurrence, ds.allocated_cost, r.driver
          from draum.delivery_stops ds join draum.delivery_routes r on r.id=ds.route_id join draum.orders o on o.id=ds.order_id
          where r.route_date between $1 and $2 order by r.route_date, ds.seq`, [from, to]),
    }),
  },
  campanhas: {
    title: "Campanhas e embaixadoras", description: "Resultados atribuídos (somente com rastreamento confiável).", usesPeriod: false,
    run: async () => {
      const camps = (await listCampaigns()).map((x) => ({ tipo: "Campanha", nome: x.name, status: x.status, custo: x.spent, leads: x.leads, pedidos: x.orders, receita: x.revenue, conversao: x.conversion ?? "", cac: x.cac ?? "", resultado: x.result }));
      const ambs = (await listAmbassadors()).map((a) => ({ tipo: "Embaixadora", nome: a.name, status: a.status, custo: a.pieces_cost, leads: "", pedidos: a.sales, receita: a.revenue, conversao: "", cac: "", resultado: Math.round((Number(a.revenue) - Number(a.pieces_cost)) * 100) / 100 }));
      return { columns: [c("tipo", "Tipo"), c("nome", "Nome"), c("status", "Status"), c("custo", "Custo"), c("leads", "Leads"), c("pedidos", "Pedidos"), c("receita", "Receita atribuída"), c("conversao", "Conversão %"), c("cac", "CAC"), c("resultado", "Resultado estimado")], rows: [...camps, ...ambs] };
    },
  },
};

export function toCsv(columns: Col[], rows: any[]) {
  const esc = (v: any) => {
    if (v == null) return "";
    if (v instanceof Date) v = v.toISOString();
    if (typeof v === "number") return String(v).replace(".", ",");
    if (typeof v === "boolean") return v ? "sim" : "não";
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" e BOM UTF-8: abre corretamente no Excel em português
  return "﻿" + [columns.map((c) => c.label).join(";"), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(";"))].join("\r\n");
}
