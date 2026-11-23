import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

// Fotos enviadas pelo CONTROL (guardadas no banco)
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("not found", { status: 404 });
  const img = await q1<{ data: Buffer | null; mime: string | null; url: string | null }>(
    `select data, mime, url from draum.product_images where id = $1`, [id]);
  if (!img) return new Response("not found", { status: 404 });
  if (img.url) return Response.redirect(img.url, 302);
  return new Response(new Uint8Array(img.data!), {
    headers: { "Content-Type": img.mime ?? "image/jpeg", "Cache-Control": "public, max-age=604800, immutable" },
  });
}
