import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildDocx, buildXlsx } from "./src/docs.js";

const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b; // docx/xlsx are zips
const unzipDoc = async (b: Buffer) =>
  (await JSZip.loadAsync(b)).file("word/document.xml")!.async("string");

// --- docx: renders every block type, and survives a ragged table from an LLM ---
const docx = await buildDocx({
  title: "Q3 Report",
  rtl: false,
  blocks: [
    { type: "heading", text: "Summary", level: 2 },
    { type: "paragraph", text: "Revenue grew.", bold: true },
    { type: "bullets", items: ["one", "two"], ordered: true },
    { type: "table", columns: ["Region", "Rev", "Notes"], rows: [["EU", "120"], ["US", "90", "x", "extra"]] },
    { type: "pagebreak" },
  ],
});
assert.ok(isZip(docx), "docx is not a zip");
assert.ok(docx.length > 5000, "docx suspiciously small");

const rtl = await buildDocx({ title: "דוח", blocks: [{ type: "paragraph", text: "שלום" }], rtl: true });
assert.ok(isZip(rtl) && rtl.length > 5000, "rtl docx broken");

// --- RTL must be detected from content, not left to the caller to remember ---
// docx emits <w:bidi/> when on and <w:bidi w:val="false"/> when off — match only the former.
const hasBidi = async (o: Parameters<typeof buildDocx>[0]) => {
  const xml = await unzipDoc(await buildDocx(o));
  return /<w:bidi\/>/.test(xml) && /<w:jc w:val="right"\/>/.test(xml);
};
assert.ok(await hasBidi({ blocks: [{ type: "paragraph", text: "שלום עולם" }] }), "Hebrew not auto-detected");
assert.ok(await hasBidi({ blocks: [{ type: "table", columns: ["אזור"], rows: [["צפון"]] }] }), "Hebrew in table not detected");
assert.ok(!(await hasBidi({ blocks: [{ type: "paragraph", text: "hello world" }] })), "English wrongly marked RTL");
assert.ok(!(await hasBidi({ blocks: [{ type: "paragraph", text: "שלום" }], rtl: false })), "explicit rtl:false ignored");

// --- xlsx: numbers must survive as numbers, sheet name must be sanitized ---
const xlsx = await buildXlsx([
  {
    name: "Sales/2026",
    columns: ["Item", "Qty", "Price"],
    rows: [["Widget", 3, 9.5], ["Gadget", 10, 2]],
    freezeHeader: true,
  },
]);
assert.ok(isZip(xlsx), "xlsx is not a zip");

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(xlsx as any);
const ws = wb.worksheets[0];
assert.equal(ws.name, "Sales-2026", "sheet name not sanitized");
assert.equal(ws.getCell("B2").value, 3);
assert.equal(ws.getCell("C2").value, 9.5);
assert.equal(typeof ws.getCell("B2").value, "number", "numbers became strings");
assert.equal(ws.getRow(1).font?.bold, true, "header not bold");

// --- database-backed checks, only when a throwaway Postgres is provided ---
// Run against a scratch database: TEST_DATABASE_URL=postgres://... npm test
if (!process.env.TEST_DATABASE_URL) {
  console.log("ok — document checks passed (set TEST_DATABASE_URL to also run store checks)");
} else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const store = await import("./src/store.js");
  await store.init();
  // These tests count rows globally, so they need a database of their own.
  await store.reset();

  const key = await store.createKey("free");
  const acct = (await store.auth(key))!;
  assert.ok(acct, "key not readable back");
  for (let i = 0; i < acct.quota; i++)
    assert.equal(await store.consume(acct), true, `call ${i} rejected early`);
  assert.equal(await store.consume(acct), false, "quota not enforced");
  assert.deepEqual(await store.usage(key), { used: acct.quota, quota: acct.quota });

  // --- free keys: one per address per day, and a global ceiling ---
  assert.ok("key" in (await store.issueFreeKey("ip-aaa")), "first free key refused");
  assert.ok("error" in (await store.issueFreeKey("ip-aaa")), "same address got a second key");
  assert.ok("key" in (await store.issueFreeKey("ip-bbb")), "a different address was blocked");
  for (let i = 0; i < store.FREE_PER_DAY; i++) await store.issueFreeKey("ip-" + i);
  assert.ok("error" in (await store.issueFreeKey("ip-fresh")), "daily ceiling not enforced");

  // --- the salt must be stable, or the per-IP limit resets on every restart ---
  const salt = await store.ipSalt();
  assert.equal(salt, await store.ipSalt(), "salt not stable");
  assert.ok(salt.length >= 32, "salt too short");

  await store.stats(); // every dashboard query must at least parse
  await store.close();
  console.log("ok — all checks passed (documents + store)");
}
