import "server-only";
import { cookies } from "next/headers";
import { isVipCode } from "@/server/store";

export const VIP_COOKIE = "draum_vip";
/** Ambiente de prévia (aprovação): data simulada e visão VIP por cookie. Desligado em produção. */
export const PREVIEW = process.env.STORE_PREVIEW === "1";
export const PREVIEW_NOW_COOKIE = "draum_preview_agora";
export const PREVIEW_VIP_COOKIE = "draum_preview_vip";

/** A cliente abriu o link do acesso antecipado neste navegador? */
export async function vipFromCookie() {
  const jar = await cookies();
  if (PREVIEW && jar.get(PREVIEW_VIP_COOKIE)?.value === "1") return true;
  return isVipCode(jar.get(VIP_COOKIE)?.value);
}

/** Relógio da loja: a hora real, ou a simulada na prévia */
export async function storeClock() {
  if (!PREVIEW) return new Date();
  const v = (await cookies()).get(PREVIEW_NOW_COOKIE)?.value;
  const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : new Date();
}
