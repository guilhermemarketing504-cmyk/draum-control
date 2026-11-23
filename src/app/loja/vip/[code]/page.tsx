import Link from "next/link";
import { redirect } from "next/navigation";
import { isVipCode, storePromotions } from "@/server/store";
import { vipFromCookie } from "../../vip";
import { LeadForm } from "../../lead-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acesso antecipado", robots: { index: false, follow: false } };

const dm = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Belem" });

export default async function VipAccess({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await isVipCode(code))) {
    return (
      <div className="max-w-[560px] mx-auto px-5 py-20 text-center space-y-4">
        <h1 className="font-display text-[26px]">Link inválido</h1>
        <p className="text-[13.5px] text-espresso">Peça o link atualizado no grupo DRAUM PRIVATE ACCESS.</p>
        <Link href="/loja" className="inline-flex h-11 px-6 items-center bg-mineral text-offwhite text-[13px]">Ir para a loja</Link>
      </div>
    );
  }
  if (await vipFromCookie()) redirect("/loja");
  const vip = (await storePromotions()).find((p) => p.requiresVip);
  const ends = vip ? new Date(vip.endsAt.getTime() - 60_000) : null;
  return (
    <div className="bg-mineral text-offwhite">
      <div className="max-w-[760px] mx-auto px-5 sm:px-8 py-16 sm:py-24 space-y-8">
        <div className="label !text-stone">DRAUM Private Access</div>
        <h1 className="font-display text-[34px] sm:text-[48px] leading-[1.04]">Você compra antes. Com {vip?.pct ?? 20}% OFF em todas as peças.</h1>
        <p className="text-[14px] text-sand max-w-[560px]">
          {vip && ends ? <>O acesso antecipado à nossa primeira Black Friday vai de {dm(vip.startsAt)} a {dm(ends)}, antes de abrir para todo mundo. </> : null}
          Confirme seus dados para liberar os preços neste celular.
        </p>
        <LeadForm mode="vip" code={code} dark />
      </div>
    </div>
  );
}
