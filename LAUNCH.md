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

**URL:** `https://docmcp.onrender.com`

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
gap), single instance, and a lost key can't be recovered yet.

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
  "url": "https://docmcp.onrender.com/mcp",
  "headers": { "Authorization": "Bearer YOUR_KEY" }

Free key: curl -X POST https://docmcp.onrender.com/keys/free  (10 docs/month)

No PDF yet — deliberately. Everyone already ships Markdown→PDF; nobody ships
a decent .docx. Tell me if that's the wrong call.
```

---

## 3. Hebrew — LinkedIn

Your real edge is not "another document tool", it is that Hebrew and Arabic come
out right. That audience is not on r/mcp, and LinkedIn has no karma gate.

LinkedIn cuts the post off after ~2 lines behind a "see more" link, so the hook
has to land before it. Everything below is written for that.

```
כל מי שביקש מ-AI מסמך Word בעברית יודע איך זה נגמר.

טקסט הפוך, טבלה שבורה, יישור לשמאל — ורבע שעה של תיקונים ידניים על משהו
שאמור היה לקחת שנייה.

הסיבה פשוטה: מודל שפה יודע לכתוב מילים, אבל לא לבנות קובץ. קובץ Word הוא
ארכיון דחוס עם עשרות קבצי XML בפנים, וכל בית חייב לשבת במקום הנכון. אז המודל
מחזיר טקסט מעוצב ומקווה שמישהו יעתיק אותו לוורד.

בניתי שרת MCP שפותר בדיוק את החלק הזה. הוא מייצר קבצי Word ו-Excel אמיתיים,
והוא מזהה עברית לבד ומסדר את הכיווניות בלי שצריך לבקש.

הפרט שהכי חשוב לי: זיהוי הכיווניות הוא לא פרמטר שאפשר לשכוח להעביר. הוא נגזר
מהתוכן עצמו — כי כל פעם שראיתי מסמך עברי שבור, הסיבה הייתה שמישהו שכח דגל.

מתחבר ל-Claude, ל-Cursor, או לכל סוכן שתומך ב-MCP. חינם עד 10 מסמכים בחודש,
בלי הרשמה.

https://docmcp.onrender.com

הקוד פתוח: https://github.com/Adirdavi/docmcp

אשמח לדעת אם זה נשבר לכם על משהו.
```

**Two options for the link.** LinkedIn is widely believed to show posts with
outbound links to fewer people. If you care, move both URLs to your own first
comment and end the post with "לינק בתגובה הראשונה". Test it once each way —
you have two posts to spend, this one and the Arabic one.

---

## 4. Arabic

Same message, ~400 million speakers instead of ~9 million. The pain is worse in
Arabic than in Hebrew: connected letter forms and Arabic-Indic digits (٢٠٢٦) break
in tools that treat text as left-to-right, not just the alignment.

Verified in production: a full Arabic document — heading, paragraph, numbered
list, table — comes out with every paragraph right-aligned, the table laid out
right-to-left, and the digits intact, with no flag passed.

Post in Arabic-speaking developer communities on LinkedIn and X.

```
كل من طلب من نموذج ذكاء اصطناعي تقريرًا بصيغة Word بالعربية يعرف كيف ينتهي الأمر.

نص معكوس، جدول مكسور، محاذاة إلى اليسار، وربع ساعة من التصحيح اليدوي.

السبب بسيط: النموذج يجيد كتابة الكلمات، لكنه لا يستطيع بناء الملف. ملف Word هو
في الحقيقة أرشيف مضغوط يحتوي على عشرات ملفات XML، وكل جزء يجب أن يكون في مكانه
الصحيح. لذلك يعيد النموذج نصًا منسقًا ويأمل أن ينسخه أحد إلى Word.

بنيت خادم MCP يعالج هذا الجزء تحديدًا. ينشئ ملفات Word و Excel حقيقية، ويكتشف
العربية تلقائيًا فيضبط اتجاه النص دون أن تطلب ذلك.

التفصيل الأهم بالنسبة لي: اتجاه النص ليس خيارًا يمكن نسيانه. يُستنتج من المحتوى
نفسه — لأن كل مستند عربي مكسور رأيته كان سببه أن أحدًا نسي تمرير خيار.

يعمل مع Claude و Cursor وأي وكيل يدعم MCP. مجاني حتى ١٠ مستندات شهريًا، بدون تسجيل.

https://docmcp.onrender.com

الكود مفتوح المصدر: https://github.com/Adirdavi/docmcp

سيسعدني أن تخبروني إن وجدتم أي خلل.
```

**Before you post this:** have an Arabic speaker read it. The technical claims are
verified, the grammar is not — a post in shaky Arabic aimed at people who care
about Arabic being handled properly undercuts the whole point.

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

**"Single instance, no HA?"**
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
