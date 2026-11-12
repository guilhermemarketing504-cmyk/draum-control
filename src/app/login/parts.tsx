"use client";
import { useActionState } from "react";
import { loginAction, setupAction } from "@/app/actions/auth";
import { Feedback } from "@/components/forms";
import { Wordmark, Tagline, Symbol } from "@/components/brand";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-mineral text-offwhite p-12">
        <div className="label !text-stone">DRAUM CONTROL · Central de gestão comercial</div>
        <div className="flex flex-col items-center gap-5">
          <Wordmark className="h-14" />
          <Tagline className="h-[9px] text-sand" />
        </div>
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-4"><Symbol className="h-8" /><span className="text-[15px] leading-snug">The Business<br />Behind the Movement.</span></div>
          <div className="label !text-stone text-right">Belém, Pará<br />E-commerce nacional</div>
        </div>
      </section>
      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 text-mineral"><Wordmark className="h-7" /></div>
          <h1 className="font-display text-[24px]">{title}</h1>
          <p className="text-espresso mt-1 mb-8">{subtitle}</p>
          {children}
        </div>
      </section>
    </main>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="field"><span>E-mail</span><input className="input" name="email" type="email" autoComplete="email" required /></label>
      <label className="field"><span>Senha</span><input className="input" name="password" type="password" autoComplete="current-password" required /></label>
      <button className="btn-primary mt-2" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="field"><span>Seu nome</span><input className="input" name="name" required /></label>
      <label className="field"><span>E-mail</span><input className="input" name="email" type="email" required /></label>
      <label className="field"><span>Senha (mín. 10 caracteres)</span><input className="input" name="password" type="password" minLength={10} required /></label>
      <button className="btn-primary mt-2" disabled={pending}>{pending ? "Criando…" : "Criar administrador"}</button>
      <Feedback state={state} />
    </form>
  );
}
