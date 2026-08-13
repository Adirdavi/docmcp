# Launch posts

Copy, edit to sound like you, post. Do not post all of them the same day — space
them out so you can tell which channel actually sends people.

Before posting anywhere: make sure `/keys/free` works and the landing page loads.
A dead link on launch day is the whole shot, wasted.

---

## 1. Show HN

**Title** (80 char limit, keep the "Show HN:" prefix):

```
Show HN: An MCP server that gives AI agents real .docx and .xlsx files
```

**URL:** `https://docmcp.fly.dev`

**First comment** — post this yourself immediately after submitting:

```
I kept asking agents for a report and getting a wall of Markdown back, so I
wrote the boring thing that was missing.

An LLM can write the words but it cannot assemble the file — a .docx is a zip
of XML parts and every byte has to land in the right place. So the model
returns formatted text and hopes you paste it into Word.

docmcp is an MCP server with three tools: create_docx, create_xlsx, usage.
You send structured blocks (headings, paragraphs, lists, tables, page breaks)
and get a real file back.

Two decisions that might be worth discussing:

1. It returns a download URL, not the file. A 200KB docx inlined as base64
   into a tool result costs the caller roughly 70k tokens. A link costs 30.
   Files are served for 24h and then deleted.

2. Right-to-left is detected from the content, not from a flag. Hebrew and
   Arabic documents come out broken in almost every tool I tried, and the
   reason is always that some caller forgot to set an option. Removing the
   option removes the bug class.

Free tier is 10 documents/month, no signup — POST /keys/free and you get a key.

Known gaps, so nobody is surprised: no PDF (good PDF output needs headless
Chrome or LibreOffice and triples the deploy — Word and Excel were the actual
gap), single machine with SQLite, and a lost key can't be recovered yet.

Happy to hear what breaks.
```

**Timing:** weekday, 8–10am US Eastern. You get one Show HN per project —
do not burn it on a day you can't sit and answer comments for a few hours.

---

## 2. r/mcp

**Title:**

```
Built an MCP server that outputs real Word and Excel files (free tier, no signup)
```

**Body:**

```
Agents are good at writing and bad at file formats — they hand you Markdown and
hope. This does the file part.

Three tools:
- create_docx — headings, paragraphs, bullet/numbered lists, tables, page breaks
- create_xlsx — multi-sheet, bold frozen header row, auto-filter, sized columns
- usage — what's left this month

Two things I'd do the same way again:

Returns a URL instead of the file. Base64-ing a 200KB docx into a tool result
burns ~70k of the caller's tokens for no reason.

RTL is auto-detected from the content instead of being a parameter. Hebrew and
Arabic docs are broken almost everywhere, and it's always because a caller
didn't pass a flag. Numbers stay numbers in xlsx too, which sounds obvious and
very often isn't.

It's on the official registry as io.github.Adirdavi/docmcp:

  "type": "http",
  "url": "https://docmcp.fly.dev/mcp",
  "headers": { "Authorization": "Bearer YOUR_KEY" }

Free key: curl -X POST https://docmcp.fly.dev/keys/free  (10 docs/month)

No PDF yet — deliberately. Everyone already ships Markdown→PDF; nobody ships
a decent .docx. Tell me if that's the wrong call.
```

---

## 3. The one that probably matters most — Hebrew / RTL

Your real edge is not "another document tool", it is that Hebrew comes out
right. That audience is not on r/mcp. Post this in Israeli dev communities
(Facebook groups, local Slack/Discord, LinkedIn) — and the same angle works
translated for Arabic-speaking dev communities.

```
כל מי שניסה לבקש מ-AI מסמך Word בעברית יודע איך זה נגמר: טקסט הפוך, טבלה
שבורה, יישור לשמאל, ורבע שעה של תיקונים ידניים.

בניתי שרת MCP שמייצר קבצי Word ו-Excel אמיתיים, והוא מזהה עברית לבד ומסדר
את הכיווניות בלי שצריך לבקש. מתחבר ל-Claude, ל-Cursor, או לכל סוכן שתומך ב-MCP.

חינם עד 10 מסמכים בחודש, בלי הרשמה:
https://docmcp.fly.dev

אשמח לדעת אם זה נשבר לכם על משהו.
```

---

## The comments are the launch

Upvotes do nothing. Answering fast, and honestly, is what makes a thread live.
These are the questions you will actually get. Answer in your own words — the
point is that none of them catch you cold.

**"Why not just use LibreOffice / pandoc / python-docx?"**
> You can, and if you're already running a server, do. This exists so an agent
> can produce a file without you deploying anything. The tool call is the whole
> product.

**"This is a thin wrapper around the `docx` npm package."**
> It is. The library is the easy part — what took the time was deciding the
> block schema an LLM can fill without breaking the file, padding ragged table
> rows, keeping numbers as numbers, and not making RTL a flag. Agreed that
> nothing here is hard; it just didn't exist as a tool.

**"Why no PDF?"**
> Everyone already ships Markdown→PDF. Nobody ships a decent .docx. Good PDF
> output needs headless Chrome or LibreOffice and triples the deploy, so it's
> waiting for a paying user to ask.

**"Why should I trust you with my documents?"**
> Files are generated, served for 24h, then deleted. Nothing is stored or used
> for anything else. Content passes through the server — if that's not
> acceptable, self-host it, the code is MIT on GitHub.

**"What stops me making a new free key forever?"**
> One per IP per day plus a global daily ceiling. Rotating VPNs beats that and
> nothing stops it. The limits bound the worst case, they don't eliminate it.

**"Single machine, SQLite, no HA?"**
> Correct. It has no users yet. Postgres and S3 when there's a reason.

**"Pricing seems high for generating a zip file."**
> Priced against the twenty minutes someone spends fixing a table by hand, not
> against my compute. Happy to be wrong — tell me what you'd pay.

If someone finds a real bug, say so and fix it that day, then reply in the
thread that it's fixed. That single move converts more skeptics than any
feature.

## What to watch

Open `/admin?token=…` the day you post. The only number that means anything is
**keys you did not issue yourself**. Upvotes are not customers.

If two weeks pass with no strangers calling it, the idea is answered — and it
cost a few dollars instead of three months. That is the point of launching
before wiring up payments.
