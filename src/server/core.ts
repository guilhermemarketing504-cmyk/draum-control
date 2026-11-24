import type { PoolClient } from "pg";
import { Db, q, q1, getPool } from "@/lib/db";

/** Erro de regra de negócio: mensagem pode ser exibida ao usuário. */
export class BusinessError extends Error {
  constructor(message: string, public code = "regra") {
    super(message);
    this.name = "BusinessError";
  }
}

export type Role = "admin" | "operador";
export interface Ctx { userId: number; role: Role; name?: string }

export function requireAdmin(ctx: Ctx) {
  if (ctx.role !== "admin") throw new BusinessError("Apenas administradores podem executar esta operação.", "permissao");
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ───────── Datas no fuso de Belém ─────────
const TZ = "America/Belem";
export function todayISO(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(iso: string): number {
  return new Date(iso + "T12:00:00Z").getUTCDay(); // 0=domingo … 2=terça
}
/** Hora local (0–23) em Belém de um instante */
export function localHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d)) % 24;
}

// ───────── Configurações ─────────
export interface Settings {
  min_margin_pct: number;
  contingency_pct: number;
  safety_reserve_fixed: number;
  tax_pct: number;
  payment_fee_pct: Record<string, number>;
  packaging_cost: number;
  delivery_cost_estimate: number;
  presale_buffer_days: number;
  availability_valid_days: number;
  route_capacity_default: number;
  delivery_cutoff: { weekday: number; hour: number };
  store: StoreSettings;
  goals: {
    vip_members: number; paid_orders: number; paid_orders_deadline: string; avg_ticket: number;
    gross_revenue: number; contribution_margin_pct: number; on_time_delivery_pct: number;
  };
}

export interface StoreSettings {
  whatsapp: string; margin_pct: number; price_ending: number; mft_lead_days: number; mft_enabled: boolean; mft_supplier_id: number | null; vip_code?: string; infinitepay_handle?: string; featured?: string[];
}
export const STORE_DEFAULTS: StoreSettings = { whatsapp: "", margin_pct: 50, price_ending: 0.9, mft_lead_days: 2, mft_enabled: true, mft_supplier_id: null };

export async function getSettings(db: Db = getPool()): Promise<Settings> {
  const rows = await q<{ key: string; value: any }>(`select key, value from draum.settings`, [], db);
  const s: any = {};
  for (const r of rows) s[r.key] = r.value;
  s.store = { ...STORE_DEFAULTS, ...(s.store ?? {}) };
  return s as Settings;
}

/** Lista de parâmetros ainda zerados que afetam margem e caixa */
export function pendingSettings(s: Settings): string[] {
  const p: string[] = [];
  if (!s.tax_pct) p.push("Alíquota de tributos");
  if (!Object.values(s.payment_fee_pct ?? {}).some((v) => v > 0)) p.push("Taxas das formas de pagamento");
  if (!s.packaging_cost) p.push("Custo de embalagem por pedido");
  if (!s.delivery_cost_estimate) p.push("Custo estimado por entrega local");
  return p;
}

// ───────── Auditoria ─────────
export async function audit(db: Db, ctx: Ctx | null, entity: string, entityId: string | number | null, action: string, data?: unknown) {
  await db.query(
    `insert into draum.audit_log(user_id, entity, entity_id, action, data) values ($1,$2,$3,$4,$5)`,
    [ctx?.userId ?? null, entity, entityId == null ? null : String(entityId), action, data == null ? null : JSON.stringify(data)]
  );
}

export type Tx = PoolClient;
export type { Db };
export { q, q1 };
