"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { addProductImageAction } from "@/app/actions/store";

/** Reduz a foto no navegador (lado maior 1600px, JPEG) antes de enviar */
async function compress(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function PhotoUploader({ productId, colors }: { productId: number; colors: string[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    start(async () => {
      let ok = 0;
      for (const f of Array.from(files)) {
        try {
          const dataUrl = await compress(f);
          const r = await addProductImageAction({ productId, color: color || null, dataUrl });
          if (r.ok) ok++; else setMsg(r.error ?? "Falha ao enviar.");
        } catch { setMsg(`Não foi possível ler ${f.name}.`); }
      }
      if (ok) setMsg(`${ok} foto(s) adicionada(s).`);
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {colors.length > 1 && (
        <label className="field w-48"><span>Foto da cor</span>
          <select className="input" value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">Todas as cores</option>
            {colors.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => input.current?.click()}>
        <ImagePlus size={15} strokeWidth={1.5} /> {pending ? "Enviando…" : "Adicionar fotos"}
      </button>
      {msg && <span className="text-[12px] text-espresso">{msg}</span>}
    </div>
  );
}
