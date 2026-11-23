import { Bag } from "./bag-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sacola", robots: { index: false } };

export default function SacolaPage() {
  return (
    <div className="max-w-[1100px] mx-auto px-5 sm:px-8 pt-10">
      <div className="label mb-3">Sua sacola</div>
      <h1 className="font-display text-[30px] sm:text-[38px] mb-8">Finalizar pedido</h1>
      <Bag />
    </div>
  );
}
