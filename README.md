# docmcp

**Live: https://docmcp.fly.dev** — free key at `POST /keys/free`, 10 docs/month.
Paid: $10/mo for 100, $30/mo for 500. Quotas live in `PLANS` in [src/store.ts](src/store.ts).

A paid MCP server that turns structured data into **real** `.docx` and `.xlsx` files.
Agents are good at prose and bad at file formats — they emit Markdown and hope. This
gives them a tool that returns a Word or Excel file with actual headings, tables,
bold headers, frozen panes and RTL support.

Returns a short-lived download URL rather than a base64 blob: a 200KB docx inlined
into a tool result costs the caller ~70k tokens.

Two modes, one codebase:

- **`--stdio`** — local client (Claude Desktop / Code). No auth, no quota, no expiry;
  files are written to `OUT_DIR` and the tool returns the path.
- **default** — hosted HTTP at `/mcp`. API key required, quota metered, files served
  as URLs that expire after 24h. This is the product.

## Local

```bash
npm install
```

Already registered in Claude Desktop as `docmcp` (output → `~/Documents/docmcp`).
To register elsewhere:

```json
{
  "mcpServers": {
    "docmcp": {
      "command": "/usr/local/bin/node",
      "args": ["<repo>/node_modules/tsx/dist/cli.mjs", "<repo>/src/index.ts", "--stdio"],
      "env": { "DB_PATH": "<repo>/docmcp.db", "OUT_DIR": "<somewhere>" }
    }
  }
}
```

Absolute paths matter — the client launches with a minimal `PATH`.

## Hosted

```bash
npm start          # http://localhost:8787/mcp
curl -X POST localhost:8787/keys/free
```

```json
{
  "mcpServers": {
    "docmcp": {
      "type": "http",
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer dk_..." }
    }
  }
}
```

## Tools

| Tool | Does |
|---|---|
| `create_docx` | headings, paragraphs, bullet/numbered lists, tables, page breaks, `rtl` for Hebrew/Arabic |
| `create_xlsx` | multi-sheet, bold + frozen header, auto-filter, sized columns, numbers stay numbers |
| `usage` | calls used / quota this month |

## Env

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8787` | |
| `BASE_URL` | `http://localhost:$PORT` | Must be the public URL — it goes in download links |
| `DB_PATH` | `docmcp.db` | SQLite |
| `OUT_DIR` | `out` | Generated files, swept hourly, 24h TTL |
| `STRIPE_SECRET_KEY` | — | Omit to run without billing |
| `STRIPE_WEBHOOK_SECRET` | — | For `/stripe/webhook` |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` | — | Price IDs behind `/buy/:plan` |

Plans and quotas live in `PLANS` in [src/store.ts](src/store.ts).

## Deploy

Any Docker host. **A volume must be mounted at `/data`** — the SQLite key database and
generated files live there, and a container filesystem is wiped on every redeploy.
Losing it means every paying customer's key stops working.

```bash
fly launch --no-deploy && fly volumes create data --size 1
fly secrets set BASE_URL=https://your-app.fly.dev STRIPE_SECRET_KEY=sk_live_...
fly deploy
```

`BASE_URL` must be the public URL — it is baked into every download link handed to a
client. Getting it wrong produces links to `localhost`.

## Billing flow

`/buy/starter` → Stripe Checkout → webhook `checkout.session.completed` → key issued →
customer lands on `/success` and **sees the key there**. No email provider needed.
`customer.subscription.deleted` deactivates it. There are no user accounts: the key
is the account.

## Test

```bash
npm test
```

Covers both generators (including a ragged table row and a `/` in a sheet name — both
things an LLM will send eventually), number preservation through an xlsx round-trip,
and that quota stops exactly at the plan limit.

## Known gaps

- **No PDF.** Good PDF output needs headless Chrome or LibreOffice, which triples the
  deploy. Word and Excel are the actual gap — everyone already ships Markdown→PDF.
  Add it when a paying user asks.
- **A lost key cannot be recovered.** It is shown once on `/success`. Add email
  delivery or a "resend by email" route when the first customer asks.
- **Files and DB are on local disk.** Fine for one box with a volume; move to S3 and
  Postgres when you run two.
- **Free keys are rate limited, not abuse-proof.** One per IP per 24h plus a global
  daily ceiling (`FREE_KEYS_PER_DAY`, default 200). Rotating VPNs still defeats it —
  nothing stops that, and no free tier anywhere survives a determined attacker. The
  limits exist to bound the worst case, not to eliminate it.
- **`/admin` needs `ADMIN_TOKEN`.** Unset, the route 404s, so an unconfigured deploy
  never exposes it. Visit `/admin?token=…`.
