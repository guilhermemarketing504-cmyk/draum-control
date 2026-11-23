import { BusinessError, Ctx, q, q1, audit } from "./core";
import { getPool } from "@/lib/db";

const MAX_BYTES = 1_500_000;

/** Foto enviada pelo CONTROL (já comprimida no navegador). Guardada no banco e servida em /loja/img/:id */
export async function addProductImage(ctx: Ctx, input: { productId: number; color: string | null; dataUrl: string }) {
  const m = String(input.dataUrl ?? "").match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
  if (!m) throw new BusinessError("Formato de imagem não suportado. Use JPG, PNG ou WebP.");
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > MAX_BYTES) throw new BusinessError("Imagem muito grande mesmo após a compressão (máx. 1,5 MB).");
  const p = await q1<{ id: number }>(`select id from draum.products where id = $1`, [input.productId]);
  if (!p) throw new BusinessError("Produto não encontrado.");
  const pos = await q1<{ n: number }>(`select coalesce(max(position), -1) + 1 n from draum.product_images where product_id = $1 and data is not null`, [p.id]);
  const r = await q1<{ id: number }>(
    `insert into draum.product_images(product_id, color, data, mime, position) values ($1,$2,$3,$4,$5) returning id`,
    [p.id, input.color || null, buf, m[1], pos!.n]);
  await audit(getPool(), ctx, "product", p.id, "foto_adicionar", { imageId: r!.id });
  return r;
}

export async function removeProductImage(ctx: Ctx, id: number) {
  const r = await q1<{ product_id: number }>(`delete from draum.product_images where id = $1 and data is not null returning product_id`, [id]);
  if (!r) throw new BusinessError("Foto não encontrada (fotos da distribuidora são atualizadas pelo robô).");
  await audit(getPool(), ctx, "product", r.product_id, "foto_remover", { imageId: id });
}

export async function listProductImages(productId: number) {
  return q<{ id: number; color: string | null; url: string | null; uploaded: boolean }>(
    `select id, color, url, data is not null as uploaded from draum.product_images where product_id = $1 order by position, id`, [productId]);
}
