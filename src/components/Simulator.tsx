"use client";
import { useMemo, useState } from "react";
import { simulatePrice } from "@/lib/simulate";
import { Field } from "./forms";

const brl = (n: number) => (Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");

export function Simulator({ defaults }: { defaults: { feePct: number; taxPct: number; packaging: number; deliveryCost: number; targetMarginPct: number } }) {
  const [v, setV] = useState({ pieceCost: 60, inboundFreight: 0, discountPct: 0, currentPrice: 0, ...defaults });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const r = useMemo(() => { try { return { ok: true as const, ...simulatePrice({ ...v, currentPrice: v.currentPrice || undefined }) }; } catch (e: any) { return { ok: false as const, error: e.message }; } }, [v]);
  const below = r.ok && r.atCurrent && r.atCurrent.marginPct < v.targetMarginPct;
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Custo da peça (R$)"><input className="input" type="number" step="0.01" value={v.pieceCost} onChange={set("pieceCost")} /></Field>
        <Field label="Frete de aquisição (R$/peça)"><input className="input" type="number" step="0.01" value={v.inboundFreight} onChange={set("inboundFreight")} /></Field>
        <Field label="Embalagem (R$)"><input className="input" type="number" step="0.01" value={v.packaging} onChange={set("packaging")} /></Field>
        <Field label="Taxa de pagamento (%)"><input className="input" type="number" step="0.01" value={v.feePct} onChange={set("feePct")} /></Field>
        <Field label="Tributos (%)"><input className="input" type="number" step="0.01" value={v.taxPct} onChange={set("taxPct")} /></Field>
        <Field label="Entrega ao cliente (R$)"><input className="input" type="number" step="0.01" value={v.deliveryCost} onChange={set("deliveryCost")} /></Field>
        <Field label="Desconto (%)"><input className="input" type="number" step="0.1" value={v.discountPct} onChange={set("discountPct")} /></Field>
        <Field label="Margem desejada (%)"><input className="input" type="number" step="0.1" value={v.targetMarginPct} onChange={set("targetMarginPct")} /></Field>
        <Field label="Preço atual de tabela (R$)" hint="Opcional, para avaliar a promoção."><input className="input" type="number" step="0.01" value={v.currentPrice} onChange={set("currentPrice")} /></Field>
      </div>
      <div className="bg-offwhite border border-line rounded p-5 text-[13px] space-y-2 num">
        {!r.ok ? <p className="text-crit">{r.error}</p> : <>
          <div className="flex justify-between"><span className="text-muted">Custos fixos por peça</span><span>{brl(r.fixedCosts)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Preço líquido mínimo</span><span>{brl(r.minNetPrice)}</span></div>
          <div className="vao my-3" />
          <div className="label">Preço de tabela sugerido</div>
          <div className="font-display text-[26px]">{brl(r.suggestedListPrice)}</div>
          {r.atCurrent && <>
            <div className="vao my-3" />
            <div className="flex justify-between"><span className="text-muted">Margem no preço atual com {v.discountPct}% off</span><span className={below ? "text-crit font-medium" : "font-medium"}>{r.atCurrent.marginPct.toLocaleString("pt-BR")}%</span></div>
            <div className="flex justify-between"><span className="text-muted">Desconto máximo mantendo a meta</span><span>{r.maxDiscountAtCurrentPct?.toLocaleString("pt-BR")}%</span></div>
            {below && <p className="text-crit text-[12px]">Esta promoção deixa a margem abaixo da meta. No pedido, exigirá aprovação de administrador.</p>}
          </>}
        </>}
      </div>
    </div>
  );
}
