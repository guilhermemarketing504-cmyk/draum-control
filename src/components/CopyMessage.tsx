"use client";
import { useState } from "react";

export function CopyMessage({ label, text, phone, canSend }: { label: string; text: string; phone?: string | null; canSend: boolean }) {
  const [msg, setMsg] = useState(text);
  const [copied, setCopied] = useState(false);
  return (
    <div className="border border-line rounded p-3">
      <div className="label mb-2">{label}</div>
      <textarea className="input text-[12.5px]" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
      <div className="flex gap-2 mt-2">
        <button type="button" className="btn-secondary btn-sm" onClick={async () => { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copiado" : "Copiar"}</button>
        {phone && canSend && <a className="btn-secondary btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`}>Abrir no WhatsApp</a>}
      </div>
    </div>
  );
}
