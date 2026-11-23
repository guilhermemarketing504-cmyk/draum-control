import Link from "next/link";
import { listStoreProducts, storePromotions, activePromo, type StoreCard, type StorePromo } from "@/server/store";
import { vipFromCookie } from "./vip";
import { LeadForm } from "./lead-form";
import { getSettings } from "@/server/core";
import { storeDeliveryDate } from "@/server/store";
import { CATEGORIES } from "@/server/products";
import { brl } from "@/lib/format";

export const dynamic = "force-dynamic";

const dayMonth = (iso: string | null) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }) : "";

export default async function Loja({ searchParams }: { searchParams: Promise<{ tipo?: string; cat?: string }> }) {
  const sp = await searchParams;
  const tipo = sp.tipo === "pronta" || sp.tipo === "encomenda" ? sp.tipo : "todos";
  const isVip = await vipFromCookie();
  const [all, s, promos] = await Promise.all([listStoreProducts(isVip), getSettings(), storePromotions()]);
  const delivery = dayMonth(storeDeliveryDate(new Date(), s));
  const hero = heroCopy(promos, isVip);
  const byType = all.filter((p) => tipo === "todos" || (tipo === "pronta" ? p.hasPronta : p.hasPre && !p.hasPronta));
  const cats = [...new Set(byType.map((p) => p.category))];
  const cat = sp.cat && cats.includes(sp.cat) ? sp.cat : null;
  const list = cat ? byType.filter((p) => p.category === cat) : byType;
  const pronta = list.filter((p) => p.hasPronta);
  const encomenda = list.filter((p) => !p.hasPronta);
  const href = (t: string, c?: string | null) => `/loja?${new URLSearchParams({ ...(t !== "todos" ? { tipo: t } : {}), ...(c ? { cat: c } : {}) })}`;

  return (
    <div>
      <Hero hero={hero} delivery={delivery} whatsapp={s.store.whatsapp} />

      <div className="sticky top-[93px] md:top-16 z-20 bg-offwhite/95 backdrop-blur border-y border-line">
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex gap-1">
            {[["todos", "Tudo"], ["pronta", "Pronta-entrega"], ["encomenda", "Sob encomenda"]].map(([k, l]) => (
              <Link key={k} href={href(k)} className={`h-8 px-3.5 inline-flex items-center rounded-sm text-[12.5px] border ${tipo === k ? "bg-mineral text-offwhite border-mineral" : "border-line hover:border-stone"}`}>{l}</Link>
            ))}
          </div>
          {cats.length > 1 && (
            <div className="flex gap-4 overflow-x-auto text-[12.5px] -mx-1 px-1">
              <Link href={href(tipo)} className={!cat ? "text-mineral underline underline-offset-4 decoration-stone" : "text-muted hover:text-mineral"}>Todas</Link>
              {cats.map((c) => (
                <Link key={c} href={href(tipo, c)} className={`whitespace-nowrap ${cat === c ? "text-mineral underline underline-offset-4 decoration-stone" : "text-muted hover:text-mineral"}`}>{CATEGORIES[c]?.label ?? c}</Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-[1240px] mx-auto px-5 sm:px-8">
        {!list.length && (
          <div className="py-24 text-center text-espresso">
            <p className="font-display text-[22px]">Novidades chegando.</p>
            <p className="mt-2 text-[13px] text-muted">Nenhuma peça disponível nesta seleção agora.</p>
          </div>
        )}
        {pronta.length > 0 && (
          <Shelf title="Pronta-entrega" note="Já está com a gente." items={pronta} delivery={delivery} />
        )}
        {encomenda.length > 0 && (
          <Shelf title="Sob encomenda" note={`Peça agora, receba na terça ${delivery}.`} items={encomenda} delivery={delivery} />
        )}
      </div>

      {!isVip && (
        <section className="max-w-[1240px] mx-auto px-5 sm:px-8 mt-20">
          <div className="border border-line bg-paper p-6 sm:p-10 grid lg:grid-cols-[1fr_1.4fr] gap-8 items-center">
            <div>
              <div className="label mb-3">Lista DRAUM</div>
              <h2 className="font-display text-[24px] sm:text-[28px] leading-tight">Seja a primeira a saber.</h2>
              <p className="text-[13px] text-espresso mt-2">Lançamentos, reposições e ofertas antes de todo mundo, no seu WhatsApp.</p>
            </div>
            <LeadForm mode="news" />
          </div>
        </section>
      )}
    </div>
  );
}

function Shelf({ title, note, items, delivery }: { title: string; note: string; items: StoreCard[]; delivery: string }) {
  return (
    <section className="pt-12">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display text-[24px] sm:text-[28px]">{title}</h2>
          <p className="text-[12.5px] text-muted mt-1 max-w-[520px]">{note}</p>
        </div>
        <span className="label">{items.length} {items.length === 1 ? "peça" : "peças"}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-10">
        {items.map((p) => <Card key={p.id} p={p} delivery={delivery} />)}
      </div>
    </section>
  );
}

function Card({ p, delivery }: { p: StoreCard; delivery: string }) {
  const price = p.promoPrice ?? p.price;
  const off = p.promoPct ?? (p.promoPrice != null && p.price > 0 ? Math.round((1 - p.promoPrice / p.price) * 100) : null);
  return (
    <Link href={`/loja/${p.slug}`} className="group block">
      <div className="relative aspect-[3/4] bg-sand/50 overflow-hidden">
        {p.image
          ? <img src={p.image} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
          : <div className="absolute inset-0 flex items-center justify-center label">DRAUM</div>}
        {off != null && off > 0 && (
          <div className="absolute left-0 bottom-0 bg-mineral text-offwhite px-2.5 py-2 text-center leading-none">
            <div className="bf-giant text-[22px] sm:text-[26px]">-{off}%</div>
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {p.unique && <span className="bg-mineral text-offwhite font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">Peça única</span>}
          {p.hasPronta && !p.unique && <span className="bg-offwhite/95 text-mineral font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">Pronta-entrega</span>}
          {!p.hasPronta && <span className="bg-offwhite/95 text-espresso font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">Sob encomenda</span>}
        </div>
      </div>
      <div className="pt-3 space-y-1">
        <div className="text-[13.5px] leading-snug group-hover:underline underline-offset-4 decoration-stone">{p.name}</div>
        {off != null && off > 0 ? (
          <div>
            <div className="text-[11.5px] text-muted line-through num">{brl(p.price)}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] sm:text-[19px] font-semibold num tracking-tight">{brl(price)}</span>
              <span className="text-[11px] font-semibold text-ok num">{off}% OFF</span>
            </div>
          </div>
        ) : <div className="text-[15px] num">{brl(price)}</div>}
        <div className="text-[11.5px] text-ok">Chega grátis terça {delivery}</div>
        <div className="flex items-center gap-2 pt-0.5">
          <div className="flex -space-x-0.5">
            {p.colors.slice(0, 6).map((c) => (
              <span key={c.name} title={c.name} className="w-3 h-3 rounded-full border border-offwhite ring-1 ring-line" style={{ background: c.hex ?? "#A89C8B" }} />
            ))}
          </div>
          {p.colors.length > 6 && <span className="text-[11px] text-muted">+{p.colors.length - 6}</span>}
          <span className="text-[11px] text-muted ml-auto">{p.sizes.join(" · ")}</span>
        </div>
      </div>
    </Link>
  );
}

const fmtDay = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Belem" });
const lastDay = (p: StorePromo) => fmtDay(new Date(p.endsAt.getTime() - 60_000));

interface HeroCopy { kind: "bf" | "vip" | "normal"; eyebrow: string; giant?: [string, string]; title?: string; text: string; pitch?: string }

/** Abertura da loja: lançamento + Black Friday, conforme a fase da campanha e quem está vendo (grupo VIP ou público) */
function heroCopy(promos: StorePromo[], isVip: boolean, now = new Date()): HeroCopy {
  const vip = promos.find((p) => p.requiresVip);
  const pub = promos.find((p) => !p.requiresVip);
  if (isVip && vip && now <= vip.endsAt) {
    if (now < vip.startsAt)
      return { kind: "vip", eyebrow: "DRAUM Private Access", giant: ["Acesso", "garantido"],
        text: `Os seus ${vip.pct}% OFF liberam em ${fmtDay(vip.startsAt)}, antes de todo mundo. Volte por este mesmo celular.` };
    return { kind: "vip", eyebrow: `DRAUM Private Access · até ${lastDay(vip)}`, giant: ["Acesso", "antecipado"],
      text: `${vip.pct}% OFF em tudo até ${lastDay(vip)}. ${pub ? "O dobro de quem está fora do grupo." : "Exclusivo do grupo."}` };
  }
  if (pub && now <= pub.endsAt) {
    const live = now >= pub.startsAt;
    const pitch = vip && now <= vip.endsAt ? `No DRAUM Private Access é ${vip.pct}% OFF${now < vip.startsAt ? `, a partir de ${fmtDay(vip.startsAt)}` : ""}.` : undefined;
    return { kind: "bf", eyebrow: live ? `Black Friday DRAUM · até ${lastDay(pub)}` : "Lançamento · Black Friday DRAUM", giant: ["Black", "Friday"],
      text: live ? `${pub.pct}% OFF em todas as peças até ${lastDay(pub)}.`
        : `A DRAUM chegou. ${pub.pct}% OFF em tudo, de ${fmtDay(pub.startsAt)} a ${lastDay(pub)}.`,
      pitch };
  }
  return { kind: "normal", eyebrow: "Coleção · Belém", title: "Movimento com presença, do treino ao fim de semana.", text: "Peças a pronta-entrega e uma seleção sob encomenda." };
}

function Hero({ hero, delivery, whatsapp }: { hero: HeroCopy; delivery: string; whatsapp: string }) {
  const deliveryLine = <>Entrega grátis em Belém toda terça.</>;
  if (hero.kind === "normal") {
    return (
      <section className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-12 sm:pt-16 pb-8">
        <div className="label mb-4">{hero.eyebrow}</div>
        <h1 className="font-display text-[34px] sm:text-[52px] leading-[1.02] max-w-[820px]">{hero.title}</h1>
        <div className="vao max-w-[420px] mt-8" />
        <p className="mt-6 text-[14px] text-espresso max-w-[600px]">{hero.text}</p>
      </section>
    );
  }
  const join = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent("Quero entrar no DRAUM PRIVATE ACCESS")}` : null;
  return (
    <section className="bf-band overflow-hidden">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-10 sm:pb-14">
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase opacity-60 mb-6">{hero.eyebrow}</div>
        <h1 className={`bf-giant ${Math.max(...hero.giant!.map((w) => w.length)) > 7 ? "text-[10.5vw] lg:text-[124px]" : "text-[19vw] sm:text-[15vw] lg:text-[176px]"}`}>
          <span className="block">{hero.giant![0]}</span>
          <span className="block">{hero.giant![1]}</span>
        </h1>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr] items-end">
          <div className="space-y-3">
            <p className="text-[17px] sm:text-[19px] leading-snug max-w-[560px]">{hero.text}</p>
            <p className="text-[12.5px] opacity-60 max-w-[520px]">{deliveryLine}</p>
          </div>
          {hero.kind === "bf" && hero.pitch && (
            <div className="border border-current/30 p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between" style={{ borderColor: "rgba(243,240,232,.25)" }}>
              <p className="text-[13.5px] leading-snug"><span className="font-mono text-[10px] tracking-[0.16em] uppercase opacity-60 block mb-1">Quer mais?</span>{hero.pitch}</p>
              {join && <a href={join} className="shrink-0 h-11 px-5 inline-flex items-center justify-center text-[12.5px] tracking-wide" style={{ background: "#F3F0E8", color: "#111210" }}>Quero entrar no grupo</a>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
