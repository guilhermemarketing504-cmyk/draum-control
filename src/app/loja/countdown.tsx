"use client";
import { useEffect, useState } from "react";

/** Contagem regressiva até o início das ofertas. `serverNow` corrige o relógio (e simula a data na prévia). */
export function Countdown({ to, serverNow, label }: { to: string; serverNow: string; label: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const skew = new Date(serverNow).getTime() - Date.now();
    const tick = () => setLeft(Math.max(0, new Date(to).getTime() - (Date.now() + skew)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [to, serverNow]);
  if (left === 0) return null;
  const s = Math.floor((left ?? 0) / 1000);
  const parts: [number, string][] = [[Math.floor(s / 86400), "dias"], [Math.floor(s / 3600) % 24, "horas"], [Math.floor(s / 60) % 60, "min"], [s % 60, "seg"]];
  const shown = parts[0][0] > 0 ? parts : parts.slice(1);
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase opacity-60 mb-3">{label}</div>
      <div className="flex items-start gap-2 sm:gap-3" aria-live="off">
        {shown.map(([v, l], i) => (
          <div key={l} className="flex items-start gap-2 sm:gap-3">
            {i > 0 && <span className="bf-giant text-[34px] sm:text-[52px] leading-none opacity-40">:</span>}
            <div className="text-center">
              <div className="bf-giant text-[40px] sm:text-[60px] leading-none tabular-nums min-w-[1.25em]">{left == null ? "--" : String(v).padStart(2, "0")}</div>
              <div className="font-mono text-[9.5px] tracking-[0.16em] uppercase opacity-60 mt-1.5">{l}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
