"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { addToBag } from "../bag";

interface V { id: number; color: string; hex: string | null; size: string; mode: "pronta" | "pre"; available: number }
interface Img { src: string; color: string | null }

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const longDay = (iso: string | null) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }) : "";

export function Buy({ product, variants, images, deliveryDate, cutoff }: {
  product: { name: string; price: number; promoPrice: number | null; description: string | null };
  variants: V[]; images: Img[]; deliveryDate: string | null; cutoff: string;
}) {
  const colors = useMemo(() => {
    const m = new Map<string, { name: string; hex: string | null; pronta: boolean }>();
    for (const v of variants) {
      const c = m.get(v.color) ?? { name: v.color, hex: v.hex, pronta: false };
      c.pronta ||= v.mode === "pronta";
      m.set(v.color, c);
    }
    return [...m.values()].sort((a, b) => Number(b.pronta) - Number(a.pronta));
  }, [variants]);
  const [color, setColor] = useState(colors[0]?.name ?? "");
  const [size, setSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [active, setActive] = useState(0);

  const sizes = variants.filter((v) => v.color === color);
  const chosen = sizes.find((v) => v.size === size) ?? null;
  const gallery = useMemo(() => {
    const own = images.filter((i) => i.color === color);
    const shared = images.filter((i) => !i.color);
    const list = own.length ? [...own, ...shared] : images;
    return list.length ? list : [];
  }, [images, color]);
  const price = product.promoPrice ?? product.price;

  function pickColor(c: string) { setColor(c); setActive(0); setAdded(false); if (!variants.some((v) => v.color === c && v.size === size)) setSize(null); }
  function add() { if (!chosen) return; addToBag(chosen.id, 1); setAdded(true); }

  return (
    <div className="grid lg:grid-cols-[1.25fr_1fr] gap-8 lg:gap-14">
      {/* Galeria */}
      <div className="space-y-3">
        <div className="relative aspect-[3/4] bg-sand/50 overflow-hidden">
          {gallery[active] && <img src={gallery[active].src} alt={`${product.name} — ${color}`} className="absolute inset-0 w-full h-full object-cover" />}
        </div>
        {gallery.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {gallery.map((g, i) => (
              <button key={g.src} onClick={() => setActive(i)} aria-label={`Foto ${i + 1}`}
                className={`shrink-0 w-[68px] aspect-[3/4] overflow-hidden border ${i === active ? "border-mineral" : "border-transparent opacity-70 hover:opacity-100"}`}>
                <img src={g.src} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compra */}
      <div className="lg:sticky lg:top-24 self-start space-y-7">
        <div>
          <h1 className="font-display text-[28px] sm:text-[34px] leading-[1.08]">{product.name}</h1>
          <div className="mt-3 flex items-baseline gap-3 num">
            {product.promoPrice != null && <span className="text-muted line-through text-[14px]">{brl(product.price)}</span>}
            <span className="text-[20px]">{brl(price)}</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="label">Cor · <span className="text-mineral normal-case tracking-normal font-sans text-[12.5px]">{color}</span></div>
          <div className="flex flex-wrap gap-2.5">
            {colors.map((c) => (
              <button key={c.name} onClick={() => pickColor(c.name)} title={c.name} aria-label={c.name} aria-pressed={c.name === color}
                className={`w-9 h-9 rounded-full p-[3px] border ${c.name === color ? "border-mineral" : "border-line hover:border-stone"}`}>
                <span className="block w-full h-full rounded-full ring-1 ring-black/5" style={{ background: c.hex ?? "#A89C8B" }} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="label">Tamanho</div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((v) => (
              <button key={v.id} onClick={() => { setSize(v.size); setAdded(false); }} aria-pressed={v.size === size}
                className={`min-w-[52px] h-11 px-3 border text-[13px] ${v.size === size ? "bg-mineral text-offwhite border-mineral" : "border-line bg-paper hover:border-stone"}`}>
                {v.size}
              </button>
            ))}
          </div>
          {chosen && (
            <p className="text-[12.5px] text-espresso">
              {chosen.mode === "pronta"
                ? chosen.available === 1 ? "Última unidade a pronta-entrega." : "Pronta-entrega: já está com a gente."
                : "Sob encomenda: encomendamos a sua peça logo após o pagamento."}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <button onClick={add} disabled={!chosen} className="w-full h-12 bg-mineral text-offwhite text-[13.5px] tracking-wide hover:bg-grafite disabled:opacity-40 disabled:cursor-not-allowed">
            {chosen ? "Adicionar à sacola" : "Escolha cor e tamanho"}
          </button>
          {added && (
            <div className="flex items-center justify-between gap-3 border border-line bg-paper px-4 py-3 text-[13px]">
              <span className="flex items-center gap-2"><Check size={15} strokeWidth={1.6} /> Adicionado à sacola</span>
              <Link href="/loja/sacola" className="link">Ver sacola</Link>
            </div>
          )}
        </div>

        <div className="border-t border-line pt-5 space-y-1.5 text-[12.5px] text-espresso">
          <p><span className="text-mineral">Entrega gratuita em Belém</span> na {longDay(deliveryDate)}.</p>
          <p className="text-muted">Pedidos confirmados até {cutoff}. Depois disso, a entrega passa para a terça seguinte.</p>
        </div>

        {product.description && (
          <details open className="border-t border-line pt-5 group">
            <summary className="label cursor-pointer list-none">Sobre a peça</summary>
            <div className="mt-3 text-[13px] leading-relaxed text-espresso whitespace-pre-line">{product.description}</div>
          </details>
        )}
      </div>
    </div>
  );
}
