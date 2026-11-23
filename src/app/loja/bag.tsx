"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";

// Sacola guardada no navegador da cliente: só ids e quantidades. Preço e disponibilidade vêm sempre do servidor.
export interface BagItem { variantId: number; qty: number }
const KEY = "draum_bag_v1";
const EVT = "draum-bag";

export function readBag(): BagItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((i) => Number.isInteger(i?.variantId) && i.qty > 0) : [];
  } catch { return []; }
}
export function writeBag(items: BagItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  window.dispatchEvent(new Event(EVT));
}
export function addToBag(variantId: number, qty = 1) {
  const bag = readBag();
  const cur = bag.find((i) => i.variantId === variantId);
  if (cur) cur.qty = Math.min(cur.qty + qty, 10); else bag.push({ variantId, qty });
  writeBag(bag);
}
export function useBag() {
  const [items, setItems] = useState<BagItem[] | null>(null);
  useEffect(() => {
    const sync = () => setItems(readBag());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return items;
}

export function BagButton() {
  const items = useBag();
  const n = items?.reduce((a, i) => a + i.qty, 0) ?? 0;
  return (
    <Link href="/loja/sacola" className="relative inline-flex items-center gap-2 h-10 px-1 text-[13px]" aria-label={`Sacola com ${n} peça(s)`}>
      <ShoppingBag size={19} strokeWidth={1.3} />
      <span className="hidden sm:inline">Sacola</span>
      {n > 0 && <span className="absolute -top-0.5 left-3 min-w-[17px] h-[17px] px-1 rounded-full bg-mineral text-offwhite text-[10px] leading-[17px] text-center num">{n}</span>}
    </Link>
  );
}
