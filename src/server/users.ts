import bcrypt from "bcryptjs";
import { BusinessError, Ctx, q, q1, audit, requireAdmin, Role } from "./core";
import { tx } from "@/lib/db";

const MIN_PW = 10;
let dummyHash: string | null = null;

export async function countUsers() {
  return (await q1<{ n: number }>(`select count(*) n from draum.users`))!.n;
}

export async function createUser(ctx: Ctx | null, input: { name: string; email: string; password: string; role: Role }) {
  if (ctx) requireAdmin(ctx);
  const email = input.email.trim().toLowerCase();
  if (!input.name?.trim() || !/^\S+@\S+\.\S+$/.test(email)) throw new BusinessError("Nome e e-mail válidos são obrigatórios.");
  if ((input.password ?? "").length < MIN_PW) throw new BusinessError(`A senha deve ter pelo menos ${MIN_PW} caracteres.`);
  if (!["admin", "operador"].includes(input.role)) throw new BusinessError("Perfil inválido.");
  return tx(async (c) => {
    if (!ctx) {
      // Primeiro acesso: só é permitido quando ainda não existe nenhum usuário
      await c.query(`lock table draum.users in exclusive mode`);
      const n = (await q1<{ n: number }>(`select count(*) n from draum.users`, [], c))!.n;
      if (n > 0) throw new BusinessError("O sistema já foi configurado. Peça acesso a um administrador.", "permissao");
      input.role = "admin";
    }
    const dup = await q1(`select 1 from draum.users where email=$1`, [email], c);
    if (dup) throw new BusinessError("Já existe usuário com este e-mail.");
    const hash = await bcrypt.hash(input.password, 12);
    const r = await q1<{ id: number }>(`insert into draum.users(name, email, password_hash, role) values ($1,$2,$3,$4) returning id`, [input.name.trim(), email, hash, input.role], c);
    await audit(c, ctx, "user", r!.id, "criar", { email, role: input.role });
    return r!;
  });
}

export async function verifyLogin(email: string, password: string) {
  const u = await q1<any>(`select * from draum.users where email=$1`, [email.trim().toLowerCase()]);
  // compara mesmo quando o usuário não existe (evita enumeração por tempo de resposta)
  dummyHash ??= await bcrypt.hash("draum-dummy", 12);
  const ok = await bcrypt.compare(password ?? "", u?.password_hash ?? dummyHash);
  if (!u || !ok || !u.active) return null;
  await q(`update draum.users set last_login_at=now() where id=$1`, [u.id]);
  return { id: u.id as number, name: u.name as string, role: u.role as Role, email: u.email as string };
}

export async function getActiveUser(id: number) {
  return q1<{ id: number; name: string; role: Role; email: string }>(`select id, name, role, email from draum.users where id=$1 and active`, [id]);
}

export async function listUsers() {
  return q<any>(`select id, name, email, role, active, created_at, last_login_at from draum.users order by name`);
}

export async function updateUser(ctx: Ctx, id: number, input: { role?: Role; active?: boolean; password?: string }) {
  requireAdmin(ctx);
  return tx(async (c) => {
    if (id === ctx.userId && (input.active === false || input.role === "operador")) throw new BusinessError("Você não pode remover o próprio acesso de administrador.");
    if (input.role === "operador" || input.active === false) {
      const admins = (await q1<{ n: number }>(`select count(*) n from draum.users where role='admin' and active and id<>$1`, [id], c))!.n;
      const target = await q1<any>(`select role from draum.users where id=$1`, [id], c);
      if (target?.role === "admin" && admins === 0) throw new BusinessError("É preciso manter ao menos um administrador ativo.");
    }
    if (input.password != null) {
      if (input.password.length < MIN_PW) throw new BusinessError(`A senha deve ter pelo menos ${MIN_PW} caracteres.`);
      await c.query(`update draum.users set password_hash=$2 where id=$1`, [id, await bcrypt.hash(input.password, 12)]);
    }
    if (input.role) await c.query(`update draum.users set role=$2 where id=$1`, [id, input.role]);
    if (input.active != null) await c.query(`update draum.users set active=$2 where id=$1`, [id, input.active]);
    await audit(c, ctx, "user", id, "editar", { role: input.role, active: input.active, password: input.password ? "alterada" : undefined });
  });
}

export async function changeOwnPassword(ctx: Ctx, current: string, next: string) {
  const u = await q1<any>(`select password_hash from draum.users where id=$1`, [ctx.userId]);
  if (!u || !(await bcrypt.compare(current, u.password_hash))) throw new BusinessError("Senha atual incorreta.");
  if (next.length < MIN_PW) throw new BusinessError(`A nova senha deve ter pelo menos ${MIN_PW} caracteres.`);
  await q(`update draum.users set password_hash=$2 where id=$1`, [ctx.userId, await bcrypt.hash(next, 12)]);
}

// ───────── Configurações ─────────
import { z } from "zod";
const settingsSchema = z.object({
  min_margin_pct: z.coerce.number().min(0).max(95),
  contingency_pct: z.coerce.number().min(0).max(100),
  safety_reserve_fixed: z.coerce.number().min(0),
  tax_pct: z.coerce.number().min(0).max(50),
  payment_fee_pct: z.record(z.string(), z.coerce.number().min(0).max(30)),
  packaging_cost: z.coerce.number().min(0),
  delivery_cost_estimate: z.coerce.number().min(0),
  presale_buffer_days: z.coerce.number().int().min(0).max(60),
  availability_valid_days: z.coerce.number().int().min(1).max(60),
  route_capacity_default: z.coerce.number().int().min(1).max(200),
  delivery_cutoff: z.object({ weekday: z.coerce.number().int().min(0).max(6), hour: z.coerce.number().int().min(0).max(23) }),
  goals: z.object({
    vip_members: z.coerce.number().min(0), paid_orders: z.coerce.number().min(0), paid_orders_deadline: z.string(),
    avg_ticket: z.coerce.number().min(0), gross_revenue: z.coerce.number().min(0), contribution_margin_pct: z.coerce.number().min(0),
    on_time_delivery_pct: z.coerce.number().min(0).max(100),
  }),
});

export async function saveSettings(ctx: Ctx, raw: unknown) {
  requireAdmin(ctx);
  const s = settingsSchema.parse(raw);
  await tx(async (c) => {
    for (const [k, v] of Object.entries(s))
      await c.query(`insert into draum.settings(key, value, updated_at, updated_by) values ($1,$2,now(),$3)
        on conflict (key) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by`, [k, JSON.stringify(v), ctx.userId]);
    await audit(c, ctx, "settings", null, "salvar", s);
  });
}
