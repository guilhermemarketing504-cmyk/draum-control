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
      <section className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-12 sm:pt-16 pb-8">
        <div className="label mb-4">{hero.eyebrow}</div>
        <h1 className="font-display text-[34px] sm:text-[52px] leading-[1.02] max-w-[820px]">{hero.title}</h1>
        <div className="vao max-w-[420px] mt-8" />
        <p className="mt-6 text-[14px] text-espresso max-w-[600px]">
          {hero.text} Pedidos confirmados até sexta, 12h, chegam na <strong className="font-medium text-mineral">terça {delivery}</strong>, com entrega gratuita em Belém.
        </p>
      </section>

      <div className="sticky top-16 md:top-16 z-20 bg-offwhite/95 backdrop-blur border-y border-line">
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
          <Shelf title="Pronta-entrega" note="Já está com a gente. Separamos assim que o pagamento for confirmado." items={pronta} delivery={delivery} />
        )}
        {encomenda.length > 0 && (
          <Shelf title="Sob encomenda" note={`Peça agora e receba na terça ${delivery}. Encomendamos a sua peça logo após o pagamento.`} items={encomenda} delivery={delivery} />
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
  return (
    <Link href={`/loja/${p.slug}`} className="group block">
      <div className="relative aspect-[3/4] bg-sand/50 overflow-hidden">
        {p.image
          ? <img src={p.image} alt={p.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
          : <div className="absolute inset-0 flex items-center justify-center label">DRAUM</div>}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {p.promoPct != null && <span className="bg-mineral text-offwhite font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">{p.promoPct}% OFF</span>}
          {p.unique && <span className="bg-mineral text-offwhite font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">Peça única</span>}
          {p.hasPronta && !p.unique && <span className="bg-offwhite/95 text-mineral font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">Pronta-entrega</span>}
          {!p.hasPronta && <span className="bg-offwhite/95 text-espresso font-mono text-[9.5px] tracking-[0.12em] uppercase px-2 py-1">Encomenda · terça {delivery}</span>}
        </div>
      </div>
      <div className="pt-3 space-y-1">
        <div className="text-[13.5px] leading-snug group-hover:underline underline-offset-4 decoration-stone">{p.name}</div>
        <div className="flex items-center gap-2 text-[13px] num">
          {p.promoPrice != null && <span className="text-muted line-through">{brl(p.price)}</span>}
          <span>{brl(price)}</span>
        </div>
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

/** Texto de abertura: lançamento da loja + Black Friday, conforme a fase da campanha */
function heroCopy(promos: StorePromo[], isVip: boolean, now = new Date()) {
  const vip = promos.find((p) => p.requiresVip);
  const pub = promos.find((p) => !p.requiresVip);
  const active = activePromo(promos, isVip, now);
  if (active && active.requiresVip)
    return { eyebrow: "DRAUM Private Access · acesso antecipado", title: "Seu acesso antecipado está liberado.",
      text: `${active.pct}% OFF em todas as peças até ${lastDay(active)}, antes de a Black Friday abrir para todo mundo.` };
  if (active)
    return { eyebrow: `Black Friday DRAUM · até ${lastDay(active)}`, title: `Nossa primeira Black Friday. ${active.pct}% OFF em tudo.`,
      text: "Toda a loja com desconto, da pronta-entrega às peças sob encomenda." };
  if (pub && now < pub.startsAt)
    return { eyebrow: "Lançamento · Black Friday DRAUM", title: "A DRAUM chegou. E chega em movimento.",
      text: `Nossa loja abre com a primeira Black Friday da marca: ${pub.pct}% OFF em todas as peças de ${fmtDay(pub.startsAt)} a ${lastDay(pub)}.`
        + (vip && now < vip.endsAt ? ` Quem está no DRAUM Private Access compra antes, de ${fmtDay(vip.startsAt)} a ${lastDay(vip)}.` : "") };
  return { eyebrow: "Coleção · Belém", title: "Movimento com presença, do treino ao fim de semana.", text: "Peças a pronta-entrega e uma seleção sob encomenda." };
}
