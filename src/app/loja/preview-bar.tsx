/** Barra da prévia de aprovação (só aparece com STORE_PREVIEW=1): troca a data simulada e a visão VIP/pública */
const MOMENTS: [string, string][] = [
  ["2026-11-24T00:00:00-03:00", "24/11 00h"],
  ["2026-11-27T00:00:00-03:00", "27/11 00h"],
  ["", "Agora"],
];

export function PreviewBar({ now, vip }: { now: string; vip: boolean }) {
  const label = new Date(now).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Belem" });
  const pill = "h-8 px-3 inline-flex items-center rounded-full border text-[11.5px] whitespace-nowrap";
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-24px)] max-w-[720px] bg-[#111210] text-[#F3F0E8] shadow-2xl rounded-2xl px-4 py-3 flex flex-wrap items-center gap-2 text-[12px]">
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[#C9B89C] mr-1">Prévia · {label}</span>
      {MOMENTS.map(([v, l]) => (
        <a key={l} href={`?agora=${encodeURIComponent(v)}`} className={`${pill} border-white/25 hover:border-white`}>{l}</a>
      ))}
      <span className="w-px h-5 bg-white/20 mx-1" />
      <a href="?vip=1" className={`${pill} ${vip ? "bg-[#F3F0E8] text-[#111210] border-[#F3F0E8]" : "border-white/25"}`}>Grupo VIP</a>
      <a href="?vip=0" className={`${pill} ${!vip ? "bg-[#F3F0E8] text-[#111210] border-[#F3F0E8]" : "border-white/25"}`}>Público</a>
    </div>
  );
}
