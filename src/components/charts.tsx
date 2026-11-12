"use client";
/* Gráficos minimalistas na paleta DRAUM.
   A paleta oficial é neutra (sem matiz), então séries diferentes são separadas por
   luminância (Preto Mineral × Stone, ΔE 42) E por codificação secundária: traço contínuo × tracejado,
   legenda sempre visível e tooltip com valores. Uma série = uma cor (Espresso). */
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

const INK = "#252624", STONE = "#A89C8B", ESPRESSO = "#584F49", GRID = "#E3DDD2", MUTED = "#7A7067";
const axis = { stroke: GRID, tick: { fill: MUTED, fontSize: 11, fontFamily: "Inter Variable, Inter, sans-serif" }, tickLine: false };
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = (s: any): string => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : String(s ?? ""));
const tooltipStyle = { contentStyle: { background: "#FBFAF6", border: `1px solid ${GRID}`, borderRadius: 2, fontSize: 12 }, labelStyle: { color: INK, fontWeight: 500 }, cursor: { stroke: STONE, strokeWidth: 1 } };

export function EmptyChart({ text = "Sem registros no período." }: { text?: string }) {
  return <div className="h-[220px] flex items-center justify-center text-[12.5px] text-muted border border-dashed border-line rounded">{text}</div>;
}

export function TwoLines({ data, x, a, b, money = true, height = 240 }: { data: any[]; x: string; a: { key: string; label: string }; b?: { key: string; label: string }; money?: boolean; height?: number }) {
  if (!data.length || data.every((d) => !d[a.key] && (!b || !d[b.key]))) return <EmptyChart />;
  const fmt = money ? brl : (n: number) => String(n);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={x} {...axis} tickFormatter={shortDate} minTickGap={24} />
        <YAxis {...axis} axisLine={false} tickFormatter={fmt} width={money ? 72 : 36} />
        <Tooltip {...tooltipStyle} labelFormatter={shortDate} formatter={(v: any) => (money ? brl2(v) : v)} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Line isAnimationActive={false} type="monotone" dataKey={a.key} name={a.label} stroke={INK} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#FBFAF6", strokeWidth: 2 }} />
        {b && <Line isAnimationActive={false} type="monotone" dataKey={b.key} name={b.label} stroke={STONE} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: "#FBFAF6", strokeWidth: 2 }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, y, label, money = false, horizontal = false, height = 240, pct = false }: { data: any[]; x: string; y: string; label: string; money?: boolean; horizontal?: boolean; height?: number; pct?: boolean }) {
  if (!data.length || data.every((d) => !d[y])) return <EmptyChart />;
  const fmt = (n: number) => (money ? brl(n) : pct ? `${n}%` : String(n));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap={horizontal ? 6 : "28%"}>
        <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? <>
          <XAxis type="number" {...axis} tickFormatter={fmt} />
          <YAxis type="category" dataKey={x} {...axis} width={130} axisLine={false} />
        </> : <>
          <XAxis dataKey={x} {...axis} tickFormatter={shortDate} />
          <YAxis {...axis} axisLine={false} tickFormatter={fmt} width={money ? 72 : 36} />
        </>}
        <Tooltip {...tooltipStyle} cursor={{ fill: "#F3F0E8" }} formatter={(v: any) => [money ? brl2(v) : pct ? `${v}%` : v, label]} labelFormatter={shortDate} />
        <Bar isAnimationActive={false} dataKey={y} name={label} fill={ESPRESSO} radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PairedBars({ data, x, a, b, height = 240 }: { data: any[]; x: string; a: { key: string; label: string }; b: { key: string; label: string }; height?: number }) {
  if (!data.length) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={x} {...axis} tickFormatter={shortDate} />
        <YAxis {...axis} axisLine={false} tickFormatter={brl} width={72} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "#F3F0E8" }} formatter={(v: any) => brl2(v)} labelFormatter={(l) => `Semana de ${shortDate(String(l))}`} />
        <Legend wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Bar isAnimationActive={false} dataKey={a.key} name={a.label} fill={INK} radius={[3, 3, 0, 0]} maxBarSize={22} />
        <Bar isAnimationActive={false} dataKey={b.key} name={b.label} fill={STONE} radius={[3, 3, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
