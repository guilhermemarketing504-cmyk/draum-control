import "server-only";
import { cookies } from "next/headers";
import { isVipCode } from "@/server/store";

export const VIP_COOKIE = "draum_vip";

/** A cliente abriu o link do acesso antecipado neste navegador? */
export async function vipFromCookie() {
  return isVipCode((await cookies()).get(VIP_COOKIE)?.value);
}
