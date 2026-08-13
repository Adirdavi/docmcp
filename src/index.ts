import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { z } from "zod";
import { Block, Sheet, buildDocx, buildXlsx } from "./docs.js";
import * as store from "./store.js";

const STDIO = process.argv.includes("--stdio");
const PORT = Number(process.env.PORT ?? 8787);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const OUT = path.resolve(process.env.OUT_DIR ?? "out");
const TTL_MS = 24 * 60 * 60 * 1000;
await store.init();
// Without a salt, hashed IPs are trivially reversible — the whole space is enumerable.
// Persisted in the DB so it survives the machine sleeping and waking.
const IP_SALT = await store.ipSalt();

fs.mkdirSync(OUT, { recursive: true });

// ---------- file drop ----------
// Hosted mode returns a short-lived URL, not a base64 blob: a 200KB docx inlined
// into a tool result would cost the caller ~70k tokens. Stdio mode returns a path.
const NAME_RE = /^[a-f0-9]{32}__[A-Za-z0-9._-]+$/;

function save(buf: Buffer, name: string, ext: string): string {
  // Disk names stay ASCII so the download route can validate them cheaply. A fully
  // non-Latin title (Hebrew, Arabic, CJK) sanitises down to punctuation, so fall
  // back rather than serve a file called "---.docx".
  const ascii = name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  const safe = (/[A-Za-z0-9]/.test(ascii) ? ascii : "document") + `.${ext}`;
  const file = `${randomBytes(16).toString("hex")}__${safe}`;
  fs.writeFileSync(path.join(OUT, file), buf);
  return file;
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const f of fs.readdirSync(OUT)) {
    const p = path.join(OUT, f);
    if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
  }
}

// ---------- MCP ----------
function buildServer(acct: store.Account) {
  const server = new McpServer({ name: "docmcp", version: "0.1.0" });

  const deliver = async (buf: Buffer, file: string, kind: string) => {
    const kb = Math.round(buf.length / 1024);
    const { used, quota } = await store.usage(acct.key);
    const where = STDIO
      ? `Saved to: ${path.join(OUT, file)}`
      : `Download (expires in 24h): ${BASE_URL}/f/${file}`;
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Created ${kind} (${kb} KB)\n${where}` +
            (STDIO ? "" : `\nUsage: ${used}/${quota} this month.`),
        },
      ],
    };
  };

  const overQuota = () => ({
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Monthly quota of ${acct.quota} documents is spent. Upgrade at ${BASE_URL}/pricing`,
      },
    ],
  });

  server.registerTool(
    "create_docx",
    {
      title: "Create a Word document",
      description:
        "Build a real .docx file from structured blocks (headings, paragraphs, bullet/numbered lists, tables, page breaks). " +
        "Use this instead of emitting Markdown whenever the user wants an actual Word file. " +
        "Right-to-left layout is detected automatically from the content — Hebrew and Arabic " +
        "documents come out correctly without passing anything. Only set rtl to override.",
      inputSchema: {
        blocks: z.array(Block).min(1).describe("Document body, in order"),
        title: z.string().optional().describe("Optional H1 rendered at the top"),
        filename: z.string().optional().describe("Suggested file name, e.g. 'q3-report'"),
        rtl: z.boolean().optional().describe("Right-to-left layout (Hebrew/Arabic)"),
      },
    },
    async ({ blocks, title, filename, rtl }) => {
      if (!(await store.consume(acct))) return overQuota();
      const buf = await buildDocx({ title, blocks, rtl });
      return deliver(buf, save(buf, filename ?? title ?? "document", "docx"), "Word document");
    },
  );

  server.registerTool(
    "create_xlsx",
    {
      title: "Create an Excel workbook",
      description:
        "Build a real .xlsx file with one or more sheets, bold headers, frozen header row, auto-filter and sized columns. " +
        "Numbers stay numbers — send them as numbers, not strings.",
      inputSchema: {
        sheets: z.array(Sheet).min(1).describe("One entry per worksheet"),
        filename: z.string().optional().describe("Suggested file name, e.g. 'sales-2026'"),
      },
    },
    async ({ sheets, filename }) => {
      if (!(await store.consume(acct))) return overQuota();
      const buf = await buildXlsx(sheets);
      return deliver(buf, save(buf, filename ?? sheets[0].name, "xlsx"), "Excel workbook");
    },
  );

  server.registerTool(
    "usage",
    { title: "Check remaining quota", description: "Documents used and remaining this month.", inputSchema: {} },
    async () => {
      const { used, quota } = await store.usage(acct.key);
      return {
        content: [
          { type: "text" as const, text: `${used}/${quota} documents used this month (plan: ${acct.plan}).` },
        ],
      };
    },
  );

  return server;
}

// ---------- HTTP ----------
function startHttp() {
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();

  const app = express();
  const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

  // Must precede express.json(): Stripe signature checks need the raw body.
  app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe) return res.sendStatus(503);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"] as string,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch (err) {
      return res.status(400).send(`Webhook signature failed: ${(err as Error).message}`);
    }

    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const plan = s.metadata?.plan ?? "starter";
      const key = await store.createKey(plan, s.customer_details?.email ?? undefined, String(s.subscription ?? ""));
      console.log(`issued ${plan} key for ${s.customer_details?.email}: ${key}`);
      // ponytail: key is logged, not emailed — wire an email provider before launch.
    }
    if (event.type === "customer.subscription.deleted") {
      await store.deactivateBySub(event.data.object.id);
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: "4mb" }));
  app.use(express.static(new URL("../public", import.meta.url).pathname));
  app.get("/pricing", (_req, res) => res.redirect("/#pricing"));

  app.post("/mcp", async (req, res) => {
    const acct = await store.auth(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    if (!acct) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Missing or invalid API key. Get one at " + BASE_URL },
        id: null,
      });
    }
    const server = buildServer(acct);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.all("/mcp", (_req, res) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST" }, id: null }),
  );

  app.get("/f/:file", (req, res) => {
    const { file } = req.params;
    if (!NAME_RE.test(file)) return res.sendStatus(400);
    const p = path.join(OUT, file);
    if (!fs.existsSync(p)) return res.status(404).send("Expired or not found");
    res.download(p, file.slice(34));
  });

  app.post("/keys/free", async (req, res) => {
    // Fly terminates TLS upstream, so req.ip is the proxy. Hashed, not stored raw —
    // the landing page promises nothing is kept, and an IP is personal data.
    const ip = String(req.headers["fly-client-ip"] ?? req.socket.remoteAddress ?? "");
    const hash = createHash("sha256").update(IP_SALT + ip).digest("hex").slice(0, 32);
    const result = await store.issueFreeKey(hash);
    if ("error" in result) return res.status(429).json(result);
    res.json({ key: result.key, quota: store.PLANS.free });
  });

  app.get("/buy/:plan", async (req, res) => {
    const price = process.env[`STRIPE_PRICE_${req.params.plan.toUpperCase()}`];
    if (!stripe || !price) return res.status(404).send("Unknown plan");
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      metadata: { plan: req.params.plan },
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/#pricing`,
    });
    res.redirect(303, session.url!);
  });

  // Shows the key on the success page instead of emailing it — removes an entire
  // dependency. The webhook may not have landed yet, hence the retry meta refresh.
  app.get("/success", async (req, res) => {
    const id = String(req.query.session_id ?? "");
    if (!stripe || !id) return res.redirect("/");
    const session = await stripe.checkout.sessions.retrieve(id);
    const key = session.subscription ? await store.keyForSub(String(session.subscription)) : null;
    const shell = (body: string) =>
      `<!doctype html><meta charset=utf-8><title>docmcp</title>` +
      `<body style="font:16px/1.6 system-ui;max-width:40rem;margin:4rem auto;padding:0 1.25rem">${body}`;
    res.type("html").send(
      key
        ? shell(
            `<h1>You're in.</h1><p>This is your API key. Save it now — it is not shown again.</p>` +
              `<pre style="padding:1rem;border:1px solid #ccc;border-radius:8px;overflow-x:auto">${key}</pre>` +
              `<p><a href="/">Setup instructions</a></p>`,
          )
        : shell(`<meta http-equiv="refresh" content="3"><h1>Issuing your key…</h1><p>This page refreshes itself.</p>`),
    );
  });

  app.get("/healthz", (_req, res) => res.send("ok"));

  // Disabled unless ADMIN_TOKEN is set, so an unconfigured deploy is never exposed.
  app.get("/admin", async (req, res) => {
    const token = process.env.ADMIN_TOKEN;
    if (!token) return res.sendStatus(404);
    if (String(req.query.token ?? "") !== token) return res.sendStatus(404);

    const s = await store.stats();
    const esc = (v: unknown) => String(v).replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`);
    const tile = (label: string, value: unknown, note = "") =>
      `<div class=t><span>${label}</span><b>${esc(value)}</b><i>${esc(note)}</i></div>`;
    const rows = (head: string[], data: unknown[][]) =>
      `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>` +
      (data.length
        ? data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan=${head.length} class=empty>nothing yet</td></tr>`) +
      `</table>`;

    res.type("html").send(`<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>docmcp · admin</title><style>
:root{--bg:#08080c;--p:#101018;--l:#24242f;--fg:#ececf2;--m:#8f8fa3;--a:#7c5cff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:15px/1.6 ui-sans-serif,system-ui;padding:2.5rem 1.5rem;max-width:60rem;margin:0 auto}
h1{font-size:1.4rem;letter-spacing:-.02em;margin-bottom:.25rem}
.sub{color:var(--m);font-size:.85rem;margin-bottom:2rem}
h2{font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--a);margin:2.25rem 0 .75rem}
.tiles{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))}
.t{background:var(--p);border:1px solid var(--l);border-radius:12px;padding:1rem}
.t span{display:block;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--m)}
.t b{display:block;font-size:1.9rem;font-weight:650;letter-spacing:-.03em;margin-top:.2rem}
.t i{font-style:normal;font-size:.75rem;color:var(--m)}
table{width:100%;border-collapse:collapse;background:var(--p);border:1px solid var(--l);border-radius:12px;overflow:hidden;font-size:.86rem}
th{text-align:left;color:var(--m);font-weight:500;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;padding:.6rem .8rem;border-bottom:1px solid var(--l)}
td{padding:.55rem .8rem;border-bottom:1px solid var(--l);font-family:ui-monospace,monospace;font-size:.8rem}
tr:last-child td{border-bottom:0}
.empty{color:var(--m);font-family:inherit;text-align:center;padding:1.25rem}
</style>
<h1>docmcp · admin</h1>
<div class=sub>${esc(new Date().toISOString().replace("T", " ").slice(0, 16))} UTC · auto-refreshes every 60s</div>
<meta http-equiv=refresh content=60>

<h2>Right now</h2>
<div class=tiles>
  ${tile("Docs this month", s.docsMonth)}
  ${tile("Keys used", s.activeKeysMonth, "distinct, this month")}
  ${tile("New keys today", s.keysToday)}
  ${tile("New keys · 7d", s.keysWeek)}
  ${tile("Free issued today", `${s.freeToday}/${store.FREE_PER_DAY}`)}
</div>

<h2>Plans</h2>
${rows(["plan", "active", "cancelled"], s.plans.map((p) => [p.plan, p.active, p.cancelled]))}

<h2>Heaviest users this month</h2>
${rows(["key", "plan", "calls", "quota"], s.top.map((t) => [t.key.slice(0, 14) + "…", t.plan, t.calls, t.quota]))}

<h2>Newest keys</h2>
${rows(["key", "plan", "created"], s.recent.map((r) => [r.key.slice(0, 14) + "…", r.plan, r.created_at]))}
`);
  });

  app.listen(PORT, () => console.log(`docmcp on ${BASE_URL}/mcp`));
}

if (STDIO) {
  // Local client (Claude Desktop / Code). No auth, no quota, no expiry —
  // it is the owner's own machine. stdout is reserved for JSON-RPC.
  await buildServer(await store.localAccount()).connect(new StdioServerTransport());
} else {
  startHttp();
}
