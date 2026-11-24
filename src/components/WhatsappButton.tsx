"use client";
import { useState, useTransition } from "react";
import { recordNoticeAction } from "@/app/actions/store";

/** Abre o WhatsApp da cliente com a mensagem pronta e marca o aviso como enviado */
export function WhatsappButton({ phone, text, kind, refId, sentAt, label = "Enviar no WhatsApp", small = false }:
  { phone: string | null; text: string; kind: string; refId: number; sentAt: string | null; label?: string; small?: boolean }) {
  const [sent, setSent] = useState(sentAt);
  const [, start] = useTransition();
  if (!phone) return <span className="text-[12px] text-muted">sem WhatsApp</span>;
  const href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <a href={href} target="_blank" rel="noreferrer"
        onClick={() => { setSent(new Date().toISOString()); start(() => { recordNoticeAction(kind, refId); }); }}
        className={`${sent ? "btn-secondary" : "btn-primary"} ${small ? "btn-sm" : ""}`}>
        {sent ? "Enviar de novo" : label}
      </a>
      {sent && <span className="text-[11.5px] text-ok">✓ enviado {new Date(sent).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Belem" })}</span>}
    </span>
  );
}
