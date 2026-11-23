import Link from "next/link";
import type { Metadata } from "next";
import { Wordmark, Tagline, Symbol } from "@/components/brand";
import { BagButton } from "./bag";

export const metadata: Metadata = {
  title: { absolute: "DRAUM — The Art of Movement", template: "%s · DRAUM" },
  description: "Activewear premium de Belém. Pronta-entrega e peças sob encomenda com entrega gratuita às terças.",
  robots: { index: true, follow: true },
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-offwhite text-mineral flex flex-col">
      <div className="bg-mineral text-sand text-center text-[11px] tracking-[0.14em] uppercase font-mono py-2 px-4">
        Entrega gratuita em Belém toda terça-feira
      </div>
      <header className="sticky top-0 z-30 bg-offwhite/95 backdrop-blur border-b border-line">
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
          <div className="flex-1 md:hidden" />
          <nav className="hidden md:flex items-center gap-7 text-[13px] flex-1">
            <Link href="/loja?tipo=pronta" className="hover:text-espresso">Pronta-entrega</Link>
            <Link href="/loja?tipo=encomenda" className="hover:text-espresso">Sob encomenda</Link>
          </nav>
          <Link href="/loja" aria-label="DRAUM — início" className="flex flex-col items-center gap-1.5">
            <Wordmark className="h-[17px]" />
            <Tagline className="h-[5px] text-espresso" />
          </Link>
          <div className="flex-1 flex justify-end"><BagButton /></div>
        </div>
        <nav className="md:hidden flex justify-center gap-6 text-[12.5px] pb-3 -mt-1">
          <Link href="/loja?tipo=pronta">Pronta-entrega</Link>
          <Link href="/loja?tipo=encomenda">Sob encomenda</Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-mineral text-sand mt-20">
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 py-12 grid gap-10 sm:grid-cols-3">
          <div className="space-y-4">
            <Symbol className="h-8 text-offwhite" />
            <p className="text-[12.5px] text-stone max-w-[260px]">Activewear premium de Belém. Feito para o movimento, do treino ao fim de semana.</p>
          </div>
          <div className="space-y-2 text-[12.5px]">
            <div className="label !text-stone">DRAUM Delivery Day</div>
            <p>Pedidos confirmados até sexta, 12h, são entregues na terça-feira seguinte, sem custo de frete em Belém.</p>
          </div>
          <div className="space-y-2 text-[12.5px]">
            <div className="label !text-stone">Como comprar</div>
            <p>Escolha suas peças, finalize o pedido e fale com a gente no WhatsApp para pagar com Pix ou cartão.</p>
          </div>
        </div>
        <div className="border-t border-grafite py-5 text-center label !text-stone/70">DRAUM · The Art of Movement</div>
      </footer>
    </div>
  );
}
