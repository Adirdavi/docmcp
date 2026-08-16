import { randomBytes } from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

/** Neon hands out connection strings containing `channel_binding=require`, which
 *  asks for SCRAM-SHA-256-PLUS. node-postgres negotiates plain SCRAM, so the server
 *  rejects the handshake as error 28P01 — indistinguishable from a wrong password,
 *  and a miserable thing to debug. TLS is still enforced by the ssl option below. */
function withoutChannelBinding(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("channel_binding")) return raw;
    u.searchParams.delete("channel_binding");
    return u.toString();
  } catch {
    return raw; // not a URL we can parse; let pg report it
  }
}

// Managed Postgres (Neon, Supabase, Render) terminates TLS with its own CA.
const pool = new pg.Pool({
  connectionString: withoutChannelBinding(url),
  ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  max: 5,
});

const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  pool.query<T>(sql, params);

export async function init(): Promise<void> {
  await q(`
    CREATE TABLE IF NOT EXISTS keys (
      key        TEXT PRIMARY KEY,
      email      TEXT,
      plan       TEXT NOT NULL,
      quota      INTEGER NOT NULL,
      stripe_sub TEXT,
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS usage (
      key   TEXT NOT NULL,
      month TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key, month)
    );
    CREATE TABLE IF NOT EXISTS free_issues (
      ip_hash TEXT NOT NULL,
      day     DATE NOT NULL DEFAULT current_date,
      at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS free_issues_ip ON free_issues (ip_hash, at);
    CREATE INDEX IF NOT EXISTS free_issues_day ON free_issues (day);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
}

/** Test-only. Guarded so a fat-fingered DATABASE_URL cannot wipe production. */
export async function reset(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset in production");
  await q(`TRUNCATE keys, usage, free_issues, meta`);
}

export const close = () => pool.end();

export const PLANS: Record<string, number> = {
  free: 10,
  starter: 100, // $10/mo
  pro: 500, // $30/mo
};

export type Account = { key: string; plan: string; quota: number };

const month = () => new Date().toISOString().slice(0, 7);

export async function createKey(plan: string, email?: string, sub?: string): Promise<string> {
  const key = "dk_" + randomBytes(24).toString("hex");
  await q(
    `INSERT INTO keys (key, email, plan, quota, stripe_sub) VALUES ($1, $2, $3, $4, $5)`,
    [key, email ?? null, plan, PLANS[plan] ?? PLANS.free, sub ?? null],
  );
  return key;
}

/** Persisted, not per-boot: a fresh salt on every restart would silently reset
 *  the per-IP limit to nothing. */
export async function ipSalt(): Promise<string> {
  await q(`INSERT INTO meta (k, v) VALUES ('ip_salt', $1) ON CONFLICT (k) DO NOTHING`, [
    randomBytes(24).toString("hex"),
  ]);
  const { rows } = await q<{ v: string }>(`SELECT v FROM meta WHERE k = 'ip_salt'`);
  return rows[0].v;
}

export const FREE_PER_IP_HOURS = 24;
export const FREE_PER_DAY = Number(process.env.FREE_KEYS_PER_DAY ?? 200);

/** One free key per IP per day, plus a global daily ceiling. Neither stops
 *  someone rotating VPNs — nothing does. They bound the damage. */
export async function issueFreeKey(ipHash: string): Promise<{ key: string } | { error: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise concurrent issuance so two simultaneous requests can't both pass.
    await client.query(`LOCK TABLE free_issues IN SHARE ROW EXCLUSIVE MODE`);
    const recent = await client.query<{ n: string }>(
      `SELECT COUNT(*) n FROM free_issues WHERE ip_hash = $1 AND at > now() - ($2 || ' hours')::interval`,
      [ipHash, String(FREE_PER_IP_HOURS)],
    );
    if (Number(recent.rows[0].n) > 0) {
      await client.query("ROLLBACK");
      return { error: "A free key was already issued to this address today." };
    }
    const today = await client.query<{ n: string }>(
      `SELECT COUNT(*) n FROM free_issues WHERE day = current_date`,
    );
    if (Number(today.rows[0].n) >= FREE_PER_DAY) {
      await client.query("ROLLBACK");
      return { error: "Free keys for today are exhausted. Try again tomorrow." };
    }
    const key = "dk_" + randomBytes(24).toString("hex");
    await client.query(`INSERT INTO keys (key, plan, quota) VALUES ($1, 'free', $2)`, [
      key,
      PLANS.free,
    ]);
    await client.query(`INSERT INTO free_issues (ip_hash) VALUES ($1)`, [ipHash]);
    await client.query("COMMIT");
    return { key };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Fixed key for --stdio: the caller already owns the machine, so quota is a formality. */
export async function localAccount(): Promise<Account> {
  await q(
    `INSERT INTO keys (key, plan, quota) VALUES ('dk_local', 'local', 1000000000)
     ON CONFLICT (key) DO NOTHING`,
  );
  return (await auth("dk_local"))!;
}

export async function keyForSub(sub: string): Promise<string | null> {
  const { rows } = await q<{ key: string }>(
    `SELECT key FROM keys WHERE stripe_sub = $1 AND active`,
    [sub],
  );
  return rows[0]?.key ?? null;
}

export async function deactivateBySub(sub: string): Promise<void> {
  await q(`UPDATE keys SET active = FALSE WHERE stripe_sub = $1`, [sub]);
}

export async function auth(key: string): Promise<Account | null> {
  const { rows } = await q<Account>(
    `SELECT key, plan, quota FROM keys WHERE key = $1 AND active`,
    [key],
  );
  return rows[0] ?? null;
}

export async function usage(key: string): Promise<{ used: number; quota: number }> {
  const { rows } = await q<{ used: string; quota: number }>(
    `SELECT COALESCE(u.calls, 0) used, k.quota
     FROM keys k LEFT JOIN usage u ON u.key = k.key AND u.month = $2
     WHERE k.key = $1`,
    [key, month()],
  );
  return { used: Number(rows[0]?.used ?? 0), quota: rows[0]?.quota ?? 0 };
}

/** Consumes one call. Returns false when the monthly quota is spent.
 *  Single statement, so concurrent calls cannot both slip past the limit. */
export async function consume(acct: Account): Promise<boolean> {
  const { rows } = await q(
    `INSERT INTO usage (key, month, calls) VALUES ($1, $2, 1)
     ON CONFLICT (key, month) DO UPDATE SET calls = usage.calls + 1
     WHERE usage.calls < $3
     RETURNING calls`,
    [acct.key, month(), acct.quota],
  );
  return rows.length > 0;
}

export type Stats = {
  plans: { plan: string; active: number; cancelled: number }[];
  keysToday: number;
  keysWeek: number;
  freeToday: number;
  docsMonth: number;
  activeKeysMonth: number;
  top: { key: string; plan: string; calls: number; quota: number }[];
  recent: { key: string; plan: string; created_at: string }[];
};

export async function stats(): Promise<Stats> {
  const n = async (sql: string, params: unknown[] = []) =>
    Number((await q<{ n: string }>(sql, params)).rows[0].n);
  const [plans, keysToday, keysWeek, freeToday, docsMonth, activeKeysMonth, top, recent] =
    await Promise.all([
      q(`SELECT plan, COUNT(*) FILTER (WHERE active) active,
                COUNT(*) FILTER (WHERE NOT active) cancelled
         FROM keys WHERE plan <> 'local' GROUP BY plan ORDER BY plan`),
      n(`SELECT COUNT(*) n FROM keys WHERE created_at::date = current_date`),
      n(`SELECT COUNT(*) n FROM keys WHERE created_at > now() - interval '7 days'`),
      n(`SELECT COUNT(*) n FROM free_issues WHERE day = current_date`),
      n(`SELECT COALESCE(SUM(calls),0) n FROM usage WHERE month = $1`, [month()]),
      n(`SELECT COUNT(*) n FROM usage WHERE month = $1 AND calls > 0`, [month()]),
      q(`SELECT u.key, k.plan, u.calls, k.quota FROM usage u JOIN keys k ON k.key = u.key
         WHERE u.month = $1 AND u.calls > 0 ORDER BY u.calls DESC LIMIT 10`, [month()]),
      q(`SELECT key, plan, to_char(created_at, 'YYYY-MM-DD HH24:MI') created_at
         FROM keys WHERE plan <> 'local' ORDER BY created_at DESC LIMIT 10`),
    ]);
  return {
    plans: plans.rows.map((r) => ({
      plan: r.plan,
      active: Number(r.active),
      cancelled: Number(r.cancelled),
    })),
    keysToday,
    keysWeek,
    freeToday,
    docsMonth,
    activeKeysMonth,
    top: top.rows as Stats["top"],
    recent: recent.rows as Stats["recent"],
  };
}
