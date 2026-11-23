"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Minus, Plus, X, MessageCircle } from "lucide-react";
import { useBag, writeBag, type BagItem } from "../bag";
import { cartAction, checkoutAction } from "../actions";

type Line = { variantId: number; name: string; slug: string; color: string; size: string; image: string | null; mode: "pronta" | "pre" | null; unitPrice: number; qty: number; maxQty: number };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const longDay = (iso: string | null) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }) : "";

function newKey() {
  try { return crypto.randomUUID(); } catch { return `k${Date.now()}${Math.random().toString(36).slice(2)}`; }
}

export function Bag() {
  const bag = useBag();
  const [data, setData] = useState<{ lines: Line[]; deliveryDate: string | null; cutoff: string; whatsappReady: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: string; whatsappUrl: string; total: number; deliveryDate: string } | null>(null);
  const [fulfillment, setFulfillment] = useState<"entrega_local" | "retirada">("entrega_local");
  const key = useRef<string>("");

  useEffect(() => {
    if (bag == null) return;
    cartAction(bag).then((d) => setData(d as any));
  }, [bag]);

  const lines = data?.lines ?? [];
  const total = useMemo(() => lines.reduce((a, l) => a + l.unitPrice * l.qty, 0), [lines]);
  const hasPre = lines.some((l) => l.mode === "pre");
  const unavailable = lines.filter((l) => !l.mode || l.qty < 1);

  function setQty(id: number, qty: number) {
    const next: BagItem[] = (bag ?? []).map((i) => (i.variantId === id ? { ...i, qty } : i)).filter((i) => i.qty > 0);
    writeBag(next);
  }

  function submit(fd: FormData) {
    setError(null);
    if (!key.current) key.current = newKey();
    const payload = {
      items: lines.filter((l) => l.mode && l.qty > 0).map((l) => ({ variantId: l.variantId, qty: l.qty })),
      name: String(fd.get("name") ?? ""), whatsapp: String(fd.get("whatsapp") ?? ""),
      fulfillment, neighborhood: String(fd.get("neighborhood") ?? "") || null, address: String(fd.get("address") ?? "") || null,
      notes: String(fd.get("notes") ?? "") || null, acceptPre: fd.get("acceptPre") === "on", idempotencyKey: key.current,
    };
    start(async () => {
      const r = await checkoutAction(payload);
      if (!r.ok) { setError(r.error); return; }
      setDone(r);
      writeBag([]);
      key.current = "";
      window.location.href = r.whatsappUrl;
    });
  }

  if (done) {
    return (
      <div className="max-w-[560px] border border-line bg-paper p-8 space-y-5">
        <div className="label">Pedido {done.number}</div>
        <h2 className="font-display text-[26px] leading-tight">Recebemos seu pedido.</h2>
        <p className="text-[13.5px] text-espresso">
          Agora é só enviar a mensagem no WhatsApp para combinarmos o pagamento (Pix ou cartão). Assim que o pagamento for confirmado, sua entrega fica marcada para {longDay(done.deliveryDate)}.
        </p>
        <a href={done.whatsappUrl} className="inline-flex items-center justify-center gap-2 h-12 px-6 bg-mineral text-offwhite text-[13.5px] w-full sm:w-auto">
          <MessageCircle size={17} strokeWidth={1.5} /> Abrir o WhatsApp
        </a>
        <p className="text-[12px] text-muted">Total {brl(done.total)}. Se o WhatsApp não abriu sozinho, use o botão acima.</p>
      </div>
    );
  }

  if (bag == null || data == null) return <div className="py-20 text-center label">Carregando sacola…</div>;

  if (!bag.length) {
    return (
      <div className="py-16 text-center space-y-4">
        <p className="font-display text-[22px]">Sua sacola está vazia.</p>
        <Link href="/loja" className="inline-flex h-11 px-6 items-center bg-mineral text-offwhite text-[13px]">Ver as peças</Link>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1.35fr_1fr] gap-10 lg:gap-14">
      <div>
        <ul className="divide-y divide-line border-y border-line">
          {lines.map((l) => (
            <li key={l.variantId} className="py-5 flex gap-4">
              <Link href={`/loja/${l.slug}`} className="shrink-0 w-[84px] aspect-[3/4] bg-sand/50 overflow-hidden">
                {l.image && <img src={l.image} alt="" className="w-full h-full object-cover" />}
              </Link>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex justify-between gap-3">
                  <Link href={`/loja/${l.slug}`} className="text-[13.5px] leading-snug hover:underline underline-offset-4">{l.name}</Link>
                  <button onClick={() => setQty(l.variantId, 0)} aria-label="Remover" className="text-muted hover:text-mineral"><X size={16} strokeWidth={1.4} /></button>
                </div>
                <div className="text-[12px] text-muted">{l.color} · {l.size}</div>
                <div className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-espresso">
                  {l.mode === "pronta" ? "Pronta-entrega" : l.mode === "pre" ? "Sob encomenda" : <span className="text-crit">Indisponível — remova da sacola</span>}
                </div>
                <div className="flex items-center justify-between pt-1">
                  {l.mode ? (
                    <div className="inline-flex items-center border border-line">
                      <button className="w-8 h-8 flex items-center justify-center disabled:opacity-30" disabled={l.qty <= 1} onClick={() => setQty(l.variantId, l.qty - 1)} aria-label="Diminuir"><Minus size={13} /></button>
                      <span className="w-8 text-center text-[13px] num">{l.qty}</span>
                      <button className="w-8 h-8 flex items-center justify-center disabled:opacity-30" disabled={l.qty >= l.maxQty} onClick={() => setQty(l.variantId, l.qty + 1)} aria-label="Aumentar"><Plus size={13} /></button>
                    </div>
                  ) : <span />}
                  <span className="text-[13.5px] num">{brl(l.unitPrice * l.qty)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-between items-baseline pt-5">
          <span className="label">Total</span>
          <span className="text-[20px] num">{brl(total)}</span>
        </div>
        <p className="text-[12.5px] text-espresso mt-3">
          Entrega gratuita em Belém na <strong className="font-medium text-mineral">{longDay(data.deliveryDate)}</strong>, para pedidos confirmados até {data.cutoff}.
        </p>
      </div>

      <form action={submit} className="space-y-5 lg:sticky lg:top-24 self-start border border-line bg-paper p-6">
        <div className="label">Seus dados</div>
        <label className="field"><span>Nome completo</span><input className="input h-11" name="name" required minLength={3} autoComplete="name" /></label>
        <label className="field"><span>WhatsApp com DDD</span><input className="input h-11" name="whatsapp" required inputMode="tel" placeholder="(91) 9 0000-0000" autoComplete="tel" /></label>
        <div className="field">
          <span>Como prefere receber</span>
          <div className="grid grid-cols-2 gap-2">
            {([["entrega_local", "Entrega grátis"], ["retirada", "Retirar com a DRAUM"]] as const).map(([k, l]) => (
              <button type="button" key={k} onClick={() => setFulfillment(k)}
                className={`h-11 border text-[12.5px] ${fulfillment === k ? "border-mineral bg-mineral text-offwhite" : "border-line bg-white/70"}`}>{l}</button>
            ))}
          </div>
        </div>
        {fulfillment === "entrega_local" && (
          <>
            <label className="field"><span>Bairro (Belém)</span><input className="input h-11" name="neighborhood" required /></label>
            <label className="field"><span>Endereço</span><input className="input h-11" name="address" required placeholder="Rua, número, complemento" autoComplete="street-address" /></label>
          </>
        )}
        <label className="field"><span>Observação (opcional)</span><textarea className="input" name="notes" rows={2} maxLength={500} /></label>
        {hasPre && (
          <label className="flex gap-3 items-start text-[12.5px] text-espresso">
            <input type="checkbox" name="acceptPre" required className="mt-1 accent-mineral" />
            <span>Entendo que as peças <strong className="font-medium text-mineral">sob encomenda</strong> são encomendadas após a confirmação do pagamento e chegam na {longDay(data.deliveryDate)}.</span>
          </label>
        )}
        {error && <div className="border border-crit/30 bg-crit/5 text-crit text-[12.5px] px-3 py-2">{error}</div>}
        {!data.whatsappReady && <div className="border border-warn/30 bg-warn/5 text-warn text-[12.5px] px-3 py-2">A loja ainda está sendo configurada e não está recebendo pedidos.</div>}
        <button disabled={pending || !lines.length || unavailable.length > 0 || !data.whatsappReady}
          className="w-full h-12 bg-mineral text-offwhite text-[13.5px] inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <MessageCircle size={17} strokeWidth={1.5} /> {pending ? "Enviando…" : "Finalizar pelo WhatsApp"}
        </button>
        <p className="text-[11.5px] text-muted">Você será levada ao WhatsApp da DRAUM com o resumo do pedido para combinar o pagamento (Pix ou cartão). Seus dados são usados apenas para este pedido e para falarmos com você.</p>
      </form>
    </div>
  );
}
