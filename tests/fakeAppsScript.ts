// Lingkungan Apps Script tiruan untuk menguji apps-script/*.js di Node.
import { createHash, createHmac, createSign, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

type Cell = string | number | boolean | Date | null;

export class FakeSheet {
  rows: Cell[][] = [];
  formulas: string[] = [];
  name: string;
  constructor(name: string) { this.name = name; }
  private store(v: Cell): Cell {
    if (typeof v === 'string') {
      if (v.startsWith("'")) return v.slice(1); // Sheets menyimpan teks literal tanpa apostrof
      if (/^[=+\-@]/.test(v)) {
        this.formulas.push(v); // akan dievaluasi sebagai formula di Sheets sungguhan
        return v;
      }
    }
    return v;
  }
  appendRow(values: Cell[]) { this.rows.push(values.map((v) => this.store(v))); }
  getLastRow() { return this.rows.length; }
  setFrozenRows() {}
  getDataRange() { return { getValues: () => this.rows.map((r) => r.map((c) => (c === undefined ? '' : c))) }; }
  getRange(row: number, col: number) {
    return { setValue: (v: Cell) => { const r = this.rows[row - 1]; while (r.length < col) r.push(''); r[col - 1] = this.store(v); } };
  }
}

export class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  getSheetByName(n: string) { return this.sheets.get(n) ?? null; }
  insertSheet(n: string) { const s = new FakeSheet(n); this.sheets.set(n, s); return s; }
}

const signed = (buf: Buffer) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));

export function loadAppsScript(props: Record<string, string> = {}) {
  const ss = new FakeSpreadsheet();
  const properties = new Map(Object.entries({ SHEET_ID: 'test-sheet', ...props }));
  const cache = new Map<string, { v: string; exp: number }>();
  let clock = Date.now();

  const ctx: Record<string, unknown> = {
    console: { log() {}, error() {} },
    SpreadsheetApp: { openById: (id: string) => { if (id !== 'test-sheet') throw new Error('bad sheet id'); return ss; } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => properties.get(k) ?? null,
        setProperty: (k: string, v: string) => properties.set(k, v),
        deleteProperty: (k: string) => properties.delete(k),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => { const e = cache.get(k); return e && e.exp > clock ? e.v : null; },
        put: (k: string, v: string, ttl: number) => cache.set(k, { v, exp: clock + ttl * 1000 }),
        remove: (k: string) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s: string) => ({ setMimeType: () => ({ content: s }) }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_a: string, text: string) => signed(createHash('sha256').update(text, 'utf8').digest()),
      computeHmacSha256Signature: (value: string, key: string) => signed(createHmac('sha256', key).update(value, 'utf8').digest()),
      computeRsaSha256Signature: (value: string, pem: string) => signed(createSign('RSA-SHA256').update(value, 'utf8').sign(pem)),
      base64EncodeWebSafe: (data: string | number[]) =>
        (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map((b) => (b < 0 ? b + 256 : b)))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s: string) => signed(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (bytes: number[]) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('utf8') }),
      formatDate: (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
    },
  };
  vm.createContext(ctx);
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    vm.runInContext(readFileSync(join(dir, f), 'utf8'), ctx, { filename: f });
  }
  const call = (body: Record<string, unknown>) => {
    const res = (ctx.doPost as (e: unknown) => { content: string })({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(res.content) as { ok: boolean; data?: any; error?: string };
  };
  return {
    ctx, ss, properties, call,
    advance: (ms: number) => { clock += ms; },
    run: <T>(fn: string, ...args: unknown[]) => (ctx[fn] as (...a: unknown[]) => T)(...args),
  };
}
