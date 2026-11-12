export const brl = (n: number | string | null | undefined) =>
  n == null || n === "" ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const int = (n: number | string | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));
export const pct = (n: number | string | null | undefined, d = 1) => (n == null ? "—" : `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: d })}%`);
export const dateBR = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; }
  return new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Belem" });
};
export const dateTimeBR = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" }) : "—";
export const weekdayBR = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
export const waLink = (phone?: string | null, text?: string) => (phone ? `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null);
