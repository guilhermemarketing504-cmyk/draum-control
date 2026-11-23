import { confirmPayment } from "@/server/infinitepay";

export const dynamic = "force-dynamic";

// Aviso de pagamento da InfinitePay. Sem assinatura: o pagamento só é registrado depois de conferido em /payment_check.
export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
  try {
    const r = await confirmPayment({ orderNsu: String(b?.order_nsu ?? ""), transactionNsu: String(b?.transaction_nsu ?? ""), slug: String(b?.invoice_slug ?? b?.slug ?? "") });
    return Response.json({ ok: true, paid: r.paid });
  } catch (e) {
    console.error("[infinitepay] webhook:", (e as Error).message);
    return new Response("erro", { status: 400 }); // a InfinitePay reenvia
  }
}
