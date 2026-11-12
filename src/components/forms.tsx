"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function Feedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return state.ok
    ? <p role="status" className="text-[12.5px] text-ok">{state.message}</p>
    : <p role="alert" className="text-[12.5px] text-crit border-l-2 border-crit pl-3 py-1 bg-crit/5">{state.error}</p>;
}

export function ActionForm({ action, children, submitLabel = "Salvar", className = "", reset = false, confirm, redirectTo, onDone, submitClass = "btn-primary", inline = false }: {
  action: Action; children?: React.ReactNode; submitLabel?: string; className?: string; reset?: boolean; confirm?: string;
  redirectTo?: string | ((data: any) => string); onDone?: (data: any) => void; submitClass?: string; inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      onDone?.(state.data);
      if (redirectTo) router.push(typeof redirectTo === "function" ? redirectTo(state.data) : redirectTo.replace("{id}", String(state.data?.id ?? "")));
      else router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction} className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      <div className={inline ? "contents" : "flex items-center gap-4 mt-4 flex-wrap"}>
        <button className={submitClass} disabled={pending}>{pending ? "Processando…" : submitLabel}</button>
        {!inline && <Feedback state={state} />}
      </div>
      {inline && state && !state.ok && <div className="w-full mt-2"><Feedback state={state} /></div>}
    </form>
  );
}

/** Botão de ação única com campos ocultos e confirmação opcional */
export function ActionButton({ action, fields = {}, label, className = "btn-secondary btn-sm", confirm }: {
  action: Action; fields?: Record<string, string | number>; label: string; className?: string; confirm?: string;
}) {
  return (
    <ActionForm action={action} submitLabel={label} submitClass={className} confirm={confirm} inline className="inline-flex flex-wrap items-center">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </ActionForm>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="text-[11.5px] text-muted">{hint}</small>}
    </label>
  );
}

export function Disclosure({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(!open)}>{open ? "Fechar" : label}</button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
