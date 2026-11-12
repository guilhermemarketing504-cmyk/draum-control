/* Aplica as migrações SQL em ordem, registrando cada uma em draum_migrations.
   Uso: npm run db:migrate   (lê DATABASE_URL de .env.local / ambiente) */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { Client } from "pg";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

export async function migrate(url: string, ssl = false, log = console.log) {
  const client = new Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    const exists = (await client.query(`select to_regclass('public.draum_migrations') as t`)).rows[0].t;
    if (!exists) await client.query(`create table public.draum_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query(`select name from public.draum_migrations`)).rows.map((r) => r.name));
    const dir = join(__dirname, "..", "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(`insert into public.draum_migrations(name) values ($1)`, [f]);
        await client.query("commit");
        log(`✓ ${f}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Falha em ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Defina DATABASE_URL"); process.exit(1); }
  migrate(url, process.env.DATABASE_SSL === "true")
    .then(() => console.log("Migrações aplicadas."))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
