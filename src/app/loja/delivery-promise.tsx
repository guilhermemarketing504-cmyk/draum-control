"use client";
import { useEffect, useState } from "react";
import { Truck } from "lucide-react";

const longDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });

function left(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d > 0) return `${d} ${d === 1 ? "dia" : "dias"} e ${h} h`;
  if (h > 0) return `${h} h e ${min} min`;
  return `${min} min`;
}

/** Prazo de entrega no estilo "chega tal dia", com a contagem até o corte */
export function DeliveryPromise({ date, cutoffAt, mode }: { date: string | null; cutoffAt: string | null; mode?: "pronta" | "pre" | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!date) return null;
  const remaining = cutoffAt && now != null ? new Date(cutoffAt).getTime() - now : null;
  return (
    <div className="border border-line bg-paper px-4 py-3.5 flex gap-3 items-start">
      <Truck size={20} strokeWidth={1.4} className="text-ok shrink-0 mt-0.5" />
      <div className="space-y-0.5 text-[12.5px]">
        <p className="text-[14px] font-medium text-ok leading-snug">Chega grátis {longDay(date)}</p>
        {remaining != null && remaining > 0
          ? <p className="text-espresso">Comprando nas próximas <strong className="font-semibold text-mineral num">{left(remaining)}</strong></p>
          : <p className="text-espresso">Entrega em Belém</p>}
        {mode === "pre" && <p className="text-muted">Sob encomenda: pedimos a sua peça logo após o pagamento.</p>}
        {mode === "pronta" && <p className="text-muted">Pronta-entrega: separada assim que o pagamento for confirmado.</p>}
      </div>
    </div>
  );
}
