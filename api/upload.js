const pg = require("../lib/pg-connector");
const { json, readJson, importRows, requireOwner, safeLog } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  if (!(await requireOwner(req, res))) return;

  // Ensure database schema exists
  try { await pg.initSchema(); } catch (e) { console.error('Schema init error:', e.message); }
  try {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      const payload = await readMultipart(req, contentType);
      const results = [];
      for (const file of payload.files) {
        if (!/\.xlsx$/i.test(file.filename)) {
          return json(res, 400, { ok: false, error: "Upload file mentah di Vercel hanya untuk Excel .xlsx. File CSV tetap diproses dari browser." });
        }
        const rows = readXlsxRows(file.buffer);
        safeLog("upload_file_read", { filename: file.filename, rows: rows.length, bufferSize: file.buffer?.length || 0 });
        if (!rows.length) {
          return json(res, 400, { ok: false, error: `File ${file.filename} kosong atau tidak terbaca (${file.buffer?.length || 0} bytes). Pastikan file Excel valid.` });
        }
        // Accept store_name (snake_case dari script/browser) atau storeName (camelCase)
        const storeName = payload.fields.store_name || payload.fields.storeName || "";
        const kind = payload.fields.kind || "auto";
        const result = await importRows({
          storeName,
          kind,
          filename: file.filename || "upload.xlsx",
          rows,
        });
        results.push(result);
      }
      safeLog("upload_multipart_done", { files: payload.files.length, store: payload.fields.store_name || payload.fields.storeName, results: results.map(item => ({ kind: item.kind, rows: item.rows, updated: item.updated, adSpendRows: item.adSpendRows, adSpendTotal: item.adSpendTotal })) });
      pg.cacheDelete("split:%").catch(() => { });
      // Return compatible dengan script & browser: flat result jika 1 file, array jika multi
      if (results.length === 1) return json(res, 200, { ok: true, ...results[0], results });
      return json(res, 200, { ok: true, results });
    }
    const body = await readJson(req);
    safeLog("upload_json_body", { hasRows: !!(body && body.rows), rowsLen: body?.rows?.length, keys: body?.rows?.[0] ? Object.keys(body.rows[0]).slice(0, 5) : [] });
    if (!Array.isArray(body.rows)) {
      return json(res, 400, { ok: false, error: "Upload Vercel memakai pembaca Excel/CSV di browser. Refresh halaman lalu pilih file lagi." });
    }
    const result = await importRows({
      storeName: body.storeName,
      kind: body.kind || "auto",
      filename: body.filename || "upload",
      rows: body.rows,
    });
    safeLog("upload_json_result", { kind: result.kind, rows: result.rows, inserted: result.inserted });
    safeLog("upload_json_done", { filename: body.filename, store: body.storeName, kind: result.kind, rows: result.rows, updated: result.updated, adSpendRows: result.adSpendRows, adSpendTotal: result.adSpendTotal });
    pg.cacheDelete("split:%").catch(() => { });
    return json(res, 200, result);
  } catch (error) {
    safeLog("upload_error", { message: error.message, stack: String(error.stack || "").split("\n").slice(0, 4).join(" | ") });
    return json(res, 400, { ok: false, error: error.message });
  }
};

async function readBuffer(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "binary");
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

async function readMultipart(req, contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Boundary upload tidak ditemukan.");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const raw = await readBuffer(req);
  const fields = {};
  const files = [];
  for (const rawPart of splitBuffer(raw, boundary)) {
    let part = rawPart;
    if (!part.length || part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) continue;
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    if (part.slice(-2).toString() === "--") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString("utf8");
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString() === "\r\n") body = body.slice(0, -2);
    const name = (header.match(/name="([^"]+)"/i) || [])[1] || "";
    const filename = (header.match(/filename="([^"]*)"/i) || [])[1];
    if (!name) continue;
    if (filename !== undefined) {
      if (filename) files.push({ name, filename, buffer: body });
    } else {
      fields[name] = body.toString("utf8");
    }
  }
  return { fields, files };
}

function formatCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  return value == null ? "" : value;
}

function getSheetRange(XLSX, sheet) {
  const cells = Object.keys(sheet || {})
    .filter(key => key && key[0] !== "!")
    .map(key => XLSX.utils.decode_cell(key));
  if (!cells.length) return XLSX.utils.decode_range("A1:A1");
  return cells.reduce((range, cell) => ({
    s: { r: Math.min(range.s.r, cell.r), c: Math.min(range.s.c, cell.c) },
    e: { r: Math.max(range.e.r, cell.r), c: Math.max(range.e.c, cell.c) },
  }), { s: { ...cells[0] }, e: { ...cells[0] } });
}

function sheetHeaderTokens(XLSX, sheet) {
  const range = getSheetRange(XLSX, sheet);
  const tokens = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    const value = cell && (cell.w != null ? cell.w : cell.v);
    tokens.push(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
  }
  return tokens.join("|");
}

function pickSheet(XLSX, workbook) {
  if (workbook.SheetNames.includes("OrderSKUList")) return "OrderSKUList";
  if (workbook.SheetNames.includes("Detail pesanan")) return "Detail pesanan";
  if (workbook.SheetNames.includes("Daftar Pesanan")) return "Daftar Pesanan";
  const incomeSheet = workbook.SheetNames.find(name => {
    const tokens = sheetHeaderTokens(XLSX, workbook.Sheets[name]);
    const hasOrderId = tokens.includes("orderadjustmentid") || tokens.includes("idpesananpenyesuaian");
    const hasSettlement = tokens.includes("totalsettlementamount") || tokens.includes("jumlahpenyelesaianpembayaran");
    return hasOrderId && hasSettlement;
  });
  return incomeSheet || workbook.SheetNames[0];
}

function readXlsxRows(buffer) {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch (error) {
    throw new Error("Server belum punya dependency pembaca Excel. Tunggu deploy Vercel selesai lalu coba lagi.");
  }
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: true, nodim: true, sheetRows: 0 });
  const sheetName = pickSheet(XLSX, workbook);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  // Fix: TikTok sheets may have !ref smaller than actual data. Find actual range.
  let range = getSheetRange(XLSX, sheet);
  const keys = Object.keys(sheet).filter(k => k && k[0] !== "!");
  for (const key of keys) {
    try {
      const cell = XLSX.utils.decode_cell(key);
      if (cell.r > range.e.r) range.e.r = cell.r;
      if (cell.c > range.e.c) range.e.c = cell.c;
    } catch (e) { }
  }
  // Override sheet ref so sheet_to_json reads all rows
  sheet["!ref"] = XLSX.utils.encode_range(range);
  const headers = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
    const value = cell && (cell.w != null ? cell.w : formatCell(cell.v));
    headers.push(String(value || "").replace(/^\uFEFF/, "").replace(/\n/g, " ").trim());
  }
  const rows = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row = {};
    let hasValue = false;
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const header = headers[col - range.s.c];
      if (!header) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: col })];
      const value = cell && (cell.w != null ? cell.w : formatCell(cell.v));
      if (value !== "" && value != null) hasValue = true;
      row[header] = value == null ? "" : value;
    }
    if (hasValue) {
      // Skip description rows: check first column only
      const firstVal = String(Object.values(row)[0] || "").trim().toLowerCase();
      if (firstVal.includes("platform unique order") || firstVal.includes("current order status") ||
        firstVal.includes("id transaksi") || firstVal === "nama") continue;
      rows.push(row);
    }
  }
  return rows;
}
