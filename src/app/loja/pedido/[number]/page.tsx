import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, MessageCircle } from "lucide-react";
import { confirmPayment, orderPublicStatus } from "@/server/infinitepay";
import { getSettings } from "@/server/core";
import { brl } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pedido", robots: { index: false, follow: false } };

const longDay = (iso: string | null) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }) : null;

// Retorno do checkout da InfinitePay: confere o pagamento e leva a cliente para o WhatsApp combinar a entrega
export default async function PedidoPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string>> }) {
  const { number } = await params;
  const sp = await searchParams;
  if (sp.transaction_nsu && sp.slug) {
    await confirmPayment({ orderNsu: number, transactionNsu: sp.transaction_nsu, slug: sp.slug }).catch((e) => console.error("[infinitepay] retorno:", e.message));
  }
  const o = await orderPublicStatus(number);
  if (!o) notFound();
  const s = await getSettings();
  const paid = o.financial_status === "pago";
  const day = longDay(o.promised_date);
  const msg = paid
    ? `Olá, DRAUM! Paguei o pedido *${o.number}* pela loja${sp.capture_method === "pix" ? " (Pix)" : sp.capture_method ? " (cartão)" : ""}. Vamos combinar a entrega?`
    : `Olá, DRAUM! Quero finalizar o pagamento do pedido *${o.number}*.`;
  const wa = s.store.whatsapp ? `https://wa.me/${s.store.whatsapp}?text=${encodeURIComponent(msg)}` : null;
  return (
    <div className="max-w-[620px] mx-auto px-5 sm:px-8 py-14 sm:py-20">
      <div className="border border-line bg-paper p-7 sm:p-10 space-y-6">
        <div className="label">Pedido {o.number}</div>
        {paid ? (
          <>
            <CheckCircle2 size={40} strokeWidth={1.3} className="text-ok" />
            <h1 className="font-display text-[30px] leading-tight">Pagamento confirmado.</h1>
            <p className="text-[14px] text-espresso">Obrigada, {String(o.name).split(" ")[0]}! Recebemos {brl(o.total)}.{day && o.fulfillment === "entrega_local" ? <> Sua entrega está marcada para <strong className="font-medium text-mineral">{day}</strong>.</> : null}</p>
            <p className="text-[13px] text-muted">Fale com a gente no WhatsApp para confirmar o endereço e o horário.</p>
          </>
        ) : (
          <>
            <Clock size={40} strokeWidth={1.3} className="text-warn" />
            <h1 className="font-display text-[30px] leading-tight">Ainda não recebemos o pagamento.</h1>
            <p className="text-[14px] text-espresso">Se você acabou de pagar, aguarde alguns segundos e atualize esta página. Se preferir, finalize com a gente pelo WhatsApp.</p>
          </>
        )}
        {sp.receipt_url && /^https:\/\//.test(sp.receipt_url) && <a href={sp.receipt_url} target="_blank" rel="noreferrer" className="link text-[13px]">Ver comprovante</a>}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          {wa && <a href={wa} className="h-12 px-6 inline-flex items-center justify-center gap-2 bg-mineral text-offwhite text-[13.5px]"><MessageCircle size={17} strokeWidth={1.5} /> {paid ? "Combinar a entrega" : "Falar no WhatsApp"}</a>}
          <Link href="/loja" className="h-12 px-6 inline-flex items-center justify-center border border-line text-[13.5px]">Voltar para a loja</Link>
        </div>
      </div>
    </div>
  );
}
