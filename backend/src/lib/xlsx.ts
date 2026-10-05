import { inflateRawSync } from 'node:zlib';

/**
 * Just enough of the .xlsx format to read the Texas Comptroller's tax rate
 * workbooks: unzip in memory, then the shared strings and one sheet's cells.
 * No styles, formulas or dates; every cell comes back as its text.
 */

/** The files inside a zip archive, by name. Only stored and deflated entries, which is all Excel writes. */
export function unzip(data: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // The end-of-central-directory record sits in the last 64 KB.
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file');
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (data.readUInt32LE(at) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, inflateRawSync(raw));
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function xmlText(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code] ?? match;
  });
}

/** The text of every <t> inside one element, joined (rich text splits a string into runs). */
function runs(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1] ?? '')).join('');
}

export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1] ?? ''));
}

/** Column index from a cell reference: A1 → 0, AB7 → 27. */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const char of ref.replace(/\d+$/, '')) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

/** One worksheet's cells as rows of text, blank cells as ''. */
export function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of (row[1] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = strings[Number(value)] ?? '';
      else if (type === 'inlineStr') text = runs(body);
      else if (value != null) text = xmlText(value);
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push('');
      cells[index] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/** The first worksheet of a workbook, as rows of text. */
export function readFirstSheet(data: Buffer): string[][] {
  const files = unzip(data);
  const strings = files.has('xl/sharedStrings.xml') ? sharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8')) : [];
  const sheet = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheet) throw new Error('Workbook has no worksheet');
  return sheetRows(files.get(sheet)!.toString('utf8'), strings);
}
