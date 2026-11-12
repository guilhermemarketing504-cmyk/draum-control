"use client";
import { useMemo, useState } from "react";
import { ActionForm, Field } from "./forms";
import { createProductAction, updateProductAction } from "@/app/actions/products";

const CATS: [string, string, string][] = [
  ["macaquinhos", "Macaquinhos", "MAC"], ["macacoes", "Macacões", "MCC"], ["tops", "Tops", "TOP"], ["leggings", "Leggings", "LEG"],
  ["shorts", "Shorts", "SHO"], ["conjuntos", "Conjuntos", "CON"], ["camisetas", "Camisetas", "CAM"], ["casaquinhos", "Casaquinhos", "CAS"], ["outras", "Outras peças", "OUT"],
];
const SIZES = ["PP", "P", "M", "G", "GG", "XG", "U"];
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const suggest = (c: string) => { const s = strip(c); return s.length <= 3 ? s.padEnd(3, "X") : s[0] + s.slice(-2); };

export function ProductFields({ p }: { p?: any }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Field label="Nome comercial" className="md:col-span-2"><input className="input" name="name" defaultValue={p?.name} required /></Field>
      <Field label="Categoria">
        <select className="input" name="category" defaultValue={p?.category ?? "macaquinhos"}>
          {CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className="input" name="status" defaultValue={p?.status ?? "ativo"}>
          <option value="rascunho">Rascunho</option><option value="ativo">Ativo</option><option value="pausado">Pausado</option><option value="descontinuado">Descontinuado</option>
        </select>
      </Field>
      <Field label="Preço de venda (R$)"><input className="input num" name="sale_price" type="number" step="0.01" min="0" defaultValue={p?.sale_price} required /></Field>
      <Field label="Preço promocional (R$)" hint="Opcional. Não acumula com promoções do pedido."><input className="input num" name="promo_price" type="number" step="0.01" min="0" defaultValue={p?.promo_price ?? ""} /></Field>
      <Field label="Modalidade disponível">
        <select className="input" name="modality" defaultValue={p?.modality ?? "ambas"}>
          <option value="ambas">Pronta-entrega e pré-venda</option><option value="pronta">Somente pronta-entrega</option><option value="pre">Somente pré-venda</option>
        </select>
      </Field>
      <Field label="Imagem (URL)" hint="Link público da foto do produto."><input className="input" name="image_url" type="url" defaultValue={p?.image_url ?? ""} /></Field>
      <Field label="Descrição" className="md:col-span-2"><textarea className="input" name="description" rows={3} defaultValue={p?.description ?? ""} /></Field>
    </div>
  );
}

export function NewProductForm() {
  const [cat, setCat] = useState("macaquinhos");
  const [colors, setColors] = useState<{ name: string; code: string }[]>([{ name: "Preto", code: "PTO" }]);
  const [sizes, setSizes] = useState<string[]>(["P", "M", "G"]);
  const [extra, setExtra] = useState("");
  const allSizes = [...sizes, ...extra.split(/[,\s]+/).map(strip).filter(Boolean)];
  const variants = useMemo(() => colors.filter((c) => c.name.trim()).flatMap((c) => allSizes.map((s) => ({ color: c.name.trim(), color_code: strip(c.code || suggest(c.name)).slice(0, 4), size: s }))), [colors, allSizes.join()]);
  const prefix = `DRA-${CATS.find((c) => c[0] === cat)![2]}-###`;

  return (
    <ActionForm action={createProductAction} submitLabel="Cadastrar produto" redirectTo={(d) => `/produtos/${d.id}`}>
      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        <div className="card card-pad" onChange={(e) => { const t = e.target as unknown as HTMLSelectElement; if (t.name === "category") setCat(t.value); }}>
          <div className="label mb-4">Dados do produto</div>
          <ProductFields />
          <Field label="Código do produto (opcional)" hint={`Em branco: gerado automaticamente (${prefix}).`} className="mt-4">
            <input className="input font-mono" name="code" placeholder={prefix} />
          </Field>
        </div>
        <div className="card card-pad">
          <div className="label mb-4">Variantes — cor × tamanho</div>
          {colors.map((c, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className="input" placeholder="Cor (ex.: Preto)" value={c.name}
                onChange={(e) => setColors(colors.map((x, j) => (j === i ? { name: e.target.value, code: suggest(e.target.value) } : x)))} />
              <input className="input w-24 font-mono uppercase" title="Código da cor no SKU" value={c.code} maxLength={4}
                onChange={(e) => setColors(colors.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setColors(colors.filter((_, j) => j !== i))} aria-label="Remover cor">×</button>
            </div>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setColors([...colors, { name: "", code: "" }])}>+ Cor</button>
          <div className="label mt-5 mb-2">Tamanhos</div>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <label key={s} className={`chip cursor-pointer ${sizes.includes(s) ? "chip-dark" : "chip-neutral"}`}>
                <input type="checkbox" className="sr-only" checked={sizes.includes(s)} onChange={() => setSizes(sizes.includes(s) ? sizes.filter((x) => x !== s) : [...sizes, s])} />{s}
              </label>
            ))}
          </div>
          <input className="input mt-2" placeholder="Outros tamanhos (ex.: 36, 38)" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <div className="label mt-5 mb-2">{variants.length} SKU(s)</div>
          <ul className="font-mono text-[11.5px] text-espresso max-h-48 overflow-auto space-y-0.5">
            {variants.map((v) => <li key={v.color_code + v.size}>{prefix}-{v.color_code}-{v.size} <span className="text-muted">· {v.color}</span></li>)}
          </ul>
          <input type="hidden" name="variants" value={JSON.stringify(variants)} />
          <p className="text-[12px] text-muted mt-3">Cada combinação recebe SKU próprio e estoque independente, começando em zero. A entrada em estoque acontece no recebimento de compras ou por ajuste do administrador.</p>
        </div>
      </div>
    </ActionForm>
  );
}

export function EditProductForm({ p }: { p: any }) {
  return (
    <ActionForm action={updateProductAction} submitLabel="Salvar alterações">
      <input type="hidden" name="id" value={p.id} />
      <ProductFields p={p} />
    </ActionForm>
  );
}
