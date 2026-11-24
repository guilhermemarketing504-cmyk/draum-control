"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Vitrine horizontal: arrasta no celular, setas no computador, avança sozinha e pausa quando a cliente mexe */
export function Carousel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const step = (dir: 1 | -1) => {
    const el = ref.current; if (!el) return;
    const slide = el.querySelector<HTMLElement>("[data-slide]");
    const w = slide ? slide.offsetWidth + 16 : el.clientWidth * 0.8;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
    else el.scrollBy({ left: dir * w, behavior: "smooth" });
  };
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => step(1), 3800);
    return () => clearInterval(t);
  }, [paused]);
  return (
    <div className="relative group/car" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onTouchStart={() => setPaused(true)}>
      <div ref={ref} className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth px-5 sm:px-8 lg:px-[max(2rem,calc((100vw-1240px)/2+2rem))] pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
        <div className="shrink-0 w-1" />
      </div>
      <button type="button" aria-label="Anterior" onClick={() => step(-1)} className="hidden md:flex absolute left-4 top-[38%] w-11 h-11 items-center justify-center bg-offwhite/95 border border-line shadow-sm opacity-0 group-hover/car:opacity-100 transition"><ChevronLeft className="w-5 h-5" /></button>
      <button type="button" aria-label="Próximo" onClick={() => step(1)} className="hidden md:flex absolute right-4 top-[38%] w-11 h-11 items-center justify-center bg-offwhite/95 border border-line shadow-sm opacity-0 group-hover/car:opacity-100 transition"><ChevronRight className="w-5 h-5" /></button>
    </div>
  );
}
