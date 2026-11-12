import Link from "next/link";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-8">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          {eyebrow && <div className="label mb-2">{eyebrow}</div>}
          <h1 className="font-display text-[26px] leading-tight">{title}</h1>
          {description && <p className="text-espresso mt-2 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex gap-2 flex-wrap no-print">{actions}</div>}
      </div>
      <div className="vao mt-6" />
    </header>
  );
}

export function Stat({ label, value, hint, tone, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warn" | "crit" | "ok"; href?: string }) {
  const body = (
    <div className={`card card-pad h-full ${href ? "hover:border-stone transition-colors" : ""}`}>
      <div className="label">{label}</div>
      <div className={`font-display text-[21px] mt-2 num whitespace-nowrap ${tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : ""}`}>{value}</div>
      {hint && <div className="text-[12px] text-muted mt-1.5">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Section({ title, children, actions, className = "" }: { title: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line gap-4">
        <h2 className="label !text-mineral">{title}</h2>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="py-14 px-6 text-center">
      <svg width="28" height="32" viewBox="0 0 28 32" className="mx-auto mb-4 text-stone" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="3" y1="2" x2="3" y2="30" /><path d="M8 2 h4 a14 14 0 0 1 0 28 h-4" /><line x1="6.2" y1="1" x2="4.6" y2="31" stroke="#F3F0E8" strokeWidth="2" />
      </svg>
      <div className="font-display text-[16px]">{title}</div>
      {children && <p className="text-muted mt-2 max-w-md mx-auto text-[13px]">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const TONE: Record<string, string> = {
  // pedidos
  aguardando_pagamento: "chip-warn", pago: "chip-neutral", em_andamento: "chip-neutral", entregue_parcial: "chip-neutral",
  entregue: "chip-ok", finalizado: "chip-ok", cancelado: "chip-crit",
  // financeiro
  aguardando: "chip-warn", informado: "chip-warn", conciliado: "chip-ok", rejeitado: "chip-crit", reembolsado: "chip-crit", parcialmente_reembolsado: "chip-warn",
  // itens
  reservado: "chip-neutral", aguardando_compra: "chip-warn", comprado: "chip-neutral", recebido: "chip-neutral", pronto: "chip-dark",
  em_rota: "chip-dark", devolvido: "chip-crit", trocado: "chip-neutral", embalado: "chip-neutral",
  // risco
  ok: "chip-ok", medio: "chip-warn", alto: "chip-crit", atrasado: "chip-crit",
  // genéricos
  ativo: "chip-ok", ativa: "chip-ok", rascunho: "chip-neutral", pausado: "chip-warn", pausada: "chip-warn", descontinuado: "chip-crit",
  planejada: "chip-neutral", concluida: "chip-ok", encerrada: "chip-neutral", falhou: "chip-crit", aberta: "chip-warn", liquidada: "chip-ok", cancelada: "chip-crit",
  enviado: "chip-neutral", em_transito: "chip-neutral", recebido_parcial: "chip-warn", prospeccao: "chip-neutral",
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={TONE[value] ?? "chip-neutral"}>{label ?? value.replace(/_/g, " ")}</span>;
}

export function Tabs({ tabs, current }: { tabs: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="flex gap-6 border-b border-line mb-6 overflow-x-auto no-print">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`pb-2.5 -mb-px text-[13px] whitespace-nowrap border-b ${current === t.key ? "border-mineral text-mineral" : "border-transparent text-muted hover:text-mineral"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-2.5 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents"><dt className="label pt-0.5">{k}</dt><dd className="text-mineral">{v ?? "—"}</dd></div>
      ))}
    </dl>
  );
}

export function Alert({ tone = "warn", children }: { tone?: "warn" | "crit" | "info"; children: React.ReactNode }) {
  const cls = tone === "crit" ? "border-crit text-crit bg-crit/5" : tone === "warn" ? "border-warn text-warn bg-warn/5" : "border-espresso text-espresso bg-sand/30";
  return <div className={`border-l-2 px-4 py-3 text-[13px] ${cls}`}>{children}</div>;
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <form className="flex flex-wrap gap-3 items-end mb-5 no-print">{children}<button className="btn-secondary">Filtrar</button></form>;
}
