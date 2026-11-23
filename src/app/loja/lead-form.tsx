"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leadAction, vipAccessAction } from "./actions";

/** Cadastro de clientes: lista de novidades (home) ou acesso antecipado (link do grupo VIP) */
export function LeadForm({ mode, code, dark = false }: { mode: "news" | "vip"; code?: string; dark?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();
  const input = `input h-11 ${dark ? "!bg-grafite !border-grafite !text-offwhite placeholder:!text-stone" : ""}`;

  function submit(fd: FormData) {
    setError(null);
    const data = { name: String(fd.get("name") ?? ""), whatsapp: String(fd.get("whatsapp") ?? ""), email: String(fd.get("email") ?? "") || null, consent: fd.get("consent") === "on" };
    start(async () => {
      const r = mode === "vip" ? await vipAccessAction(code ?? "", data) : await leadAction(data);
      if (!r.ok) { setError(r.error); return; }
      if (mode === "vip") { router.push("/loja"); router.refresh(); } else setDone(true);
    });
  }

  if (done) return <p className={`text-[13.5px] ${dark ? "text-sand" : "text-espresso"}`}>Pronto! Você vai receber as novidades e ofertas da DRAUM em primeira mão.</p>;

  return (
    <form action={submit} className="grid gap-3 sm:grid-cols-3">
      <input className={input} name="name" required minLength={2} placeholder="Seu nome" autoComplete="name" aria-label="Nome" />
      <input className={input} name="whatsapp" required inputMode="tel" placeholder="WhatsApp com DDD" autoComplete="tel" aria-label="WhatsApp" />
      <input className={input} name="email" type="email" placeholder="E-mail (opcional)" autoComplete="email" aria-label="E-mail" />
      <label className={`sm:col-span-3 flex gap-2.5 items-start text-[12px] ${dark ? "text-stone" : "text-muted"}`}>
        <input type="checkbox" name="consent" required className="mt-0.5 accent-mineral" />
        <span>Autorizo a DRAUM a me enviar novidades e ofertas por WhatsApp e e-mail. Posso pedir para sair a qualquer momento.</span>
      </label>
      {error && <p className="sm:col-span-3 text-[12.5px] text-crit">{error}</p>}
      <button disabled={pending} className={`sm:col-span-3 h-11 text-[13px] tracking-wide disabled:opacity-50 ${dark ? "bg-offwhite text-mineral hover:bg-sand" : "bg-mineral text-offwhite hover:bg-grafite"}`}>
        {pending ? "Enviando…" : mode === "vip" ? "Liberar meu acesso antecipado" : "Quero receber as novidades"}
      </button>
    </form>
  );
}
