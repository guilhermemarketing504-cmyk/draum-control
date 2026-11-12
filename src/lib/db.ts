import { Pool, PoolClient, types } from "pg";

// numeric → number (valores monetários com 2 casas; arredondamos sempre com round2)
types.setTypeParser(1700, (v) => parseFloat(v));
// int8 (ids, count) → number
types.setTypeParser(20, (v) => parseInt(v, 10));
// date → string 'YYYY-MM-DD' (evita deslocamento de fuso)
types.setTypeParser(1082, (v) => v);

export type Db = Pool | PoolClient;

const globalForPool = globalThis as unknown as { __draumPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__draumPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada.");
    const pool = new Pool({
      connectionString: url,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      // fuso de Belém para datas calculadas no banco (a migração 003 também define o padrão do banco)
      options: process.env.DATABASE_NO_STARTUP_OPTIONS === "true" ? undefined : "-c TimeZone=America/Belem",
    });
    globalForPool.__draumPool = pool;
  }
  return globalForPool.__draumPool;
}

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = getPool()): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}

export async function q1<T = any>(sql: string, params: unknown[] = [], db: Db = getPool()): Promise<T | null> {
  const rows = await q<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Executa fn dentro de uma transação. Qualquer erro desfaz tudo. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local search_path = draum, public; set local time zone 'America/Belem'");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (globalForPool.__draumPool) {
    await globalForPool.__draumPool.end();
    globalForPool.__draumPool = undefined;
  }
}
