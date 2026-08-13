import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

const db = new Database(process.env.DB_PATH ?? "docmcp.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    key        TEXT PRIMARY KEY,
    email      TEXT,
    plan       TEXT NOT NULL,
    quota      INTEGER NOT NULL,
    stripe_sub TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage (
    key   TEXT NOT NULL,
    month TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, month)
  );
  CREATE TABLE IF NOT EXISTS free_issues (
    ip_hash TEXT NOT NULL,
    day     TEXT NOT NULL,
    at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS free_issues_ip ON free_issues (ip_hash, at);
  CREATE INDEX IF NOT EXISTS free_issues_day ON free_issues (day);
`);

export const PLANS: Record<string, number> = {
  free: 10,
  starter: 100, // $10/mo
  pro: 500, // $30/mo
};

export type Account = { key: string; plan: string; quota: number };

const month = () => new Date().toISOString().slice(0, 7);

export function createKey(plan: string, email?: string, sub?: string): string {
  const key = "dk_" + randomBytes(24).toString("hex");
  db.prepare(
    `INSERT INTO keys (key, email, plan, quota, stripe_sub, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(key, email ?? null, plan, PLANS[plan] ?? PLANS.free, sub ?? null);
  return key;
}

/** Persisted, not per-boot: this machine auto-sleeps, and a fresh salt on every
 *  wake would silently reset the per-IP limit to nothing. */
export function ipSalt(): string {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('ip_salt', ?)`).run(
    randomBytes(24).toString("hex"),
  );
  return (db.prepare(`SELECT v FROM meta WHERE k = 'ip_salt'`).get() as { v: string }).v;
}

export const FREE_PER_IP_HOURS = 24;
export const FREE_PER_DAY = Number(process.env.FREE_KEYS_PER_DAY ?? 200);

/** One free key per IP per day, plus a global daily ceiling.
 *  Neither stops someone rotating VPNs — nothing does, and no free tier anywhere
 *  survives that. What this does is bound the damage: the casual "just make
 *  another key" loop is closed, and the worst case per day is a known number. */
export function issueFreeKey(ipHash: string): { key: string } | { error: string } {
  const tx = db.transaction((h: string) => {
    const recent = db
      .prepare(
        `SELECT COUNT(*) n FROM free_issues
         WHERE ip_hash = ? AND at > datetime('now', ?)`,
      )
      .get(h, `-${FREE_PER_IP_HOURS} hours`) as { n: number };
    if (recent.n > 0) {
      return { error: "A free key was already issued to this address today." };
    }
    const today = db
      .prepare(`SELECT COUNT(*) n FROM free_issues WHERE day = date('now')`)
      .get() as { n: number };
    if (today.n >= FREE_PER_DAY) {
      return { error: "Free keys for today are exhausted. Try again tomorrow." };
    }
    db.prepare(
      `INSERT INTO free_issues (ip_hash, day, at) VALUES (?, date('now'), datetime('now'))`,
    ).run(h);
    return { key: createKey("free") };
  });
  return tx(ipHash);
}

/** Fixed key for --stdio: the caller already owns the machine, so quota is a formality. */
export function localAccount(): Account {
  db.prepare(
    `INSERT OR IGNORE INTO keys (key, plan, quota, created_at)
     VALUES ('dk_local', 'local', 1000000000, datetime('now'))`,
  ).run();
  return auth("dk_local")!;
}

export function deactivateBySub(sub: string): void {
  db.prepare(`UPDATE keys SET active = 0 WHERE stripe_sub = ?`).run(sub);
}

export function keyForSub(sub: string): string | null {
  const row = db
    .prepare(`SELECT key FROM keys WHERE stripe_sub = ? AND active = 1`)
    .get(sub) as { key: string } | undefined;
  return row?.key ?? null;
}

export function auth(key: string): Account | null {
  const row = db
    .prepare(`SELECT key, plan, quota FROM keys WHERE key = ? AND active = 1`)
    .get(key) as Account | undefined;
  return row ?? null;
}

export function usage(key: string): { used: number; quota: number } {
  const row = db
    .prepare(`SELECT calls FROM usage WHERE key = ? AND month = ?`)
    .get(key, month()) as { calls: number } | undefined;
  const quota =
    (db.prepare(`SELECT quota FROM keys WHERE key = ?`).get(key) as
      | { quota: number }
      | undefined)?.quota ?? 0;
  return { used: row?.calls ?? 0, quota };
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

export function stats(): Stats {
  const q = <T>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as T[];
  const one = (sql: string, ...a: unknown[]) =>
    (db.prepare(sql).get(...a) as { n: number }).n;
  return {
    plans: q(
      `SELECT plan, SUM(active) active, SUM(1 - active) cancelled
       FROM keys WHERE plan != 'local' GROUP BY plan ORDER BY plan`,
    ),
    keysToday: one(`SELECT COUNT(*) n FROM keys WHERE date(created_at) = date('now')`),
    keysWeek: one(`SELECT COUNT(*) n FROM keys WHERE created_at > datetime('now','-7 days')`),
    freeToday: one(`SELECT COUNT(*) n FROM free_issues WHERE day = date('now')`),
    docsMonth: one(
      `SELECT COALESCE(SUM(calls),0) n FROM usage WHERE month = strftime('%Y-%m','now')`,
    ),
    activeKeysMonth: one(
      `SELECT COUNT(*) n FROM usage WHERE month = strftime('%Y-%m','now') AND calls > 0`,
    ),
    top: q(
      `SELECT u.key, k.plan, u.calls, k.quota FROM usage u JOIN keys k ON k.key = u.key
       WHERE u.month = strftime('%Y-%m','now') AND u.calls > 0
       ORDER BY u.calls DESC LIMIT 10`,
    ),
    recent: q(
      `SELECT key, plan, created_at FROM keys WHERE plan != 'local'
       ORDER BY created_at DESC LIMIT 10`,
    ),
  };
}

/** Consumes one call. Returns false when the monthly quota is spent. */
export function consume(acct: Account): boolean {
  const tx = db.transaction((a: Account) => {
    const m = month();
    db.prepare(
      `INSERT INTO usage (key, month, calls) VALUES (?, ?, 0)
       ON CONFLICT (key, month) DO NOTHING`,
    ).run(a.key, m);
    const { calls } = db
      .prepare(`SELECT calls FROM usage WHERE key = ? AND month = ?`)
      .get(a.key, m) as { calls: number };
    if (calls >= a.quota) return false;
    db.prepare(
      `UPDATE usage SET calls = calls + 1 WHERE key = ? AND month = ?`,
    ).run(a.key, m);
    return true;
  });
  return tx(acct);
}
