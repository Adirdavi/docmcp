import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { z } from "zod";

export const Block = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string(),
    level: z.number().int().min(1).max(4).default(1),
  }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("bullets"),
    items: z.array(z.string()).min(1),
    ordered: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
  }),
  z.object({ type: z.literal("pagebreak") }),
]);
export type Block = z.infer<typeof Block>;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
];

function cell(text: string, header: boolean, rtl: boolean) {
  return new TableCell({
    children: [
      new Paragraph({
        bidirectional: rtl,
        alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: header, rightToLeft: rtl })],
      }),
    ],
  });
}

function render(block: Block, rtl: boolean): Paragraph[] | Table[] {
  const dir = {
    bidirectional: rtl,
    alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
  };
  switch (block.type) {
    case "heading":
      return [
        new Paragraph({
          ...dir,
          heading: HEADINGS[block.level - 1],
          children: [new TextRun({ text: block.text, rightToLeft: rtl })],
        }),
      ];
    case "paragraph":
      return [
        new Paragraph({
          ...dir,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: block.text,
              bold: block.bold,
              italics: block.italic,
              rightToLeft: rtl,
            }),
          ],
        }),
      ];
    case "bullets":
      return block.items.map(
        (item) =>
          new Paragraph({
            ...dir,
            numbering: block.ordered
              ? { reference: "ordered", level: 0 }
              : undefined,
            bullet: block.ordered ? undefined : { level: 0 },
            children: [new TextRun({ text: item, rightToLeft: rtl })],
          }),
      );
    case "table":
      return [
        new Table({
          visuallyRightToLeft: rtl,
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: block.columns.map((c) => cell(c, true, rtl)),
            }),
            ...block.rows.map(
              (r) =>
                new TableRow({
                  // pad/trim so a ragged row from an LLM never corrupts the file
                  children: block.columns.map((_, i) =>
                    cell(r[i] ?? "", false, rtl),
                  ),
                }),
            ),
          ],
        }),
      ];
    case "pagebreak":
      return [new Paragraph({ pageBreakBefore: true })];
  }
}

// Hebrew, Arabic, Syriac, Thaana + Arabic presentation forms.
const RTL_CHARS = /[֐-׿؀-ۿ܀-ݏހ-޿יִ-﷿ﹰ-﻿]/;

function blockText(b: Block): string {
  switch (b.type) {
    case "heading":
    case "paragraph":
      return b.text;
    case "bullets":
      return b.items.join(" ");
    case "table":
      return b.columns.join(" ") + " " + b.rows.flat().join(" ");
    case "pagebreak":
      return "";
  }
}

/** Callers forget to pass rtl, and a left-aligned Hebrew document is plainly broken.
 *  Detect it from the content instead; an explicit flag still wins. */
export const looksRtl = (s: string) => RTL_CHARS.test(s);

export async function buildDocx(opts: {
  title?: string;
  blocks: Block[];
  rtl?: boolean;
}): Promise<Buffer> {
  const rtl =
    opts.rtl ?? looksRtl((opts.title ?? "") + " " + opts.blocks.map(blockText).join(" "));
  const children: (Paragraph | Table)[] = [];
  if (opts.title) children.push(...render({ type: "heading", text: opts.title, level: 1 }, rtl));
  for (const b of opts.blocks) children.push(...render(b, rtl));

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT }],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

export const Sheet = z.object({
  name: z.string().max(31),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  freezeHeader: z.boolean().default(true),
});
export type Sheet = z.infer<typeof Sheet>;

export async function buildXlsx(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    // Excel rejects these in sheet names; an LLM will send them eventually.
    const ws = wb.addWorksheet(s.name.replace(/[\\/*?:[\]]/g, "-") || "Sheet");
    ws.addRow(s.columns);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(s.columns.map((_, i) => r[i] ?? null));
    // Same reasoning as buildDocx: a Hebrew sheet running left-to-right is wrong,
    // and nobody remembers to ask for it.
    const rtl = looksRtl(s.name + " " + s.columns.join(" ") + " " + s.rows.flat().join(" "));
    ws.views = s.freezeHeader
      ? [{ state: "frozen", ySplit: 1, rightToLeft: rtl }]
      : [{ state: "normal", rightToLeft: rtl }];
    ws.columns.forEach((col, i) => {
      const widest = Math.max(
        s.columns[i]?.length ?? 0,
        ...s.rows.map((r) => String(r[i] ?? "").length),
      );
      col.width = Math.min(Math.max(widest + 2, 10), 60);
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
