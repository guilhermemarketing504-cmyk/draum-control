import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getStoreProduct } from "@/server/store";
import { Buy } from "./buy";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await getStoreProduct((await params).slug);
  return r ? { title: r.product.name, description: r.product.description?.slice(0, 160) ?? undefined, openGraph: { images: r.images[0] ? [r.images[0].src] : [] } } : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const r = await getStoreProduct((await params).slug);
  if (!r) notFound();
  const { product, variants, images, deliveryDate, cutoff } = r;
  const sellable = variants.filter((v) => v.mode);
  return (
    <div className="max-w-[1240px] mx-auto px-5 sm:px-8 pt-6 pb-10">
      <nav className="label mb-6 flex gap-2">
        <Link href="/loja" className="hover:text-mineral">Loja</Link><span>/</span>
        <Link href={`/loja?cat=${product.category}`} className="hover:text-mineral">{product.categoryLabel}</Link>
      </nav>
      <Buy
        product={{ name: product.name, price: product.price, promoPrice: product.promoPrice, description: product.description }}
        variants={sellable.map((v) => ({ id: v.id, color: v.color, hex: v.hex, size: v.size, mode: v.mode!, available: v.available }))}
        images={images}
        deliveryDate={deliveryDate}
        cutoff={cutoff}
      />
    </div>
  );
}
