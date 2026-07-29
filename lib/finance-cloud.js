const crypto = require("crypto");
const pg = require("./pg-connector");

const DEFAULT_STORES = ["ventura", "giftyours", "custombase"];
const DEFAULT_STORE = "ventura";
const OWNER_PIN_SALT = "pare-finance-dashboard";
let generatedIdCounter = 0;

function configuredStores(stores = []) {
  const merged = [...DEFAULT_STORES, ...(Array.isArray(stores) ? stores : [])]
    .map(store => normalizeStore(store))
    .filter(Boolean);
  return Array.from(new Set(merged));
}

const SECRET_TOTAL_KEYS = [
  "profit",
  "profitBeforeAds",
  "adSpend",
  "adSpendTopup",
  "adSpendSettlement",
  "settlementAdSpend",
  "sellerDiscount",
  "cancelledAmount",
  "platformFee",
  "platformFeeFinal",
  "platformFeeEstimated",
  "platformDiscount",
  "hpp",
  "packing",
  "refund",
  "settlement",
  "finalProfit",
  "estimatedProfit",
  "finalProfitBeforeAds",
  "estimatedProfitBeforeAds",
  "finalAdSpend",
  "estimatedAdSpend",
  "finalMargin",
  "estimatedMargin",
  "bookPlatformFee",
  "bookPlatformFeeFinal",
  "bookPlatformFeeEstimated",
  "bookHpp",
  "bookPacking",
  "bookSettlement",
  "bookHeld",
  "bookProfit",
  "bookProfitBeforeAds",
  "bookAdSpend",
  "bookMargin",
  "bookCancelledAmount",
];

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function nowIso() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" });
}

function generatedBigIntId() {
  generatedIdCounter = (generatedIdCounter + 1) % 1_000_000;
  return `${Date.now()}${String(generatedIdCounter).padStart(6, "0")}`;
}

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function dateOffsetIso(days, base = todayIso()) {
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Normalize any date-like value to YYYY-MM-DD for reliable string comparison
function normalizeDateForFilter(value) {
  if (!value) return "";
  const raw = String(value).trim();
  // Already ISO or slash format: 2026-05-22 or 2026/05/22
  const isoMatch = raw.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  // Date toString: "Fri May 22 2026..." — parse components directly to avoid timezone shift
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const lower = raw.toLowerCase();
  // Try "Mon DD YYYY" or "Day Mon DD YYYY" pattern
  const strMatch = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\s*,?\s*(\d{4})\b/i);
  if (strMatch) {
    const monIdx = months.indexOf(strMatch[1].toLowerCase().slice(0,3));
    if (monIdx >= 0) {
      return `${strMatch[3]}-${String(monIdx + 1).padStart(2, "0")}-${String(strMatch[2]).padStart(2, "0")}`;
    }
  }
  // Try "MM/DD/YYYY" or "M/D/YYYY"
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) return `${usMatch[3]}-${String(usMatch[1]).padStart(2,"0")}-${String(usMatch[2]).padStart(2,"0")}`;
  // Fallback: JavaScript Date parsing (may have timezone shift, but better than nothing)
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function cleanCol(value) {
  return String(value || "").replace(/\n/g, " ").trim();
}

function columnToken(value) {
  return cleanCol(value)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isCancelStatus(status) {
  const token = columnToken(status);
  return ["dibatalkan", "cancellations", "cancelled", "canceled", "cancel"].includes(token);
}

function isReturnStatus(status, cancelReason) {
  const token = columnToken(status);
  // Explicit retur statuses from column B
  if (token.includes("retur") || ["returned", "return", "returnrefund", "refundreturn", "pengembalian"].includes(token)) return true;
  // Column D (Cancelation/Return Type) = "Return/Refund" on completed orders
  // This means order selesai but buyer returned some items (partial return)
  const crToken = columnToken(cancelReason || "");
  if (crToken === "returnrefund") return true;
  return false;
}

function isCancelledStatus(status) {
  return isCancelStatus(status) || isReturnStatus(status);
}

function isUnpaidStatus(status) {
  return ["unpaid", "belumbayar", "pendingpayment"].includes(columnToken(status));
}

const OPERATION_LABELS = {
  processing: "Diproses",
  waiting_pickup: "Siap Diambil",
  waiting_ship: "Menunggu Kirim",
  shipped: "Dikirim",
  delivered: "Terkirim",
  completed: "Selesai",
  returned: "Retur",
  canceled: "Cancel",
  cancel_valid: "Cancel Valid",
  unpaid: "Belum Bayar",
  other: "Lainnya",
};

function operationBucket(status, context = {}) {
  // Return from column D (Cancelation/Return Type = "Return/Refund")
  if (context.returned || isReturnStatus(status, context.cancelReason)) return "returned";
  // Cancel Valid: cancelled with tracking (shipped before cancel)
  if (context.cancelValid) return "cancel_valid";
  // Pure cancel
  if (context.cancelOnly || isCancelStatus(status)) return "canceled";
  // Unpaid
  if (context.unpaid || isUnpaidStatus(status)) return "unpaid";
  
  const token = columnToken(status);
  const subToken = columnToken(context.substatus || "");
  
  // Completed / Delivered
  if (["selesai", "completed"].includes(token)) return "completed";
  
  // Dikirim: split by substatus (column C)
  if (token.includes("dikirim") || token.includes("shipped")) {
    // C = "Terkirim" → sudah sampai tujuan
    if (subToken.includes("terkirim") || subToken.includes("delivered")) return "delivered";
    // C = "Sedang transit" → dalam perjalanan
    return "shipped";
  }
  
  // Perlu dikirim: split by substatus
  if (token.includes("perludikirim") || token.includes("readytoship") || token.includes("siapdikirim")) {
    // C = "Menunggu pengambilan" → kurir belum pickup
    if (subToken.includes("pengambilan") || subToken.includes("pickup")) return "waiting_pickup";
    // C = "Menunggu pengiriman" → belum ada resi
    return "waiting_ship";
  }
  
  // Other waiting/pending statuses
  if (token.includes("menunggukirim") || token.includes("awaitingshipment") || token.includes("toship")) return "waiting_ship";
  if (token.includes("proses") || token.includes("processing") || token.includes("packing") || token.includes("dikemas") || token.includes("paid") || token.includes("dibayar")) return "processing";
  if (token.includes("pickup") || token.includes("jemput")) return "waiting_pickup";
  
  return "other";
}

function dayAge(createdDay, today) {
  if (!createdDay || createdDay === "Tanpa tanggal") return 0;
  const start = new Date(`${createdDay}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function hasIncomeSettlement(row) {
  const source = columnToken(row.source);
  const file = columnToken(row.last_seen_file);
  return source === "incomestatement" || file.includes("income") || file.includes("settlementstatement");
}

function isBookSource(row) {
  const source = columnToken(row.source);
  return ["settlement", "incomestatement"].includes(source) || hasIncomeSettlement(row);
}

function actualSettlementAmount(row) {
  return hasIncomeSettlement(row) ? Math.abs(Number(row.settlement_received || 0)) : 0;
}

function isAdIncomeType(type) {
  const token = columnToken(type);
  return token.includes("ads") || token.includes("iklan") || token.includes("gmvmaxad") || token.includes("tiktokads") || token.includes("gmvpayment");
}

// ── Special SKU HPP mapping (hardcoded fallback before DB lookup) ──
const SPECIAL_SKU_HPP = {
  "pola25pcs": 3000,
  "pola50pcs": 6000,
  "pola100pcs": 12000,
  "pola125pcs": 15000,
  "pola150pcs": 18000,
  "pola200pcs": 24000,
  "gancifotonama": 2000,
  "holologo9": 9000,
  "polaroid100": 12000,
};

function getSpecialSkuHpp(skuToken, variation) {
  // Direct match
  if (SPECIAL_SKU_HPP[skuToken]) return SPECIAL_SKU_HPP[skuToken];
  // POLA SKU without piece count — use variation to determine HPP
  if (skuToken === 'pola' && variation) {
    const varToken = columnToken(variation);
    // Extract piece count from variation (e.g., "25pcs" → 25, "50 pcs" → 50)
    const match = varToken.match(/(\d+)\s*pcs/);
    if (match) {
      const pcs = match[1];
      const key = 'pola' + pcs + 'pcs';
      if (SPECIAL_SKU_HPP[key]) return SPECIAL_SKU_HPP[key];
    }
  }
  return 0;
}

// ── Cancel-valid detection ──
function isCancelValid(status, cancelReason, hasTrackingOrShipped) {
  const s = columnToken(status);
  if (!["dibatalkan", "cancellations", "cancelled", "canceled", "cancel"].includes(s)) return false;
  const reason = columnToken(cancelReason || "");
  // Valid cancel: pengiriman paket gagal or paket hilang
  const validReason = reason.includes("pengirimanpaketgagal") || reason.includes("pakethilang") ||
    reason.includes("gagalkirim") || reason.includes("packagelost") || reason.includes("deliveryfailed");
  if (!validReason) return false;
  // Ideally has tracking ID or shipped time
  return true; // If reason matches, count as valid even without tracking
}

const SETTLEMENT_AD_FIELD_GROUPS = [
  [
    "GMV Max ad fee",
    "GMV Max ads fee",
    "GMV Max Ads Fee",
    "GMV Max Ads fee",
    "GMV Max Ads charged by TikTok",
    "GMV Max advertising fee",
    "GMV max advertising fee",
    "TikTok Ads fee",
    "TikTok Shop Ads fee",
    "Biaya iklan GMV Max",
    "Biaya Iklan GMV Max",
    "Biaya iklan GMV Maks",
    "Biaya Iklan GMV Maks",
    "Iklan GMV Max",
    "Biaya GMV Max",
  ],
  [
    "Affiliate Shop Ads commission",
    "Affiliate Partner shop ads commission",
    "Komisi Iklan Affiliate Shop",
    "Komisi Iklan Toko Afiliasi",
    "Komisi iklan toko afiliasi",
  ],
  [
    "Campaign resource fee",
    "Campaign Resource Fee",
    "Campaign resource fees",
    "Campaign Resource Fees",
    "Biaya resource campaign",
    "Biaya sumber daya kampanye",
  ],
];

function sumFieldGroups(row, groups) {
  const seen = new Set();
  let total = 0;
  for (const names of groups) {
    let matchedKey = "";
    for (const key of Object.keys(row || {})) {
      if (names.some(name => columnToken(name) === columnToken(key))) {
        matchedKey = key;
        break;
      }
    }
    if (!matchedKey || seen.has(columnToken(matchedKey))) continue;
    seen.add(columnToken(matchedKey));
    total += Math.abs(rupiah(row[matchedKey]));
  }
  return total;
}

function dynamicSettlementAdFee(row) {
  let total = 0;
  const seen = new Set();
  for (const [key, value] of Object.entries(row || {})) {
    const token = columnToken(key);
    const looksAd =
      token.includes("gmvmax") ||
      token.includes("tiktokads") ||
      token.includes("shopads") ||
      token.includes("affiliateads") ||
      token.includes("campaignresource") ||
      token.includes("adsfee") ||
      token.includes("adfee") ||
      token.includes("biayaiklan") ||
      token.includes("iklangmv") ||
      token.includes("iklanshop") ||
      token.includes("komisiiklan");
    const excluded = token.includes("id") || token.includes("time") || token.includes("date") || token.includes("status");
    if (!looksAd || excluded || seen.has(token)) continue;
    const amount = Math.abs(rupiah(value));
    if (amount > 0) {
      total += amount;
      seen.add(token);
    }
  }
  return total;
}

function normalizeOrderId(value) {
  const text = String(value ?? "")
    .replace(/\t/g, "")
    .replace(/^'/, "")
    .replace(/\.0$/, "")
    .trim();
  return text;
}

function rupiah(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = String(value || "").trim();
  if (!text) return 0;
  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  let normalized = text.replace(/[^\d,.-]/g, "");
  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;
  if (commaCount > 1 && dotCount === 0) {
    normalized = normalized.replace(/,/g, "");
  } else if (dotCount > 1 && commaCount === 0) {
    normalized = normalized.replace(/\./g, "");
  } else if (commaCount && dotCount) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    normalized = lastComma > lastDot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (commaCount === 1) {
    const [head, tail] = normalized.split(",");
    normalized = tail.length === 3 ? `${head}${tail}` : `${head}.${tail}`;
  } else if (dotCount === 1) {
    const [head, tail] = normalized.split(".");
    normalized = tail.length === 3 ? `${head}${tail}` : normalized;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(Math.abs(parsed) * (negative ? -1 : 1));
}

function parseDate(value) {
  if (!value) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const base = Date.UTC(1899, 11, 30);
    const parsed = new Date(base + value * 86400000);
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }
  const raw = String(value).replace(/\t/g, " ").trim();
  if (!raw) return "";
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const month = slash[2].padStart(2, "0");
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    const hour = (slash[4] || "00").padStart(2, "0");
    const minute = (slash[5] || "00").padStart(2, "0");
    const second = (slash[6] || "00").padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const year = iso[1];
    const month = iso[2].padStart(2, "0");
    const day = iso[3].padStart(2, "0");
    const hour = (iso[4] || "00").padStart(2, "0");
    const minute = (iso[5] || "00").padStart(2, "0");
    const second = (iso[6] || "00").padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeStore(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || ["nan", "none", "tiktok", "pare custom", "pare digital custom", "tiktok - pare custom"].includes(raw)) return DEFAULT_STORE;
  if (raw.includes("ventura")) return "ventura";
  if (raw.includes("giftyours") || raw.includes("gift yours")) return "giftyours";
  if (raw.includes("custombase") || raw.includes("custom base")) return "custombase";
  const matched = DEFAULT_STORES.find(store => raw === store);
  return matched || raw.replace(/\s+/g, "-");
}

function lineKey(storeName, orderId, sku, variation) {
  return `${normalizeStore(storeName)}|${orderId || ""}|${sku || ""}|${variation || ""}`.trim().toLowerCase();
}

function supabaseEnv() {
  return pg.pgConfigured() ? { url: process.env.DATABASE_URL || "pg", key: "pg" } : { url: "", key: "" };
}

function hashOwnerPin(pin) {
  const raw = String(pin || "").trim();
  if (!raw) return "";
  return crypto.createHash("sha256").update(`${OWNER_PIN_SALT}:${raw}`).digest("hex");
}

function supabaseConfigured() {
  return pg.pgConfigured();
}

function supabaseSetupMessage() {
  return pg.pgSetupMessage();
}

async function supabaseRequest(path, options = {}) {
  // PostgreSQL mode: translate Supabase REST path to SQL query
  const [table, queryString] = path.split("?");
  if (!table) throw new Error("Invalid path: " + path);

  const method = (options && options.method) || "GET";

  if (method === "GET") {
    return await pg.fetchAll(table, queryString || "");
  }

  if (method === "PATCH") {
    const params = parseSupabasePatchParams(path, options.body);
    const result = await pg.pgQuery(
      `UPDATE "${params.table}" SET ${params.sets} WHERE ${params.where} RETURNING *`,
      params.values
    );
    return result.rows;
  }

  if (method === "POST") {
    // POST with merge-duplicates -> upsert
    const body = JSON.parse(options.body || "[]");
    const bodyArr = Array.isArray(body) ? body : [body];
    const conflictKey = extractConflictKey(queryString);
    if (conflictKey) {
      return await pg.upsertRows(table, bodyArr, conflictKey);
    }
    return await pg.insertRows(table, bodyArr);
  }

  throw new Error(`Unsupported method ${method} for path: ${path}`);
}

function extractConflictKey(queryString) {
  if (!queryString) return null;
  const parts = queryString.split("&");
  for (const p of parts) {
    if (p.startsWith("on_conflict=")) {
      return decodeURIComponent(p.slice("on_conflict=".length));
    }
  }
  return null;
}

function parseSupabasePatchParams(path, bodyRaw) {
  // path format: table?id=eq.X
  const [table, qs] = path.split("?");
  const params = {};
  for (const part of (qs || "").split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq), v = part.slice(eq + 1);
    if (!k || !v) continue;
    const d = v.indexOf(".");
    if (d > 0) {
      const col = k;
      const op = v.slice(0, d);
      const val = decodeURIComponent(v.slice(d + 1));
      if (op === "eq") {
        params.col = col;
        params.where = `"${col}" = $1`;
        params.val = val;
      }
    }
  }
  const body = JSON.parse(bodyRaw || "{}");
  const cols = Object.keys(body);
  const sets = cols.map((c, i) => `"${c}" = $${i + 1 + (params.val !== undefined ? 1 : 0)}`).join(", ");
  const values = cols.map(c => body[c]);
  if (params.val !== undefined) values.unshift(params.val);
  return { table, sets, where: params.where || "true", values };
}

async function fetchAll(table, query = "") {
  return await pg.fetchAll(table, query);
}

function compactQuery(parts = []) {
  return parts.filter(Boolean).join("&");
}

function dateAndFilter(fieldName, startDate, endDate) {
  if (!startDate || !endDate) return "";
  // Add 1 day to endDate so lt includes all timestamps on the last day
  const endNext = new Date(new Date(endDate+'T00:00:00Z').getTime() + 86400000).toISOString().slice(0,10);
  return `and=(${fieldName}.gte.${encodeURIComponent(startDate)},${fieldName}.lt.${encodeURIComponent(endNext)})`;
}

function safeLog(label, details = {}) {
  try {
    const clean = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (/key|token|secret|password|pin/i.test(key)) continue;
      clean[key] = value;
    }
    console.log(`[finance-dashboard] ${label}`, JSON.stringify(clean));
  } catch {
    console.log(`[finance-dashboard] ${label}`);
  }
}

async function upsertRows(table, rows, conflictKey) {
  return await pg.upsertRows(table, rows, conflictKey);
}

async function insertRows(table, rows) {
  return await pg.insertRows(table, rows);
}

async function upsertAdSpendRows(rows) {
  return await pg.upsertAdSpendRows(rows.map(r => ({
    ...r,
    store_name: normalizeStore(r.store_name || DEFAULT_STORE),
    created_at: r.created_at || nowIso(),
  })));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function emptySummary(message = supabaseSetupMessage()) {
  return {
    generatedAt: nowIso(),
    totals: {
      orders: 0,
      lines: 0,
      qty: 0,
      gross: 0,
      omzet: 0,
      platformFee: 0,
      platformFeeFinal: 0,
      platformFeeEstimated: 0,
      platformDiscount: 0,
      hpp: 0,
      packing: 0,
      refund: 0,
      settlement: 0,
      held: 0,
      profit: 0,
      profitBeforeAds: 0,
      adSpend: 0,
      adSpendTopup: 0,
      adSpendSettlement: 0,
      settlementAdSpend: 0,
      todayOrders: 0,
      margin: 0,
      finalProfit: 0,
      estimatedProfit: 0,
      finalProfitBeforeAds: 0,
      estimatedProfitBeforeAds: 0,
      finalAdSpend: 0,
      estimatedAdSpend: 0,
      finalOmzet: 0,
      estimatedOmzet: 0,
      finalOrders: 0,
      estimatedOrders: 0,
      heldOrders: 0,
      cancelledOrders: 0,
      cancelledPackages: 0,
      returnPackages: 0,
      cancelPackages: 0,
      bookOrders: 0,
      bookCancelledOrders: 0,
      bookCancelledPackages: 0,
      bookReturnPackages: 0,
      bookCancelPackages: 0,
      bookGross: 0,
      bookSellerDiscount: 0,
      bookOmzet: 0,
      bookPlatformFee: 0,
      bookPlatformFeeFinal: 0,
      bookPlatformFeeEstimated: 0,
      bookSettlement: 0,
      bookHpp: 0,
      bookPacking: 0,
      bookRefund: 0,
      bookCancelledAmount: 0,
      bookHeld: 0,
      bookProfit: 0,
      bookProfitBeforeAds: 0,
      bookAdSpend: 0,
      finalMargin: 0,
      estimatedMargin: 0,
      bookMargin: 0,
    },
    daily: [],
    topSku: [],
    weakSku: [],
    skuDetails: [],
    skuSummary: { total: 0, profitable: 0, watch: 0, bad: 0, missingCost: 0, best: null, weakest: null },
    stores: DEFAULT_STORES.map(store => ({ store, orders: 0, omzet: 0, profit: 0 })),
    status: [],
    operationStatus: [],
    operationDetails: [],
    missingCost: [],
    alerts: [{ level: "warn", title: "Supabase belum siap", body: message }],
    assistant: {
      score: 0,
      health: "Menunggu Supabase",
      forecast30Omzet: 0,
      forecast30Profit: 0,
      accounting: {
        pendapatan: 0,
        omzetKotor: 0,
        diskonSeller: 0,
        omzetNet: 0,
        settlementCair: 0,
        hppPacking: 0,
        hpp: 0,
        packing: 0,
        potonganPlatform: 0,
        potonganPlatformFinal: 0,
        potonganPlatformEstimasi: 0,
        biayaIklan: 0,
        biayaIklanSettlement: 0,
        biayaIklanTopup: 0,
        totalBiaya: 0,
        danaTertahan: 0,
        refund: 0,
        returCancel: 0,
        profitBersih: 0,
        profitEstimasi: 0,
        profitFinal: 0,
        profitBelumFinal: 0,
        omsetFinal: 0,
        omsetBelumFinal: 0,
      },
      insights: [message],
      actions: ["Sambungkan environment Supabase di Vercel agar dashboard online bisa membaca dan menyimpan data real."],
    },
    filters: { preset: "thisMonth", month: "", store: "all", startDate: "", endDate: "" },
    availableMonths: Array.from({ length: 12 }, (_, index) => `${new Date().getFullYear()}-${String(12 - index).padStart(2, "0")}`),
    availableStores: DEFAULT_STORES,
    adSpendRows: [],
    runs: [],
    auditEvents: [],
  };
}

function dateRangeFromFilters(filters) {
  const today = todayIso();
  const todayDate = new Date(`${today}T00:00:00Z`);
  if (filters.preset === "last7") {
    const start = new Date(todayDate);
    start.setUTCDate(start.getUTCDate() - 6);
    return [start.toISOString().slice(0, 10), today];
  }
  if (filters.preset === "last14") {
    const start = new Date(todayDate);
    start.setUTCDate(start.getUTCDate() - 13);
    return [start.toISOString().slice(0, 10), today];
  }
  if (filters.preset === "thisMonth") return [today.slice(0, 8) + "01", today];
  if (filters.preset === "custom" && filters.startDate && filters.endDate) return [filters.startDate, filters.endDate];
  if (filters.preset === "month" && filters.month) {
    const [year, month] = filters.month.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    // End date = LAST day of target month (Date.UTC month is 0-indexed, day 0 = last day of prev month)
    const endDate = new Date(Date.UTC(year, month, 0));
    return [start, endDate.toISOString().slice(0, 10)];
  }
  return ["", ""];
}

function buildFilters(query = {}) {
  const preset = ["all", "last7", "last14", "thisMonth", "month", "custom"].includes(query.preset) ? query.preset : "thisMonth";
  const store = query.store && query.store !== "all" ? normalizeStore(query.store) : "all";
  return { preset, month: query.month || "", store, startDate: query.startDate || "", endDate: query.endDate || "", mode: query.mode || "accrual" };
}

function field(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  }
  const lowered = {};
  const tokened = {};
  for (const [key, value] of Object.entries(row)) lowered[cleanCol(key).toLowerCase()] = value;
  for (const [key, value] of Object.entries(row)) tokened[columnToken(key)] = value;
  for (const name of names) {
    const value = lowered[cleanCol(name).toLowerCase()];
    if (value !== undefined) return value;
  }
  for (const name of names) {
    const value = tokened[columnToken(name)];
    if (value !== undefined) return value;
  }
  return "";
}

function detectKind(rows, requestedKind) {
  const normalized = String(requestedKind || "auto").toLowerCase();
  const first = rows[0] || {};
  const keys = Object.keys(first);
  const cols = new Set(keys.map(columnToken));
  const joined = keys.map(columnToken).join("|");
  const has = (...names) => names.some(name => {
    const token = columnToken(name);
    return cols.has(token) || joined.includes(token);
  });
  const looksIncome = has("Order/adjustment ID", "Order adjustment ID", "ID Pesanan/Penyesuaian") &&
    has("Total settlement amount", "Jumlah penyelesaian pembayaran") &&
    has("Total Revenue", "Total Pendapatan", "Subtotal after seller discounts", "Subtotal setelah diskon penjual", "Total Fees", "Total Biaya");
  if (["sku", "orders", "order", "settlement", "pencairan", "income"].includes(normalized) && normalized !== "auto") {
    if (["settlement", "pencairan", "income"].includes(normalized) && looksIncome) return "income";
    return normalized === "order" ? "orders" : normalized === "pencairan" ? "settlement" : normalized;
  }
  if (
    has("sku", "seller sku", "sku marketplace") &&
    has("hppPerUnit", "hpp_per_unit", "hpp", "packingPerUnit", "packing_per_unit", "packing")
  ) return "sku";
  // TikTok OrderSKUList: deteksi sebelum settlement (punya Package ID + Created Time)
  if (
    has("Order ID", "order id") &&
    has("Seller SKU", "seller sku") &&
    has("Package ID", "package id") &&
    has("Created Time", "created time")
  ) return "orders";
  if (
    has("Order ID", "order id") &&
    has("Seller SKU", "seller sku") &&
    has("SKU Subtotal Before Discount", "Order Status", "Order Amount")
  ) return "settlement";
  if (looksIncome) return "income";
  // TikTok Ad Transaction file
  if (
    has("Transaction time", "transaction time") &&
    has("Transaction type", "transaction type") &&
    has("Status", "status")
  ) return "ads";
  if (
    has("Nomor Pesanan (di Marketplace)", "Nomor Pesanan (di Desty)", "nomor pesanan di marketplace") &&
    has("SKU Marketplace", "sku marketplace")
  ) return "orders";
  return "unknown";
}

function mapSkuRows(rows, storeName) {
  const store = ["", "all", "semua", "global"].includes(String(storeName || "").toLowerCase()) ? "global" : normalizeStore(storeName);
  return rows.map(row => {
    const sku = String(field(row, "sku")).trim();
    if (!sku) return null;
    return {
      sku_key: `${store}|${sku.toLowerCase()}`,
      store_name: store,
      sku,
      product_name: String(field(row, "productName", "product_name", "Nama Produk")).trim(),
      hpp_per_unit: Math.abs(rupiah(field(row, "hppPerUnit", "hpp_per_unit", "HPP"))),
      packing_per_unit: Math.abs(rupiah(field(row, "packingPerUnit", "packing_per_unit", "Packing"))),
      updated_at: nowIso(),
    };
  }).filter(Boolean);
}

function mapOrderRows(rows, storeName, filename) {
  const selectedStore = storeName ? normalizeStore(storeName) : "";
  return rows.map(row => {
    // Support both Desty and TikTok OrderSKUList formats
    const orderId = normalizeOrderId(field(row, "Nomor Pesanan (di Marketplace)", "Order ID"));
    const sku = String(field(row, "SKU Marketplace", "Seller SKU")).trim();
    if (!orderId || !sku) return null;
    const qty = Math.abs(rupiah(field(row, "Jumlah", "Quantity")));
    const unitPrice = Math.abs(rupiah(field(row, "Harga Satuan", "SKU Unit Original Price")));
    const rowStore = selectedStore || normalizeStore(field(row, "Channel - Nama Toko", "Warehouse Name") || DEFAULT_STORE);
    const variation = String(field(row, "Varian Produk", "Variation")).trim();
    return {
      line_key: lineKey(rowStore, orderId, sku, variation),
      order_id: orderId,
      store_name: rowStore,
      source: "tiktok_order",
      created_at: parseDate(field(row, "Tanggal Pesanan Dibuat", "Created Time")),
      updated_at: parseDate(field(row, "Waktu Pesanan (Update)", "Delivered Time")),
      status: String(field(row, "Status Pesanan", "Order Status")).trim(),
      order_substatus: String(field(row, "Order Substatus")).trim(),
      sku,
      product_name: String(field(row, "Nama Produk", "Product Name")).trim(),
      variation,
      quantity: qty,
      unit_price: unitPrice,
      gross_product: Math.abs(rupiah(field(row, "Subtotal Produk", "SKU Subtotal Before Discount"))) || unitPrice * qty,
      seller_discount: Math.abs(rupiah(field(row, "Diskon Penjual", "SKU Seller Discount"))),
      platform_discount: Math.abs(rupiah(field(row, "SKU Platform Discount"))),
      platform_fee: Math.abs(rupiah(field(row, "Biaya Layanan", "Buyer Service Fee"))) + Math.abs(rupiah(field(row, "Pajak", "Handling Fee"))),
      refund_amount: Math.abs(rupiah(field(row, "Refund", "Order Refund Amount"))),
      order_amount: Math.abs(rupiah(field(row, "Total Faktur", "Total Penjualan", "Order Amount"))),
      settlement_received: 0,
      payment_method: String(field(row, "Metode Pembayaran", "Payment Method")).trim(),
      tracking_id: String(field(row, "Tracking ID", "Nomor AWB/Resi")).trim(),
      package_id: String(field(row, "Package ID")).trim(),
      cancel_reason: String(field(row, "Cancelation/Return Type", "Cancel Reason")).trim(),
      shipped_time: parseDate(field(row, "Shipped Time", "RTS Time")),
      paid_time: parseDate(field(row, "Paid Time")),
      cancelled_time: parseDate(field(row, "Cancelled Time")),
      last_seen_file: filename,
      last_seen_at: nowIso(),
    };
  }).filter(Boolean);
}

function mapSettlementRows(rows, storeName, filename) {
  const selectedStore = storeName ? normalizeStore(storeName) : DEFAULT_STORE;
  return rows.map(row => {
    const orderId = normalizeOrderId(field(row, "Order ID"));
    const sku = String(field(row, "Seller SKU")).trim();
    if (!orderId || !sku) return null;
    const status = String(field(row, "Order Status")).trim();
    const beforeDiscount = Math.abs(rupiah(field(row, "SKU Subtotal Before Discount")));
    const sellerDiscount = Math.abs(rupiah(field(row, "SKU Seller Discount")));
    const rowStore = selectedStore || normalizeStore(field(row, "Warehouse Name") || DEFAULT_STORE);
    const variation = String(field(row, "Variation")).trim();
    const platformFee =
      Math.abs(rupiah(field(row, "Buyer Service Fee"))) +
      Math.abs(rupiah(field(row, "Handling Fee"))) +
      Math.abs(rupiah(field(row, "Shipping Insurance"))) +
      Math.abs(rupiah(field(row, "Item Insurance")));
    return {
      line_key: lineKey(rowStore, orderId, sku, variation),
      order_id: orderId,
      store_name: rowStore,
      source: "settlement",
      created_at: parseDate(field(row, "Created Time")),
      updated_at: parseDate(field(row, "Delivered Time") || field(row, "Paid Time")),
      status,
      sku,
      product_name: String(field(row, "Product Name")).trim(),
      variation,
      quantity: Math.abs(rupiah(field(row, "Quantity"))),
      unit_price: Math.abs(rupiah(field(row, "SKU Unit Original Price"))),
      gross_product: beforeDiscount,
      seller_discount: sellerDiscount,
      platform_discount: Math.abs(rupiah(field(row, "SKU Platform Discount"))) + Math.abs(rupiah(field(row, "Payment platform discount"))),
      platform_fee: platformFee,
      refund_amount: Math.abs(rupiah(field(row, "Order Refund Amount"))),
      order_amount: beforeDiscount - sellerDiscount,
      settlement_received: 0,
      payment_method: String(field(row, "Payment Method")).trim(),
      tracking_id: String(field(row, "Tracking ID")).trim(),
      last_seen_file: filename,
      last_seen_at: nowIso(),
    };
  }).filter(Boolean);
}

function mapIncomeRows(rows, storeName, filename) {
  const selectedStore = normalizeStore(storeName || DEFAULT_STORE);
  return rows.map(row => {
    const transactionId = normalizeOrderId(field(row, "Order/adjustment ID", "Order adjustment ID", "ID Pesanan/Penyesuaian"));
    const relatedOrderId = normalizeOrderId(field(row, "Related order ID", "Related order ID  ", "ID pesanan terkait", "ID Pesanan Terkait"));
    const type = String(field(row, "Type", "Jenis transaksi")).trim();
    const orderId = (relatedOrderId && relatedOrderId !== "/" ? relatedOrderId : transactionId).trim();
    if (!orderId) return null;
    const settlement = rupiah(field(row, "Total settlement amount", "Jumlah penyelesaian pembayaran"));
    const totalRevenue = rupiah(field(row, "Total Revenue", "Total Pendapatan"));
    const afterDiscount = rupiah(field(row, "Subtotal after seller discounts", "Subtotal setelah diskon penjual"));
    const beforeDiscount = rupiah(field(row, "Subtotal before discounts", "Subtotal sebelum diskon"));
    const sellerDiscount = Math.abs(rupiah(field(row, "Seller discounts", "Diskon penjual")));
    const refund = Math.abs(rupiah(field(row, "Refund subtotal after seller discounts", "Subtotal pengembalian dana setelah diskon penjual")));
    const totalFees = Math.abs(rupiah(field(row, "Total Fees", "Total Biaya", "Jumlah biaya", "Total biaya")));
    const explicitAdFee = Math.max(sumFieldGroups(row, SETTLEMENT_AD_FIELD_GROUPS), dynamicSettlementAdFee(row));
    const adjustment = rupiah(field(row, "Ajustment amount", "Adjustment amount", "Jumlah penyesuaian"));
    const typeAdFee = isAdIncomeType(type) ? Math.abs(settlement || adjustment || totalFees || 0) : 0;
    const adFee = explicitAdFee || typeAdFee;
    return {
      orderId,
      transactionId,
      type,
      storeName: selectedStore,
      createdAt: parseDate(field(row, "Order created time", "Waktu pemesanan")),
      settledAt: parseDate(field(row, "Order settled time", "Waktu pembayaran pesanan", "Waktu penyelesaian pesanan", "Waktu penyelesaian pembayaran")),
      settlement,
      totalRevenue,
      afterDiscount,
      beforeDiscount,
      sellerDiscount,
      refund,
      totalFees,
      adFee,
      adSource: typeAdFee ? type || "GMV Payment for TikTok Ads" : (explicitAdFee ? "Kolom biaya iklan settlement" : ""),
      adjustment,
      filename,
    };
  }).filter(Boolean);
}

function auditChanges(existing, next) {
  if (!existing) return [["inserted", "order", "", next.order_amount || ""]];
  const fields = ["status", "order_amount", "settlement_received", "platform_fee", "refund_amount", "tracking_id", "quantity"];
  const changes = [];
  for (const name of fields) {
    const oldValue = existing[name] ?? "";
    const newValue = next[name] ?? "";
    if (String(oldValue) !== String(newValue)) changes.push(["updated", name, oldValue, newValue]);
  }
  return changes;
}

async function createImportRun(filename, kind, storeName) {
  const runId = generatedBigIntId();
  const rows = await insertRows("finance_import_runs", [{
    id: runId,
    filename,
    kind,
    store_name: storeName || "",
    rows_seen: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    audit_count: 0,
    message: "Import berjalan",
    created_at: nowIso(),
  }]);
  return { ...(rows[0] || {}), id: runId };
}

async function finishImportRun(runId, patch) {
  if (!runId) return null;
  const cols = Object.keys(patch);
  const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(", ");
  const values = [runId, ...cols.map(c => patch[c])];
  const result = await pg.pgQuery(
    `UPDATE "finance_import_runs" SET ${sets} WHERE "id" = $1 RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function importIncomeRows({ storeName, filename, rows, run }) {
  const storeFilter = normalizeStore(storeName || DEFAULT_STORE);
  if (/\.xlsx/i.test(String(filename || "")) && rows.length <= 1) {
    throw new Error(`File ${filename || "income"} hanya terbaca ${rows.length} baris.`);
  }
  let incomeRows = mapIncomeRows(rows, storeFilter, filename || "upload");
  if (!incomeRows.length) throw new Error(`File ${filename || "income"} tidak ada baris valid.`);
  
  const dedupIncome = new Map();
  for (const row of incomeRows) dedupIncome.set(row.orderId, row);
  incomeRows = Array.from(dedupIncome.values());
  
  // === STORE RAW INCOME in finance_income_raw (for direct aggregation by computeSummary) ===
  const rawIncomeRows = incomeRows.map(r => ({
    store_name: r.storeName || storeFilter,
    transaction_type: r.type || "",
    order_id: r.orderId || "",
    order_created_time: r.createdAt || "",
    settlement_amount: r.settlement || 0,
    total_fees: r.totalFees || 0,
    refund_amount: r.refund || 0,
    adjustment_amount: r.adjustment || 0,
    imported_at: nowIso(),
  }));
  // Batch INSERT with ON CONFLICT DO NOTHING — 1 SQL per 200 rows instead of 2 per row
  if (rawIncomeRows.length > 0) {
    const BATCH = 200;
    const cols = ["store_name","transaction_type","order_id","order_created_time","settlement_amount","total_fees","refund_amount","adjustment_amount","imported_at"];
    for (let i = 0; i < rawIncomeRows.length; i += BATCH) {
      const batch = rawIncomeRows.slice(i, i + BATCH);
      const values = [], placeholders = [];
      let idx = 1;
      for (const ri of batch) {
        placeholders.push(`(${cols.map(() => '$' + (idx++)).join(',')})`);
        for (const c of cols) values.push(ri[c] != null ? ri[c] : null);
      }
      try {
        await pg.pgQuery(
          `INSERT INTO finance_income_raw(${cols.map(c=>'"'+c+'"').join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT (store_name, order_id, transaction_type) DO NOTHING`,
          values
        );
      } catch(e) { /* constraint handles dedup */ }
    }
  }
  
  // Targeted fetch: only order_ids from this chunk
  const matchedOrderIds = [...new Set(incomeRows.map(r => r.orderId).filter(Boolean))];
  const orderIdSet = new Set(matchedOrderIds);
  let existingRows = [];
  if (matchedOrderIds.length) {
    try {
      // For large IN clauses, fetch all store rows and filter in-memory (faster on Turso/SQLite)
      const result = await pg.pgQuery(
        `SELECT * FROM finance_order_lines WHERE store_name = $1`,
        [storeFilter]
      );
      existingRows = (result.rows || []).filter(r => orderIdSet.has(String(r.order_id || '').trim()));
    } catch(e) { console.error('[importIncome] fetch existing failed:', e.message); existingRows = []; }
  }
  const byOrder = new Map();
  for (const row of existingRows) {
    if (normalizeStore(row.store_name || DEFAULT_STORE) !== storeFilter) continue;
    const key = String(row.order_id || "").trim();
    if (!key) continue;
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(row);
  }

  let inserted = 0, updated = 0, unchanged = 0, skipped = 0;
  let adSpendRows = 0, adSpendTotal = 0, gmvSkipped = 0;
  const prepared = [], auditEvents = [], adSpendByKey = new Map();

  for (const income of incomeRows) {
    const typeToken = columnToken(income.type);
    
    // === GMV Ad Spend: Jenis transaksi = "Pembayaran GMV untuk Iklan TikTok" ===
    const isGmvAd = typeToken.includes("gmv") || typeToken.includes("pembayarangmv") || 
      (typeToken.includes("iklan") && typeToken !== "biayaiklan");
    if (isGmvAd && typeToken !== "pesanan" && typeToken !== "order") {
      const gmvAmt = Math.abs(Number(income.settlement || 0));
      if (gmvAmt > 0) {
        // GUNAKAN Waktu pemesanan (createdAt), BUKAN Waktu pembayaran (settledAt)
        const rawDate = income.createdAt || todayIso();
        let spendDate;
        if (rawDate instanceof Date && !isNaN(rawDate)) {
          spendDate = rawDate.toISOString().slice(0, 10);
        } else {
          spendDate = String(rawDate).slice(0, 10).replace(/\//g, '-');
          // Fix for browser Date toString format like "Fri May 22 2026"
          if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) {
            const m = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
            spendDate = m ? m[0] : todayIso().slice(0, 10);
          }
        }
        const key = `${storeFilter}|${spendDate}|TikTok GMV Ads|${income.transactionId || ""}`;
        adSpendByKey.set(key, {
          store_name: storeFilter, spend_date: spendDate, amount: gmvAmt,
          channel: "TikTok GMV Ads", campaign: income.type || "GMV Payment",
          note: `GMV Ads: ${income.type} (${filename || "upload"})`,
          created_at: nowIso(), updated_at: nowIso(),
        });
        adSpendRows += 1; adSpendTotal += gmvAmt;
      }
      continue; // JANGAN match ke order
    }

    // === Hanya proses Jenis transaksi = Pesanan ===
    if (typeToken !== "pesanan" && typeToken !== "order") continue;

    const existingGroup = byOrder.get(income.orderId) || [];
    if (!existingGroup.length) { skipped += 1; continue; }
    
    const targetRows = existingGroup;
    const grossBase = targetRows.reduce((sum, row) => sum + Math.abs(Number(row.gross_product || 0)), 0) ||
      Math.abs(income.beforeDiscount || income.afterDiscount || income.totalRevenue || 0) || targetRows.length || 1;
    const incomeSettlement = Math.max(0, Number(income.settlement || 0));
    const orderAmount = Math.abs(income.afterDiscount || income.totalRevenue || income.beforeDiscount || 0);
    const incomeFee = Math.max(Number(income.totalFees || 0), 0) ||
      (incomeSettlement ? Math.max(orderAmount - incomeSettlement, 0) : 0);
    const refundOnly = income.refund && !incomeSettlement && !income.totalRevenue;
    // Pure refund rows (settle=0, rev=0) should NOT count toward refund_valid
    const isPureRefund = refundOnly && incomeSettlement === 0 && !income.totalRevenue;

    for (const current of targetRows) {
      const currentGross = Math.abs(Number(current.gross_product || 0));
      const currentDiscount = Math.abs(Number(current.seller_discount || 0));
      const share = existingGroup.length ? (currentGross ? currentGross / grossBase : 1 / targetRows.length) : 1;
      // Keep original order status, don't override from income type
      const status = current.status || "Selesai";
      const next = {
        ...current,
        source: "income_statement",
        created_at: current.created_at || income.createdAt,
        updated_at: income.settledAt || current.updated_at,
        status,
        gross_product: currentGross || Math.abs(income.beforeDiscount || income.afterDiscount || income.totalRevenue || 0) * share,
        seller_discount: currentDiscount,
        platform_fee: incomeFee ? incomeFee : Number(current.platform_fee || 0),
        refund_amount: isPureRefund ? 0 : (income.refund || Number(current.refund_amount || 0)),
        order_amount: currentGross
          ? Math.max(currentGross - currentDiscount, 0)
          : (orderAmount ? orderAmount * share : Number(current.order_amount || 0)),
        settlement_received: (incomeSettlement + Number(income.adjustment || 0)) || Number(current.settlement_received || 0),
        last_seen_file: filename || "upload",
        last_seen_at: nowIso(),
      };
      const changes = auditChanges(existingGroup.length ? current : null, next);
      if (changes.length) updated += 1; else unchanged += 1;
      for (const [changeType, fieldName, oldValue, newValue] of changes) {
        auditEvents.push({
          id: generatedBigIntId(), run_id: run && run.id, filename: filename || "upload",
          kind: "income", store_name: next.store_name, order_id: next.order_id, sku: next.sku,
          field_name: fieldName, old_value: String(oldValue ?? ""), new_value: String(newValue ?? ""),
          change_type: changeType, created_at: nowIso(),
        });
      }
      // Delete adjustment_amount before upsert (column may not exist)
      delete next.adjustment_amount;
      prepared.push(next);
    }
  }

  await upsertAdSpendRows(Array.from(adSpendByKey.values()));
  await upsertRows("finance_order_lines", prepared, "line_key");
  await insertRows("finance_audit_events", auditEvents);
  
  safeLog("import_income", { filename, store: storeFilter, rows: rows.length, mapped: incomeRows.length, updated, unchanged, skipped, adSpendRows, adSpendTotal, gmvSkipped });
  
  await finishImportRun(run && run.id, {
    rows_seen: rows.length, inserted, updated, unchanged: unchanged + skipped,
    audit_count: auditEvents.length,
    message: `Income statement diproses: ${updated} order diperbarui${skipped ? ", " + skipped + " tidak match" : ""}${adSpendRows ? "; GMV Ads " + adSpendRows + " transaksi (Rp" + Math.round(adSpendTotal).toLocaleString("id-ID") + ")" : ""}`,
  });
  
  return { ok: true, kind: "income", rows: rows.length, inserted, updated, unchanged: unchanged + skipped, skipped, auditCount: auditEvents.length, adSpendRows, adSpendTotal,
    matchedOrders: updated + unchanged, unmatchedOrders: skipped, gmvAdCount: adSpendRows, gmvAdTotal: adSpendTotal };
}

async function importRows({ storeName, kind, filename, rows }) {
  const cleanRows = (rows || []).map(row => {
    const clean = {};
    for (const [key, value] of Object.entries(row || {})) clean[cleanCol(key)] = value;
    return clean;
  }).filter(row => {
    // Skip description rows that leaked from Excel
    const sku = String(field(row, "Seller SKU", "SKU", "sku") || "").toLowerCase();
    if (sku.includes("seller sku input by") || sku.includes("platform product name")) return false;
    const oid = String(field(row, "Order ID", "order_id") || "").toLowerCase();
    if (oid.includes("platform unique order")) return false;
    return true;
  });
  const detected = detectKind(cleanRows, kind);
  if (detected === "unknown") {
    const cols = Object.keys(cleanRows[0] || {}).slice(0, 12).join(", ") || "tidak ada kolom terbaca";
    throw new Error(`Format file ${filename || "upload"} belum dikenal. Kolom terbaca: ${cols}. Pilih jenis file yang sesuai atau upload order Desty, pencairan TikTok, atau template SKU.`);
  }
  if (detected === "income" && /\.xlsx/i.test(String(filename || "")) && cleanRows.length <= 1) {
    throw new Error(`File ${filename || "income"} hanya terbaca ${cleanRows.length} baris. Refresh halaman Vercel lalu upload ulang Excel; versi terbaru akan mengirim file mentah ke server agar terbaca penuh.`);
  }
  const run = await createImportRun(filename || "upload", detected, storeName || DEFAULT_STORE);
  if (detected === "sku") {
    const skuRows = mapSkuRows(cleanRows, storeName || "global");
    if (!skuRows.length) throw new Error(`File ${filename || "SKU"} terbaca sebagai SKU, tetapi tidak ada baris SKU valid.`);
    await upsertRows("finance_sku_costs", skuRows, "sku_key");
    await finishImportRun(run && run.id, {
      rows_seen: cleanRows.length,
      inserted: skuRows.length,
      updated: 0,
      unchanged: 0,
      audit_count: 0,
      message: "HPP dan packing diperbarui",
    });
    return { ok: true, kind: "sku", rows: cleanRows.length, inserted: skuRows.length, updated: 0, unchanged: 0, auditCount: 0 };
  }
  if (detected === "income") {
    return importIncomeRows({ storeName, filename, rows: cleanRows, run });
  }
  if (detected === "ads") {
    // TikTok ad transaction file: extract General Add balance Cash Success
    const adRows = [];
    for (const row of cleanRows) {
      const type = String(field(row, "Transaction type") || "").trim();
      const subtype = String(field(row, "Transaction subtype") || "").trim();
      const status = String(field(row, "Status") || "").trim();
      // Only Add balance, Success (NOT Bill payment / GMV Pay ad charges)
      if (type !== "General" || subtype !== "Add balance" || status !== "Success") continue;
      // Do NOT filter by Description — "GMV Pay" in desc is just the payment method, not the ad type
      // The subtype check above already excludes Bill payment rows
      
      const rawDate = field(row, "Transaction time") || "";
      let spendDate;
      if (rawDate instanceof Date && !isNaN(rawDate)) {
        spendDate = rawDate.toISOString().slice(0, 10);
      } else {
        spendDate = String(rawDate).replace(/\//g, '-').slice(0, 10);
        // Fix for Date toString format like "Fri May 22 2026..." or "5/6/2026"
        if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) {
          const m = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
          spendDate = m ? m[0] : todayIso().slice(0, 10);
        }
      }
      // Amount may be in column "Amount" or computed from other fields
      let amount = Math.abs(rupiah(field(row, "Amount") || 0));
      if (!amount) amount = Math.abs(rupiah(field(row, "GMV", "Total Amount") || 0));
      if (!amount) continue;
      adRows.push({
        store_name: normalizeStore(storeName || DEFAULT_STORE),
        spend_date: spendDate,
        amount,
        channel: "TikTok Top Up",
        campaign: "Manual",
        note: "Top up " + (field(row, "Transaction ID") || ""),
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    if (adRows.length) await upsertAdSpendRows(adRows);
    await finishImportRun(run && run.id, {
      rows_seen: cleanRows.length,
      inserted: adRows.length,
      updated: 0, unchanged: 0, audit_count: 0,
      message: `Iklan diproses: ${adRows.length} transaksi top-up`,
    });
    return { ok: true, kind: "ads", rows: cleanRows.length, inserted: adRows.length, updated: 0, unchanged: 0, auditCount: 0, adSpendRows: adRows.length, adSpendTotal: adRows.reduce((s,r)=>s+r.amount,0) };
  }

  const mapped = detected === "orders"
    ? mapOrderRows(cleanRows, storeName, filename || "upload")
    : mapSettlementRows(cleanRows, storeName, filename || "upload");
  if (!mapped.length) throw new Error(`File ${filename || "upload"} terbaca sebagai ${detected}, tetapi tidak ada order/SKU valid yang bisa diimport.`);
  
  // Bulk insert/update — fast path, no individual fetch
  await upsertRows("finance_order_lines", mapped, "line_key");
  
  await finishImportRun(run && run.id, {
    rows_seen: cleanRows.length,
    inserted: mapped.length,
    updated: 0,
    unchanged: 0,
    audit_count: 0,
    message: detected === "orders" ? `Order diproses: ${mapped.length} baris` : "Pencairan/status marketplace diperbarui",
  });
  return { ok: true, kind: detected, rows: cleanRows.length, inserted: mapped.length, updated: 0, unchanged: 0, auditCount: 0 };
}

async function readConfig() {
  const defaults = {
    telegramBotToken: "",
    telegramChatId: "",
    morningTime: "07:30",
    alertNegativeProfit: true,
    alertMarginBelow: 12,
    lastMorningSent: "",
    ownerPinEnabled: false,
    ownerPin: "",
    ownerPinHash: "",
    stores: DEFAULT_STORES,
    defaultStore: DEFAULT_STORE,
    folderMonitors: Object.fromEntries(DEFAULT_STORES.map(store => [store, {
      enabled: false,
      path: "",
      intervalMinutes: 10,
      storeName: store,
      kind: "auto",
      lastRun: "",
      lastMessage: "Auto update folder online butuh worker lokal yang mengirim data ke Supabase.",
      fileState: {},
    }])),
  };
  if (!supabaseConfigured()) return defaults;
  try {
    const rows = await fetchAll("finance_config", "select=value&key=eq.app&limit=1");
    const saved = (rows[0] && rows[0].value) || {};
    return { ...defaults, ...saved, stores: configuredStores(saved.stores || defaults.stores) };
  } catch (e) {
    safeLog("readConfig_fallback", { error: e.message });
    return defaults;
  }
}

async function saveConfig(data) {
  const current = await readConfig();
  const hasNewPin = Object.prototype.hasOwnProperty.call(data, "ownerPin") && data.ownerPin && data.ownerPin !== "••••••";
  const ownerPinHash = hasNewPin ? hashOwnerPin(data.ownerPin) : (current.ownerPinHash || (current.ownerPin ? hashOwnerPin(current.ownerPin) : ""));
  const next = {
    ...current,
    telegramBotToken: data.telegramBotToken && data.telegramBotToken !== "tersimpan" ? String(data.telegramBotToken).trim() : current.telegramBotToken,
    telegramChatId: data.telegramChatId ? String(data.telegramChatId).trim() : current.telegramChatId,
    morningTime: data.morningTime || current.morningTime || "07:30",
    ownerPin: "",
    ownerPinHash,
    ownerPinEnabled: Boolean(ownerPinHash),
    stores: data.stores || current.stores || DEFAULT_STORES,
  };
  await upsertRows("finance_config", [{ key: "app", value: next, updated_at: nowIso() }], "key");
  return safeConfig(next);
}

function safeConfig(config) {
  const pinEnabled = Boolean(config.ownerPinHash || config.ownerPin);
  return {
    ...config,
    telegramBotToken: config.telegramBotToken ? "tersimpan" : "",
    ownerPin: pinEnabled ? "••••••" : "",
    ownerPinHash: "",
    ownerPinEnabled: pinEnabled,
    pgConnected: supabaseConfigured(),
  };
}

async function ownerPinValid(pin) {
  const config = await readConfig();
  if (!config.ownerPinHash && !config.ownerPin) return true;
  const raw = String(pin || "").trim();
  if (!raw) return false;
  return (config.ownerPinHash && hashOwnerPin(raw) === config.ownerPinHash) || (config.ownerPin && raw === String(config.ownerPin));
}

async function requireOwner(req, res) {
  const pin = (req.headers && (req.headers["x-owner-pin"] || req.headers["X-Owner-Pin"])) || "";
  if (await ownerPinValid(pin)) return true;
  json(res, 401, { ok: false, ownerLocked: true, error: "Masukkan PIN Owner untuk membuka data rahasia." });
  return false;
}

async function saveAdSpend(data) {
  const amount = Math.abs(rupiah(data.amount));
  if (!amount) throw new Error("Nominal biaya iklan harus lebih dari 0.");
  const row = {
    store_name: normalizeStore(data.storeName || DEFAULT_STORE),
    spend_date: String(data.spendDate || todayIso()).slice(0, 10),
    amount,
    channel: String(data.channel || "TikTok Ads").trim() || "TikTok Ads",
    campaign: String(data.campaign || "").trim(),
    note: String(data.note || "").trim(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const saved = await upsertAdSpendRows([row]);
  return saved[0] || row;
}

async function computeSummary(filters = { preset: "thisMonth", month: "", store: "all", mode: "accrual" }) {
  const startedAt = Date.now();
  if (!supabaseConfigured()) return emptySummary();
  const [startDate, endDate] = dateRangeFromFilters(filters);
  const storeFilter = filters.store !== "all" ? `store_name=eq.${encodeURIComponent(filters.store)}` : "";
  const orderQuery = compactQuery([
    "select=*",
    storeFilter,
    dateAndFilter("created_at", startDate, endDate),
  ]);
  const adQuery = compactQuery([
    "select=*",
    storeFilter,
    dateAndFilter("spend_date", startDate, endDate),
  ]);
  const incomeQuery = compactQuery([
    "select=*",
    storeFilter,
    dateAndFilter("order_created_time", startDate, endDate),
  ]);
  const [orderLines, skuCosts, adRowsAll, monthRows, incomeRawRows] = await Promise.all([
    fetchAll("finance_order_lines", orderQuery),
    fetchAll("finance_sku_costs", "select=*"),
    fetchAll("finance_ad_spend", adQuery),
    fetchAll("finance_order_lines", compactQuery(["select=created_at", storeFilter])),
    fetchAll("finance_income_raw", incomeQuery),
  ]);
  safeLog("summary_fetch", { preset: filters.preset, month: filters.month, store: filters.store, startDate, endDate, orderRows: orderLines.length, skuRows: skuCosts.length, adRows: adRowsAll.length, incomeRawRows: incomeRawRows.length, ms: Date.now() - startedAt });
  
  // === AGGREGATE INCOME RAW (direct, no join to order_lines) ===
  let incomeSettlementCair = 0;  // SUM settlement WHERE Jenis transaksi = Pesanan
  let incomePotonganPlatform = 0;  // ABS(SUM total_fees) WHERE Jenis transaksi = Pesanan
  let incomePenggantian = 0;  // SUM settlement WHERE Jenis transaksi contains Penggantian
  let incomeIklanGMV = 0;  // ABS(SUM settlement) WHERE Jenis = Pembayaran GMV untuk Iklan TikTok
  let incomeRefundValid = 0;  // SUM refund WHERE NOT (settle=0 AND rev=0)
  for (const ir of incomeRawRows) {
    const type = String(ir.transaction_type || "").trim();
    const settlement = Number(ir.settlement_amount || 0);
    const fees = Number(ir.total_fees || 0);
    const refund = Number(ir.refund_amount || 0);
    if (type === "Pesanan") {
      incomeSettlementCair += settlement;
      incomePotonganPlatform += Math.abs(fees);
      // Refund valid: exclude pure refund rows (settle=0 AND rev=0)
      if (!(settlement === 0 && fees === 0 && refund !== 0)) {
        incomeRefundValid += Math.abs(refund);
      }
    }
    if (type.toLowerCase().includes("penggantian")) {
      incomePenggantian += settlement;
    }
    if (type === "Pembayaran GMV untuk Iklan TikTok") {
      incomeIklanGMV += Math.abs(settlement);
    }
  }
  // incomeSettlementCair, incomePotonganPlatform, incomePenggantian, incomeIklanGMV are now computed from raw
  const costs = new Map(skuCosts.map(row => [`${String(row.store_name || "").toLowerCase()}|${String(row.sku || "").toLowerCase()}`, row]));
  const rows = orderLines.map(row => {
    const storeKey = `${String(row.store_name || "").toLowerCase()}|${String(row.sku || "").toLowerCase()}`;
    const globalKey = `global|${String(row.sku || "").toLowerCase()}`;
    const cost = costs.get(storeKey) || costs.get(globalKey) || {};
    const dbHpp = Number(cost.hpp_per_unit || 0);
    const dbPacking = Number(cost.packing_per_unit || 0);
    // Fallback to special SKU HPP if DB has no mapping (supports POLA by variation)
    const skuToken = columnToken(row.sku || "");
    const specialHpp = getSpecialSkuHpp(skuToken, row.variation);
    const hppPerUnit = dbHpp > 0 ? dbHpp : specialHpp;
    // Packing = Rp 2000 per package (not per unit from DB, that's separate)
    const packingPerUnit = dbPacking > 0 ? dbPacking : 0;
    return {
      ...row,
      hpp_per_unit: hppPerUnit,
      packing_per_unit: packingPerUnit,
      _hasCost: dbHpp > 0 || specialHpp > 0,
      _unitHpp: hppPerUnit,  // Store the template HPP per unit
    };
  });

  const groups = new Map();
  for (const row of rows) {
    const groupKey = `${row.store_name || DEFAULT_STORE}|${row.order_id || row.line_key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  const sku = new Map();
  const daily = new Map();
  const stores = new Map();
  const status = new Map();
  const operationSummary = new Map();
  const operationDetails = [];
  const missingCost = new Set();
  const totals = {
    orders: new Set(),
    lines: 0,
    qty: 0,
    gross: 0,
    sellerDiscount: 0,
    omzet: 0,
    platformFee: 0,
    platformFeeFinal: 0,
    platformFeeEstimated: 0,
    platformDiscount: 0,
    hpp: 0,
    packing: 0,
    refund: 0,
    settlement: 0,
    adjustmentAmount: 0,
    held: 0,
    cancelledAmount: 0,
    profit: 0,
    profitBeforeAds: 0,
    adSpend: 0,
    adSpendTopup: 0,
    adSpendSettlement: 0,
    todayOrders: 0,
    finalProfit: 0,
    estimatedProfit: 0,
    finalProfitBeforeAds: 0,
    estimatedProfitBeforeAds: 0,
    finalAdSpend: 0,
    estimatedAdSpend: 0,
    settlementAdSpend: 0,
    finalOmzet: 0,
    estimatedOmzet: 0,
    finalOrders: new Set(),
    estimatedOrders: new Set(),
    heldOrders: new Set(),
    cancelledOrders: new Set(),
    bookGross: 0,
    bookSellerDiscount: 0,
    bookOmzet: 0,
    bookPlatformFee: 0,
    bookPlatformFeeFinal: 0,
    bookPlatformFeeEstimated: 0,
    bookSettlement: 0,
    bookHpp: 0,
    bookPacking: 0,
    bookRefund: 0,
    bookCancelledAmount: 0,
    bookHeld: 0,
    bookProfitBeforeAds: 0,
    bookProfit: 0,
    bookAdSpend: 0,
    bookOrders: new Set(),
    bookCancelledOrders: new Set(),
    cancelledPackages: 0,
    returnPackages: 0,
    cancelPackages: 0,
    bookCancelledPackages: 0,
    bookReturnPackages: 0,
    bookCancelPackages: 0,
  };
  const cancelValidOrders = new Set();
  let cancelValidPackagesTotal = 0;
  const bookMissingCost = new Set();
  const today = todayIso();
  const calcMode = filters.mode || "accrual";
  const adRows = adRowsAll
    .filter(row => {
      if (!startDate) return true;
      const d = normalizeDateForFilter(row.spend_date);
      if (!d) return false;
      return d >= startDate && d <= endDate;
    })
    .sort((a, b) => String(b.spend_date || "").localeCompare(String(a.spend_date || "")) || Number(b.id || 0) - Number(a.id || 0));
  for (const [groupKey, orderRows] of groups.entries()) {
    const basisRows = orderRows.filter(row => isBookSource(row));
    const operationRows = basisRows.length ? basisRows : orderRows;
    let financialRows = operationRows;
    const first = operationRows[0] || {};
    const createdDay = String(first.created_at || "").slice(0, 10) || "Tanpa tanggal";
    if (startDate) {
      if (createdDay === "Tanpa tanggal" || createdDay < startDate || createdDay > endDate) continue;
    }
    const operationPackageCount = Math.max(new Set(operationRows.map(row =>
      String(row.package_id || row.tracking_id || row.order_id || "").trim()
    ).filter(Boolean)).size, 1);
    const opReturned = operationRows.some(row => isReturnStatus(row.status, row.cancel_reason));
    const opCancelOnly = operationRows.some(row => isCancelStatus(row.status)) && !opReturned;
    const opUnpaid = operationRows.some(row => isUnpaidStatus(row.status));
    const orderId = groupKey;
    
    // Compute cancelValid early (needed by operationBucket)
    const statusToken = columnToken(first.status || "");
    const cancelReasonText = String(first.cancel_reason || "").trim();
    const isCancelValidReason = columnToken(cancelReasonText).includes("pengirimanpaketgagal") || columnToken(cancelReasonText).includes("pakethilang") || columnToken(cancelReasonText).includes("gagalkirim");
    const hasTracking = operationRows.some(row => String(row.tracking_id || "").trim().length > 0);
    const hasShipped = operationRows.some(row => String(row.shipped_time || "").trim().length > 0);
    const cancelValid = (opCancelOnly && isCancelValidReason && (hasTracking || hasShipped)) 
      || (statusToken.includes("selesai") && columnToken(first.cancel_reason || "").includes("cancel") && !columnToken(first.cancel_reason || "").includes("returnrefund"));
    if (cancelValid) {
      cancelValidOrders.add(orderId);
      cancelValidPackagesTotal += operationPackageCount;
    }
    const store = first.store_name || DEFAULT_STORE;
    totals.orders.add(orderId);
    totals.lines += operationRows.length;
    if (createdDay === today) totals.todayOrders += 1;
    if (!daily.has(createdDay)) daily.set(createdDay, { date: createdDay, orders: new Set(), omzet: 0, profit: 0 });
    daily.get(createdDay).orders.add(orderId);
    if (!stores.has(store)) stores.set(store, { store, orders: new Set(), omzet: 0, profit: 0 });
    stores.get(store).orders.add(orderId);
    for (const row of operationRows) {
      const statusKey = row.status || "Tanpa status";
      status.set(statusKey, (status.get(statusKey) || 0) + 1);
    }
    const opBucket = operationBucket(first.status, { returned: opReturned, cancelOnly: opCancelOnly, unpaid: opUnpaid, cancelValid, substatus: first.order_substatus || "", cancelReason: first.cancel_reason || "" });
    const ageDays = dayAge(createdDay, today);
    // Late: Menunggu Kirim/Ambil older than 0 days (past same-day deadline)
    const late = ["processing", "waiting_ship", "waiting_pickup"].includes(opBucket) && ageDays > 0;
    const op = operationSummary.get(opBucket) || {
      bucket: opBucket,
      label: OPERATION_LABELS[opBucket] || "Lainnya",
      orders: new Set(),
      packages: 0,
      late: 0,
    };
    op.orders.add(orderId);
    op.packages += operationPackageCount;
    if (late) op.late += operationPackageCount;
    operationSummary.set(opBucket, op);
    const trackingIds = Array.from(new Set(operationRows.map(row => String(row.tracking_id || "").trim()).filter(Boolean)));
    operationDetails.push({
      orderId: String(first.order_id || orderId),
      store,
      status: first.status || "Tanpa status",
      bucket: opBucket,
      label: OPERATION_LABELS[opBucket] || "Lainnya",
      packageCount: operationPackageCount,
      itemQty: operationRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      skuCount: new Set(operationRows.map(row => row.sku).filter(Boolean)).size,
      createdAt: createdDay,
      updatedAt: String(first.updated_at || "").slice(0, 10),
      trackingId: trackingIds.join(", "),
      cancelReason: String(first.cancel_reason || "").trim(),
      omzet: operationRows.reduce((sum, row) => sum + Math.abs(Number(row.gross_product || 0)) - Math.abs(Number(row.seller_discount || 0)), 0),
      late,
      ageDays,
      cancelValid,
    });
    if (opReturned || opCancelOnly) {
      totals.cancelledOrders.add(orderId);
      totals.cancelledPackages += operationPackageCount;
      if (opReturned) totals.returnPackages += operationPackageCount;
      if (opCancelOnly) totals.cancelPackages += operationPackageCount;
      if (basisRows.length) {
        totals.bookCancelledOrders.add(orderId);
        totals.bookCancelledPackages += operationPackageCount;
        if (opReturned) totals.bookReturnPackages += operationPackageCount;
        if (opCancelOnly) totals.bookCancelPackages += operationPackageCount;
      }
    }
    // Track missing costs before calculations
    const statusToken2 = columnToken(first.status || "");
    const subToken2 = columnToken(first.order_substatus || "");
    // isCompleted: Selesai always completed. Terkirim (Dikirim+C=Terkirim) = completed only in accrual
    const isCompleted = ["selesai", "completed"].includes(statusToken2);
    const isDelivered = statusToken2.includes("dikirim") && subToken2.includes("terkirim");
    // For settlement mode: also consider as completed if settlement received
    const isCompletedSettled = calcMode === "settlement" && hasIncomeSettlement(first) && Number(first.settlement_received || 0) > 0;
    // Accrual: Terkirim (delivered) = completed. Settlement: only with actual settlement data
    const effectiveCompleted = isCompleted || isCompletedSettled || (calcMode === "accrual" && isDelivered);
    const isShipped = statusToken2.includes("dikirim") || statusToken2.includes("shipped") ||
      statusToken2.includes("intransit") || statusToken2.includes("delivery");
    const revenueEligible = calcMode === "settlement" ? effectiveCompleted : (effectiveCompleted || isShipped);
    const costEligible = calcMode === "settlement" ? (effectiveCompleted || cancelValid) : (effectiveCompleted || isShipped || cancelValid);
    // For accrual: isFinal = Selesai, isEstimated = Dikirim
    const isFinalOrder = calcMode === "settlement" ? effectiveCompleted : effectiveCompleted;
    const isEstimatedOrder = calcMode === "accrual" && isShipped && !effectiveCompleted;
    for (const row of operationRows) {
      if (!row._hasCost && row.sku && row.sku !== "Tanpa SKU") {
        missingCost.add(row.sku);
        if (basisRows.length) bookMissingCost.add(row.sku);
      }
    }
    financialRows = operationRows; // Don't filter, track missing costs instead
    if (!financialRows.length) continue;
    const grossSum = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.gross_product || 0)), 0);
    const sellerDiscountTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.seller_discount || 0)), 0);
    const productNetTotal = Math.max(grossSum - sellerDiscountTotal, 0);
    const lineOrderTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.order_amount || 0)), 0);
    const maxOrderAmount = Math.max(...financialRows.map(row => Math.abs(Number(row.order_amount || 0))), 0);
    const orderTotal = grossSum ? productNetTotal : (maxOrderAmount || lineOrderTotal || grossSum);
    const settlementTotal = Math.max(...financialRows.map(row => actualSettlementAmount(row)), 0);
    const refundTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.refund_amount || 0)), 0);
    const hasIncome = financialRows.some(row => hasIncomeSettlement(row));
    const rawPlatformFeeTotal = hasIncome
      ? Math.max(...financialRows.map(row => Math.abs(Number(row.platform_fee || 0))), 0)
      : financialRows.reduce((sum, row) => sum + Math.abs(Number(row.platform_fee || 0)), 0);
    const impliedFinalFeeTotal = hasIncome && settlementTotal ? Math.max(orderTotal - settlementTotal, 0) : 0;
    // Accrual mode: split fees by order status (Selesai = real, Dikirim = estimated)
    let finalPlatformFeeTotal = 0;
    let estimatedPlatformFeeTotal = 0;
    if (hasIncome) {
      if (isFinalOrder) {
        finalPlatformFeeTotal = Math.max(rawPlatformFeeTotal, impliedFinalFeeTotal);
      } else if (isEstimatedOrder) {
        estimatedPlatformFeeTotal = rawPlatformFeeTotal;
      } else {
        finalPlatformFeeTotal = Math.max(rawPlatformFeeTotal, impliedFinalFeeTotal);
      }
    } else {
      estimatedPlatformFeeTotal = rawPlatformFeeTotal;
    }
    let platformFeeTotal = finalPlatformFeeTotal + estimatedPlatformFeeTotal;
    const platformDiscountTotal = financialRows.reduce((sum, row) => sum + Math.abs(Number(row.platform_discount || 0)), 0);
    const packageCount = operationPackageCount;
    const packingTotal = packageCount * 2000; // Flat rate Rp 2000 per package
    const isFinal = isFinalOrder;
    const isEstimated = isEstimatedOrder;
    const excluded = opCancelOnly || opUnpaid;  // Only cancel/unpaid excluded from revenue. Retur parsial tetap dihitung.
    const costBurned = costEligible; // Count cost for Selesai, Dikirim, and cancel-valid
    if (excluded) {
      const cancelledValue = refundTotal || orderTotal;
      totals.cancelledAmount += cancelledValue;
      if (basisRows.length) {
        totals.bookCancelledAmount += cancelledValue;
      }
      // Cancel-valid: still count packing (HPP counted via costBurned in per-line loop)
      if (cancelValid) {
        totals.packing += packingTotal;
      }
    } else if (revenueEligible) {
      totals.omzet += orderTotal;
      totals.gross += grossSum;
      totals.sellerDiscount += sellerDiscountTotal;
      totals.platformFee += platformFeeTotal;
      totals.platformFeeFinal += finalPlatformFeeTotal;
      totals.platformFeeEstimated += estimatedPlatformFeeTotal;
      totals.platformDiscount += platformDiscountTotal;
      totals.refund += refundTotal;
      totals.settlement += settlementTotal;
      // Penggantian = selisih positif settlement vs (orderAmount - platformFee) untuk order dgn income
      if (hasIncome && settlementTotal > 0) {
        const expectedSettlement = Math.max(orderTotal - finalPlatformFeeTotal, 0);
        const penggantian = Math.max(0, settlementTotal - expectedSettlement);
        totals.adjustmentAmount += penggantian;
      }
      const heldForOrder = isEstimated && !hasIncome ? Math.max(orderTotal - platformFeeTotal, 0) : 0;
      if (isFinal) {
        totals.finalOrders.add(orderId);
        totals.finalOmzet += orderTotal;
      } else if (isEstimated) {
        totals.estimatedOrders.add(orderId);
        totals.estimatedOmzet += orderTotal;
      }
      if (heldForOrder > 0 || (!hasIncome && !settlementTotal)) {
        totals.held += heldForOrder;
        totals.heldOrders.add(orderId);
      }
      const bookOrder = basisRows.length > 0;
      if (bookOrder) {
        totals.bookOrders.add(orderId);
        totals.bookGross += grossSum;
        totals.bookSellerDiscount += sellerDiscountTotal;
        totals.bookOmzet += orderTotal;
        totals.bookPlatformFee += platformFeeTotal;
        totals.bookPlatformFeeFinal += finalPlatformFeeTotal;
        totals.bookPlatformFeeEstimated += estimatedPlatformFeeTotal;
        totals.bookSettlement += settlementTotal;
        totals.bookRefund += refundTotal;
        totals.bookHeld += heldForOrder;
      }
      daily.get(createdDay).omzet += orderTotal;
      stores.get(store).omzet += orderTotal;
      // Packing per order
      totals.packing += packingTotal;
      if (bookOrder) totals.bookPacking += packingTotal;
    }
    const bookOrder = basisRows.length > 0;

    for (const row of financialRows) {
      const qty = Number(row.quantity || 0);
      const lineGross = Math.abs(Number(row.gross_product || 0));
      const share = grossSum ? lineGross / grossSum : 1 / Math.max(financialRows.length, 1);
      const omzet = excluded ? 0 : (revenueEligible ? orderTotal * share : 0);
      const platformFee = excluded ? 0 : (revenueEligible ? platformFeeTotal * share : 0);
      const refund = excluded ? 0 : (revenueEligible ? refundTotal * share : 0);
      const hpp = costBurned ? qty * Number(row.hpp_per_unit || 0) : 0;
      const packing = 0; // Packing is per-order, not per-line
      const profit = omzet - platformFee - refund - hpp - packing;
      totals.qty += qty;
      totals.hpp += hpp;
      // packing already added per-order above
      totals.profit += profit;
      if (bookOrder) {
        totals.bookHpp += hpp;
        totals.bookPacking += packing;
        totals.bookProfitBeforeAds += profit;
      }
      if (isFinal) totals.finalProfitBeforeAds += profit;
      else if (isEstimated) totals.estimatedProfitBeforeAds += profit;
      daily.get(createdDay).profit += profit;
      stores.get(store).profit += profit;
      const skuKey = row.sku || "Tanpa SKU";
      if (!sku.has(skuKey)) {
        sku.set(skuKey, {
          sku: skuKey,
          product: row.product_name || "",
          qty: 0,
          qtyCost: 0,
          orders: new Set(),
          stores: new Set(),
          omzet: 0,
          gross: 0,
          sellerDiscount: 0,
          profit: 0,
          profitBeforeAds: 0,
          hpp: 0,
          packing: 0,
          platformFee: 0,
          refund: 0,
          adSpend: 0,
          missingCost: false,
          unitHpp: row._unitHpp || 0,
        });
      }
      const item = sku.get(skuKey);
      item.qty += qty;
      if (costBurned) item.qtyCost += qty;
      item.orders.add(orderId);
      item.stores.add(store);
      item.omzet += omzet;
      item.gross += lineGross;
      item.sellerDiscount += Math.abs(Number(row.seller_discount || 0));
      item.profit += profit;
      item.hpp += hpp;
      item.packing += packing;
      item.platformFee += platformFee;
      item.refund += refund;
      if (!row._hasCost) item.missingCost = true;
    }
  }

  // === OVERRIDE settlement with income_raw values ===
  if (incomeRawRows && incomeRawRows.length > 0) {
    // Directly aggregate income_raw in-memory (already fetched)
    let settleSum = 0, feeSum = 0, gmvSum = 0, penggSum = 0, refSum = 0;
    for (const ir of incomeRawRows) {
      const type = String(ir.transaction_type || "").trim();
      const s = Number(ir.settlement_amount || 0);
      const f = Number(ir.total_fees || 0);
      const r = Number(ir.refund_amount || 0);
      if (type === "Pesanan") {
        settleSum += s;
        feeSum += Math.abs(f);
        refSum += Math.abs(r);
      } else if (type === "Pembayaran GMV untuk Iklan TikTok") {
        gmvSum += Math.abs(s);
      } else if (type.toLowerCase().includes("penggantian")) {
        penggSum += s;
      }
    }
    
    totals.settlement = Math.round(settleSum);
    totals.platformFee = Math.round(feeSum);
    totals.platformFeeFinal = Math.round(feeSum);
    totals.platformFeeEstimated = 0;
    totals.adSpendSettlement = Math.round(gmvSum);
    totals.settlementAdSpend = Math.round(gmvSum);
    totals.adjustmentAmount = Math.round(penggSum);
    totals.refund = Math.round(refSum);
    totals.bookSettlement = totals.settlement;
    totals.bookPlatformFee = totals.platformFee;
    totals.bookRefund = totals.refund;
    totals.bookPlatformFeeFinal = totals.platformFeeFinal;
    totals.bookPlatformFeeEstimated = 0;
    const omzetNet = totals.omzet || 0;
    totals.held = Math.max(0, omzetNet - totals.platformFee - totals.settlement);
    totals.bookHeld = totals.held;
  }
  
  for (const expense of adRows) {
    const amount = Number(expense.amount || 0);
    const settlementAd = columnToken(expense.channel).includes("settlement") || columnToken(expense.channel).includes("gmv") || columnToken(expense.note).includes("incomestatement") || columnToken(expense.note).includes("gmv");
    totals.adSpend += amount;
    if (settlementAd) {
      // Don't double-count: adSpendSettlement already set from income_raw (iklanGMV)
      // Only count if not already from income_raw
      if (!incomeRawRows.length) {
        totals.adSpendSettlement += amount;
        totals.settlementAdSpend += amount;
      }
    } else {
      totals.adSpendTopup += amount;
    }
    const spendDay = expense.spend_date || "Tanpa tanggal";
    if (!daily.has(spendDay)) daily.set(spendDay, { date: spendDay, orders: new Set(), omzet: 0, profit: 0 });
    const store = expense.store_name || DEFAULT_STORE;
    if (!stores.has(store)) stores.set(store, { store, orders: new Set(), omzet: 0, profit: 0 });
    if (!settlementAd) {
      daily.get(spendDay).profit -= amount;
      stores.get(store).profit -= amount;
    }
  }
  
  // RECOMPUTE totals.adSpend = settlement GMV + top up
  totals.adSpend = totals.adSpendSettlement + totals.adSpendTopup;

  // === RECOMPUTE PROFIT using correct formula per mode ===
  totals.profitBeforeAds = totals.profit; // Keep original per-group profit
  if (calcMode === "settlement" && incomeRawRows.length > 0) {
    // Settlement mode: profit based on actual cash flow
    const settlementBase = incomeSettlementCair + incomePenggantian;
    const hppTotal = totals.hpp || 0;
    const packingTotal = totals.packing || 0;
    const iklanGMVTotal = totals.adSpendSettlement || 0;
    const iklanTopUpTotal = totals.adSpendTopup || 0;
    const totalCost = hppTotal + packingTotal + iklanGMVTotal + iklanTopUpTotal;
    totals.profit = Math.round(settlementBase - totalCost);
    totals.bookProfit = Math.round(settlementBase - totalCost);
  } else {
    // Accrual mode: profit = omzetNet - potonganPlatform - refund + penggantian - hpp - packing - iklanTopUp - iklanGMV
    const omzetNet = totals.omzet || 0;
    const platformFee = totals.platformFee || 0;
    const refund = totals.refund || 0;
    const penggantian = totals.adjustmentAmount || 0;
    const hppTotal = totals.hpp || 0;
    const packingTotal = totals.packing || 0;
    const iklanGMVTotal = totals.adSpendSettlement || 0;
    const iklanTopUpTotal = totals.adSpendTopup || 0;
    const netTransaksi = omzetNet - platformFee - refund + penggantian;
    const totalBiaya = hppTotal + packingTotal + iklanGMVTotal + iklanTopUpTotal;
    totals.profit = Math.round(netTransaksi - totalBiaya);
    totals.bookProfit = Math.round(netTransaksi - totalBiaya);
  }
  totals.bookAdSpend = totals.adSpendTopup;
  totals.finalProfit = totals.profit;
  totals.estimatedProfit = 0;
  totals.finalProfitBeforeAds = totals.profitBeforeAds;
  totals.estimatedProfitBeforeAds = 0;
  if (totals.omzet) {
    totals.finalAdSpend = totals.adSpendTopup;
    totals.estimatedAdSpend = 0;
  }

  const dailyList = Array.from(daily.values()).map(item => ({ ...item, orders: item.orders.size })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const storeList = Array.from(stores.values()).map(item => ({ ...item, orders: item.orders.size }));
  for (const store of DEFAULT_STORES) {
    if (!storeList.some(item => item.store === store)) storeList.push({ store, orders: 0, omzet: 0, profit: 0 });
  }

  const skuDetails = Array.from(sku.values()).map(item => {
    const orders = item.orders.size;
    const storesList = Array.from(item.stores).sort();
    const adSpend = totals.omzet ? totals.adSpendTopup * item.omzet / totals.omzet : 0;
    const profitBeforeAds = item.profit;
    const profit = profitBeforeAds - adSpend;
    const margin = item.omzet ? profit / item.omzet * 100 : 0;
    let statusText = "Penghasil";
    let statusLevel = "good";
    if (item.missingCost) {
      statusText = "HPP belum lengkap";
      statusLevel = "warn";
    } else if (profit < 0) {
      statusText = "Rugi";
      statusLevel = "bad";
    } else if (margin < 10) {
      statusText = "Kurang bagus";
      statusLevel = "bad";
    } else if (margin < 20) {
      statusText = "Perlu dipantau";
      statusLevel = "watch";
    }
    return {
      ...item,
      orders,
      stores: storesList,
      profitBeforeAds,
      adSpend,
      profit,
      costTotal: item.hpp + item.packing + item.platformFee + item.refund + adSpend,
      margin,
      aov: orders ? item.omzet / orders : 0,
      status: statusText,
      statusLevel,
    };
  });
  const reliableSku = skuDetails.filter(item => !item.missingCost);
  const topSku = [...(reliableSku.length ? reliableSku : skuDetails)].sort((a, b) => b.profit - a.profit).slice(0, 12);
  const weakPriority = { bad: 0, warn: 1, watch: 2, good: 3 };
  const weakSku = [...skuDetails].sort((a, b) => (weakPriority[a.statusLevel] ?? 4) - (weakPriority[b.statusLevel] ?? 4) || a.profit - b.profit).slice(0, 8);
  const margin = totals.omzet ? totals.profit / totals.omzet * 100 : 0;
  const finalMargin = totals.finalOmzet ? totals.finalProfit / totals.finalOmzet * 100 : 0;
  const estimatedMargin = totals.estimatedOmzet ? totals.estimatedProfit / totals.estimatedOmzet * 100 : 0;
  const bookMargin = totals.bookOmzet ? totals.bookProfit / totals.bookOmzet * 100 : 0;
  // Fix store-level profit + omzet to match overridden totals
  for (const [storeName, storeData] of stores.entries()) {
    // Use totals for the matching store
    storeData.profit = totals.profit;
    storeData.omzet = totals.omzet || 0;
  }
  const primaryMargin = totals.bookOrders.size ? bookMargin : margin;
  const primaryOmzet = totals.bookOrders.size ? totals.bookOmzet : totals.omzet;
  const primaryProfit = totals.bookOrders.size ? totals.bookProfit : totals.profit;
  const alerts = [];
  if (primaryProfit < 0) alerts.push({ level: "danger", title: "Profit total negatif", body: "Perlu cek HPP, potongan, dan SKU rugi." });
  const marginText = Math.abs(primaryMargin) > 0 && Math.abs(primaryMargin) < 1 ? primaryMargin.toFixed(2) : primaryMargin.toFixed(1);
  if (primaryOmzet && primaryMargin < 12) alerts.push({ level: "warn", title: "Margin tipis", body: `Margin bersih sementara ${marginText}%.` });
  if (totals.adSpend && primaryOmzet && totals.adSpend / primaryOmzet > 0.2) alerts.push({ level: "warn", title: "Biaya iklan tinggi", body: "Biaya iklan lebih dari 20% omset periode ini." });
  if (totals.bookOmzet && !totals.bookSettlement && totals.estimatedOrders.size) {
    alerts.push({
      level: "warn",
      title: "Pencairan belum valid",
      body: "Order periode ini sudah masuk, tetapi income statement belum melekat. Upload ulang file pencairan bulan ini sampai rows_seen banyak dan settlement cair terisi.",
    });
  }
  const missingForAlert = totals.bookOrders.size ? bookMissingCost : missingCost;
  if (missingForAlert.size) alerts.push({ level: "warn", title: "Ada SKU tanpa HPP", body: `${missingForAlert.size} SKU belum punya HPP/packing.` });

  const rawMonths = Array.from(new Set([
    ...monthRows.map(row => String(row.created_at || "").slice(0, 7)).filter(Boolean),
  ]));
  const years = Array.from(new Set(rawMonths.map(month => month.slice(0, 4)).filter(Boolean))).sort().reverse();
  if (!years.length) years.push(String(new Date().getFullYear()));
  const availableMonths = years.flatMap(year => Array.from({ length: 12 }, (_, index) => `${year}-${String(12 - index).padStart(2, "0")}`));
  const runs = await fetchAll("finance_import_runs", "select=*&order=id.desc&limit=8");
  const auditQuery = filters.store !== "all"
    ? `select=*&store_name=eq.${encodeURIComponent(filters.store)}&order=id.desc&limit=40`
    : "select=*&order=id.desc&limit=40";
  const auditEvents = await fetchAll("finance_audit_events", auditQuery);
  const skuSummary = {
    total: skuDetails.length,
    profitable: skuDetails.filter(item => item.statusLevel === "good").length,
    watch: skuDetails.filter(item => item.statusLevel === "watch").length,
    bad: skuDetails.filter(item => item.statusLevel === "bad").length,
    missingCost: skuDetails.filter(item => item.missingCost).length,
    best: topSku[0] || null,
    weakest: weakSku[0] || null,
  };
  const counts = {
    orders: totals.orders.size,
    finalOrders: totals.finalOrders.size,
    estimatedOrders: totals.estimatedOrders.size,
    heldOrders: totals.heldOrders.size,
    cancelledOrders: totals.cancelledOrders.size,
    bookOrders: totals.bookOrders.size,
    bookCancelledOrders: totals.bookCancelledOrders.size,
    cancelledPackages: totals.cancelledPackages,
    returnPackages: totals.returnPackages,
    cancelPackages: totals.cancelPackages,
    bookCancelledPackages: totals.bookCancelledPackages,
    bookReturnPackages: totals.bookReturnPackages,
    bookCancelPackages: totals.bookCancelPackages,
    cancelValidOrders: cancelValidOrders.size,
    cancelValidPackages: cancelValidPackagesTotal,
  };
  const operationStatus = Array.from(operationSummary.values())
    .map(item => ({ ...item, orders: item.orders.size }))
    .sort((a, b) => b.packages - a.packages);
  // Ensure all known buckets appear (even if 0) so frontend shows proper labels
  for (const [bucket, label] of Object.entries(OPERATION_LABELS)) {
    if (!operationStatus.some(o => o.bucket === bucket)) {
      operationStatus.push({ bucket, label, orders: 0, packages: 0, late: 0 });
    }
  }
  const sortedOperationDetails = operationDetails
    .sort((a, b) => Number(b.late) - Number(a.late) || Number(b.ageDays) - Number(a.ageDays) || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 300);
  const assistant = buildAssistant({ ...totals, ...counts }, primaryMargin, topSku, weakSku, missingForAlert, dailyList);
  
  // === FINAL OVERRIDE: Compute settlement directly from incomeRawRows ===
  // Only count rows where Related Order ID matches an existing order (PM requirement)
  if (incomeRawRows && incomeRawRows.length > 0) {
    const validOrderIds = new Set();
    for (const row of orderLines) {
      const oid = String(row.order_id || "").trim();
      if (oid) validOrderIds.add(oid);
    }
    let sSum = 0, fSum = 0, gSum = 0, pSum = 0;
    for (const ir of incomeRawRows) {
      const t = String(ir.transaction_type || '').trim();
      const amt = Number(ir.settlement_amount || 0);
      if (t === 'Pesanan') {
        // Only count if order_id matches an existing order in finance_order_lines
        if (validOrderIds.has(String(ir.order_id || '').trim())) {
          sSum += amt;
          fSum += Math.abs(Number(ir.total_fees || 0));
        }
      }
      else if (t === 'Pembayaran GMV untuk Iklan TikTok') { gSum += Math.abs(amt); }
      else if (t.toLowerCase().indexOf('penggantian') >= 0) { pSum += amt; }
    }
    if (sSum !== 0) {
      totals.settlement = Math.round(sSum);
      totals.platformFee = Math.round(fSum);
      totals.platformFeeFinal = Math.round(fSum);
      totals.platformFeeEstimated = 0;
      totals.adSpendSettlement = Math.round(gSum);
      totals.settlementAdSpend = Math.round(gSum);
      totals.adjustmentAmount = Math.round(pSum);
      totals.adSpend = (totals.adSpendTopup || 0) + Math.round(gSum);
      // Recalculate profit
      const omz = totals.omzet || totals.bookOmzet || 0;
      const hppPkg = (totals.hpp || 0) + (totals.packing || 0);
      const adTop = totals.adSpendTopup || 0;
      totals.profit = Math.round(sSum + pSum - hppPkg - adTop - gSum);
      totals.bookProfit = totals.profit;
    }
  }
  
  return {
    generatedAt: nowIso(),
    totals: { ...totals, ...counts, margin, finalMargin, estimatedMargin, bookMargin, adjustmentAmount: Math.round(totals.adjustmentAmount || 0) },
    daily: dailyList.slice(-30),
    topSku,
    weakSku,
    skuDetails: skuDetails.sort((a, b) => b.profit - a.profit),
    skuSummary,
    stores: storeList.sort((a, b) => b.omzet - a.omzet),
    status: Array.from(status.entries()).map(([key, value]) => ({ status: key, count: value })).sort((a, b) => b.count - a.count),
    operationStatus,
    operationDetails: sortedOperationDetails,
    missingCost: Array.from(missingCost).slice(0, 30),
    alerts,
    assistant,
    diagnostics: {
      summaryMs: Date.now() - startedAt,
      fetchedOrderRows: orderLines.length,
      fetchedSkuRows: skuCosts.length,
      fetchedAdRows: adRowsAll.length,
      fetchedIncomeRows: incomeRawRows.length,
      filteredOrderGroups: totals.orders.size,
      note: "Jika angka kosong/lemot, cek Vercel Function Logs label [finance-dashboard] summary_fetch."
    },
    filters: { ...filters, startDate, endDate },
    availableMonths,
    availableStores: DEFAULT_STORES,
    adSpendRows: adRows.slice(0, 100),
    runs,
    auditEvents,
  };
}

async function computeDataQuality(filters = { preset: "thisMonth", month: "", store: "all" }) {
  const startedAt = Date.now();
  if (!supabaseConfigured()) {
    return { generatedAt: nowIso(), statusKeseluruhan: "tidak_tersedia", skorKualitas: 0, ringkasan: "Supabase belum dikonfigurasi.", skuTanpaHpp: [], orderTanpaPencairan: [], pencairanTanpaOrder: [], cancelRefundBesar: [], dataDuplikat: [], saran: ["Konfigurasi environment Supabase di Vercel dulu."], diagnostics: { ms: Date.now() - startedAt } };
  }
  const [startDate, endDate] = dateRangeFromFilters(filters);
  const storeFilter = filters.store !== "all" ? `store_name=eq.${encodeURIComponent(filters.store)}` : "";
  const orderQuery = compactQuery(["select=*", storeFilter, dateAndFilter("created_at", startDate, endDate)]);
  const [allOrderLines, allSkuCosts, allSettlementLines] = await Promise.all([
    fetchAll("finance_order_lines", orderQuery),
    fetchAll("finance_sku_costs", "select=*"),
    fetchAll("finance_order_lines", compactQuery(["select=*", storeFilter, "source=eq.incomestatement"])),
  ]);
  safeLog("data_quality_fetch", { orderRows: allOrderLines.length, skuRows: allSkuCosts.length, settlementRows: allSettlementLines.length, ms: Date.now() - startedAt });

  // 1. SKU TANPA HPP
  const skuCostMap = new Map(allSkuCosts.map(r => [`${String(r.store_name||"").toLowerCase()}|${String(r.sku||"").toLowerCase()}`, r]));
  const skuGlobalMap = new Map(allSkuCosts.filter(r => (r.store_name||"").toLowerCase()==="global" && r.sku).map(r=>[String(r.sku||"").toLowerCase(),r]));
  const skuHppSeen = new Set(), skuTanpaHppSet = new Set();
  const skuTanpaHppDetail = [];
  for (const row of allOrderLines) {
    const sku = String(row.sku||"").trim(); if(!sku) continue;
    const storeKey = `${String(row.store_name||"").toLowerCase()}|${sku.toLowerCase()}`;
    const globalKey = sku.toLowerCase();
    if(skuCostMap.has(storeKey)||skuGlobalMap.has(globalKey)){
      const cost = skuCostMap.get(storeKey)||skuGlobalMap.get(globalKey)||{};
      if(Number(cost.hpp_per_unit||0)>0||Number(cost.packing_per_unit||0)>0){ skuHppSeen.add(sku.toLowerCase()); continue; }
    }
    if(!skuHppSeen.has(sku.toLowerCase())&&!skuTanpaHppSet.has(sku.toLowerCase())){
      skuTanpaHppSet.add(sku.toLowerCase());
      skuTanpaHppDetail.push({sku,store:row.store_name||"-",product:row.product_name||"",qtyTotal:0,omzetTotal:0});
    }
  }
  const skuAgg = new Map();
  for(const row of allOrderLines){
    const sku = String(row.sku||"").trim().toLowerCase();
    if(!skuTanpaHppSet.has(sku)) continue;
    const key = `${row.store_name||""}|${sku}`;
    if(!skuAgg.has(key)) skuAgg.set(key,{qty:0,omzet:0});
    const agg = skuAgg.get(key); agg.qty+=Number(row.quantity||0); agg.omzet+=Math.abs(Number(row.order_amount||0));
  }
  for(const item of skuTanpaHppDetail){
    const agg = skuAgg.get(`${item.store}|${item.sku.toLowerCase()}`);
    if(agg){ item.qtyTotal=agg.qty; item.omzetTotal=agg.omzet; }
  }

  // 2. ORDER TANPA PENCAIRAN
  const orderTanpaPencairan = [];
  const orderGroups = new Map();
  for(const row of allOrderLines){
    const gk = `${row.store_name||DEFAULT_STORE}|${row.order_id||row.line_key}`;
    if(!orderGroups.has(gk)) orderGroups.set(gk,[]);
    orderGroups.get(gk).push(row);
  }
  for(const[gk,rows]of orderGroups){
    const f=rows[0]||{}; const st=String(f.status||"").toLowerCase();
    if(isCancelledStatus(st)||isUnpaidStatus(st)) continue;
    if(rows.reduce((s,r)=>s+actualSettlementAmount(r),0)>0) continue;
    orderTanpaPencairan.push({
      orderId:String(f.order_id||gk), store:f.store_name||DEFAULT_STORE,
      sku:rows.map(r=>r.sku).filter(Boolean).join(", "),
      total:rows.reduce((s,r)=>s+Math.abs(Number(r.order_amount||0)),0),
      created:String(f.created_at||"").slice(0,10)||"-",
      ageDays:dayAge(String(f.created_at||"").slice(0,10),todayIso()),
      lineCount:rows.length,
    });
  }
  orderTanpaPencairan.sort((a,b)=>b.ageDays-a.ageDays||b.total-a.total);

  // 3. PENCAIRAN TANPA ORDER
  const orderIdSet = new Set(allOrderLines.filter(r=>!isCancelledStatus(r.status)).map(r=>String(r.order_id||"").trim()).filter(Boolean));
  const seenSettle=new Set();
  const pencairanTanpaOrder=[];
  for(const row of allSettlementLines){
    const oid=String(row.order_id||"").trim(); if(!oid||seenSettle.has(oid)) continue;
    if(!orderIdSet.has(oid)){ seenSettle.add(oid); pencairanTanpaOrder.push({orderId:oid,store:row.store_name||"-",sku:row.sku||"",amount:actualSettlementAmount(row),source:row.last_seen_file||"incomestatement"}); }
  }

  // 4. ORDER CANCEL/REFUND BESAR
  const cancelRefundBesar=[];
  for(const[gk,rows]of orderGroups){
    const f=rows[0]||{}; if(!isCancelledStatus(f.status)) continue;
    const tv=rows.reduce((s,r)=>s+Math.abs(Number(r.order_amount||r.refund_amount||0)),0);
    cancelRefundBesar.push({orderId:String(f.order_id||gk),store:f.store_name||DEFAULT_STORE,sku:rows.map(r=>r.sku).filter(Boolean).join(", "),total:tv,isReturn:rows.some(r=>isReturnStatus(r.status)),status:f.status||"-",created:String(f.created_at||"").slice(0,10)});
  }
  cancelRefundBesar.sort((a,b)=>b.total-a.total);

  // 5. DATA DUPLIKAT
  const lkCnt=new Map();
  for(const row of allOrderLines){const k=row.line_key||"";if(!k)continue;lkCnt.set(k,(lkCnt.get(k)||0)+1);}
  const duplikat=[];
  for(const[k,c]of lkCnt){if(c<=1)continue;const rows=allOrderLines.filter(r=>r.line_key===k);duplikat.push({lineKey:k,orderId:rows[0]?.order_id||"",store:rows[0]?.store_name||"",sku:rows[0]?.sku||"",count:c,totalValues:rows.reduce((s,r)=>s+Math.abs(Number(r.order_amount||0)),0)});}
  duplikat.sort((a,b)=>b.count-a.count);

  // SKOR
  let skor=100; const ri=[],saran=[];
  if(skuTanpaHppDetail.length>0){const d=new Set(skuTanpaHppDetail.map(x=>x.sku.toLowerCase())).size;const p=Math.min(d*8,30);skor-=p;ri.push(`${d} SKU tanpa HPP (-${p})`);saran.push(`Lengkapi HPP/packing untuk ${d} SKU yang belum terdata.`);}
  if(orderTanpaPencairan.length>0){const r=allOrderLines.filter(x=>!isCancelledStatus(x.status)).length?orderTanpaPencairan.length/allOrderLines.filter(x=>!isCancelledStatus(x.status)).length*100:0;const p=Math.min(Math.round(r*0.3),25);skor-=p;ri.push(`${orderTanpaPencairan.length} order selesai belum cair (${r.toFixed(0)}% -${p})`);saran.push(`Upload income statement untuk ${orderTanpaPencairan.length} order yang sudah selesai tapi belum tercairkan.`);}
  if(pencairanTanpaOrder.length>0){const p=Math.min(pencairanTanpaOrder.length*5,15);skor-=p;ri.push(`${pencairanTanpaOrder.length} pencairan tidak matched (-${p})`);saran.push(`Cek ${pencairanTanpaOrder.length} data settlement yang tidak cocok dengan order manapun.`);}
  const cb=cancelRefundBesar.filter(c=>c.total>=50000);
  if(cb.length>0){const tr=cb.reduce((s,c)=>s+c.total,0);const p=Math.min(Math.round(tr/50000),15);skor-=p;ri.push(`${cb.length} cancel/refund >=Rp50rb (total Rp${tr.toLocaleString("id-ID")} -${p})`);saran.push(`Audit ${cb.length} order cancel/refund besar untuk cek penyebab dan pola.`);}
  if(duplikat.length>0){const p=Math.min(duplikat.length*4,15);skor-=p;ri.push(`${duplikat.length} data duplikat (-${p})`);saran.push(`Hapus ${duplikat.length} data duplikat untuk mencegah perhitungan dobel.`);}
  skor=Math.max(0,Math.min(100,skor));
  let statusK="baik"; if(skor<50)statusK="waspada"; else if(skor<75)statusK="sedang";
  safeLog("data_quality_result",{skor,status:statusK,skuTanpaHpp:skuTanpaHppDetail.length,orderTanpaPencairan:orderTanpaPencairan.length,pencairanTanpaOrder:pencairanTanpaOrder.length,cancelRefundBesar:cancelRefundBesar.length,duplikat:duplikat.length,ms:Date.now()-startedAt});
  return{
    generatedAt:nowIso(),statusKeseluruhan:statusK,skorKualitas:skor,ringkasan:ri.join("; "),
    skuTanpaHpp:skuTanpaHppDetail.slice(0,50), orderTanpaPencairan:orderTanpaPencairan.slice(0,50),
    pencairanTanpaOrder:pencairanTanpaOrder.slice(0,30), cancelRefundBesar:cancelRefundBesar.slice(0,30),
    dataDuplikat:duplikat.slice(0,30), saran,
    diagnostics:{ms:Date.now()-startedAt}, filters:{...filters,startDate,endDate},
  };
}

function buildAssistant(totals, margin, topSku, weakSku, missingCost, dailyList) {
  const adSpend = Number(totals.adSpend || 0);
  const adSpendTopup = Number(totals.adSpendTopup || 0);
  const adSpendSettlement = Number(totals.adSpendSettlement || totals.settlementAdSpend || 0);
  const hasBook = Number(totals.bookOrders || 0) > 0 || Number(totals.bookOmzet || 0) > 0;
  const omzet = hasBook ? Number(totals.bookOmzet || 0) : Number(totals.omzet || 0);
  const held = hasBook ? Number(totals.bookHeld || 0) : Number(totals.held || 0);
  const refund = hasBook ? Number(totals.bookCancelledAmount || 0) : Number(totals.refund || 0);
  const platformFee = hasBook ? Number(totals.bookPlatformFee || 0) : Number(totals.platformFee || 0);
  const accountingOmzet = hasBook ? Number(totals.bookOmzet || 0) : Number(totals.omzet || 0);
  const accountingProfit = hasBook ? Number(totals.bookProfit || 0) : Number(totals.profit || 0);
  const heldRatio = omzet ? held / omzet * 100 : 0;
  const refundRatio = omzet ? refund / omzet * 100 : 0;
  const feeRatio = omzet ? platformFee / omzet * 100 : 0;
  const adRatio = omzet ? adSpend / omzet * 100 : 0;
  let score = 70;
  if (margin >= 30) score += 15;
  else if (margin < 15) score -= 20;
  if (heldRatio > 40) score -= 12;
  if (refundRatio > 10) score -= 10;
  if (adRatio > 20) score -= 10;
  if (missingCost.size) score -= 12;
  score = Math.max(0, Math.min(100, score));
  const last14 = dailyList.slice(-14);
  const avgDaily = last14.reduce((sum, item) => sum + Number(item.omzet || 0), 0) / Math.max(last14.length, 1);
  const forecast30Omzet = avgDaily * 30;
  const forecast30Profit = omzet ? forecast30Omzet * (margin / 100) : 0;
  const insights = [];
  const actions = [];
  const marginText = Math.abs(margin) > 0 && Math.abs(margin) < 1 ? margin.toFixed(2) : margin.toFixed(1);
  if (margin >= 30) insights.push(`Margin bersih kuat di ${marginText}%. Bisnis terlihat sehat, selama HPP semua SKU sudah lengkap.`);
  else if (margin >= 15) insights.push(`Margin bersih sedang di ${marginText}%. Masih sehat, tapi ruang salah harga dan promo mulai sempit.`);
  else insights.push(`Margin bersih tipis di ${marginText}%. Ini perlu dipantau sebelum menaikkan budget iklan atau diskon.`);
  if (heldRatio > 30) {
    insights.push(`Dana tertahan sekitar ${heldRatio.toFixed(1)}% dari omset terdata.`);
    actions.push("Prioritaskan cek order belum selesai/cair supaya kas harian tidak terlihat semu.");
  }
  if (refundRatio > 8) {
    insights.push(`Refund cukup tinggi, sekitar ${refundRatio.toFixed(1)}% dari omset.`);
    actions.push("Audit SKU dengan refund tertinggi dan cek penyebab retur/cancel.");
  }
  if (feeRatio > 8) actions.push("Cek potongan platform dan promo, terutama jika biaya platform naik tanpa kenaikan order.");
  if (adSpend) {
    insights.push(`Biaya iklan tercatat ${adRatio.toFixed(1)}% dari omset periode ini.`);
    if (adRatio > 20) actions.push("Turunkan atau evaluasi campaign iklan yang ROAS/profit SKU-nya belum jelas.");
  }
  if (missingCost.size) actions.push(`Lengkapi HPP untuk ${missingCost.size} SKU agar profit tidak terlalu optimistis.`);
  if (!hasBook && Number(totals.estimatedOmzet || 0) > Number(totals.finalOmzet || 0)) {
    insights.push("Porsi profit estimasi masih lebih besar dari profit final, jadi keputusan cashflow sebaiknya menunggu pencairan berikutnya.");
    actions.push("Pantau daftar order belum cair dan bandingkan dengan pencairan upload berikutnya.");
  }
  if (topSku[0]) actions.push(`SKU ${topSku[0].sku} paling produktif. Pastikan stok, bahan, dan kapasitas produksi aman.`);
  if (weakSku[0]) actions.push(`SKU ${weakSku[0].sku} perlu dicek harga, HPP, promo, atau kualitas traffic.`);
  return {
    score,
    health: score >= 75 ? "Sehat" : score >= 55 ? "Perlu Dipantau" : "Butuh Tindakan",
    forecast30Omzet,
    forecast30Profit,
    accounting: {
      pendapatan: accountingOmzet,
      omzetKotor: Number(totals[hasBook ? "bookGross" : "gross"] || 0),
      diskonSeller: Number(totals[hasBook ? "bookSellerDiscount" : "sellerDiscount"] || 0),
      omzetNet: accountingOmzet,
      settlementCair: Number(totals[hasBook ? "bookSettlement" : "settlement"] || 0),
      hppPacking: hasBook ? Number(totals.bookHpp || 0) + Number(totals.bookPacking || 0) : Number(totals.hpp || 0) + Number(totals.packing || 0),
      hpp: Number(totals[hasBook ? "bookHpp" : "hpp"] || 0),
      packing: Number(totals[hasBook ? "bookPacking" : "packing"] || 0),
      potonganPlatform: Number(totals[hasBook ? "bookPlatformFee" : "platformFee"] || 0),
      potonganPlatformFinal: Number(totals[hasBook ? "bookPlatformFeeFinal" : "platformFeeFinal"] || 0),
      potonganPlatformEstimasi: Number(totals[hasBook ? "bookPlatformFeeEstimated" : "platformFeeEstimated"] || 0),
      biayaIklan: adSpend,
      biayaIklanSettlement: adSpendSettlement,
      biayaIklanTopup: adSpendTopup,
      totalBiaya: (hasBook ? Number(totals.bookHpp || 0) + Number(totals.bookPacking || 0) : Number(totals.hpp || 0) + Number(totals.packing || 0)) + adSpendTopup,
      danaTertahan: Number(totals[hasBook ? "bookHeld" : "held"] || 0),
      refund: hasBook ? Number(totals.bookCancelledAmount || 0) : refund,
      returCancel: Number(totals[hasBook ? "bookCancelledAmount" : "cancelledAmount"] || 0),
      profitBersih: accountingProfit,
      profitEstimasi: accountingProfit,
      profitFinal: hasBook ? accountingProfit : Number(totals.finalProfit || 0),
      profitBelumFinal: Number(totals.estimatedProfit || 0),
      omsetFinal: hasBook ? accountingOmzet : Number(totals.finalOmzet || 0),
      omsetBelumFinal: Number(totals.estimatedOmzet || 0),
    },
    insights,
    actions: actions.slice(0, 6),
  };
}

function redactSummary(summary, role = "team") {
  const safe = JSON.parse(JSON.stringify(summary));
  safe.accessRole = role;
  for (const key of SECRET_TOTAL_KEYS) {
    if (safe.totals && key in safe.totals) safe.totals[key] = 0;
  }
  for (const row of safe.daily || []) row.profit = 0;
  for (const row of safe.stores || []) delete row.profit;
  safe.topSku = (safe.topSku || []).map(row => ({
    sku: row.sku,
    product: row.product,
    qty: row.qty || 0,
    orders: row.orders || 0,
    omzet: row.omzet || 0,
  }));
  safe.weakSku = [];
  safe.skuDetails = [];
  safe.skuSummary = { total: safe.skuSummary?.total || 0, profitable: 0, watch: 0, bad: 0, missingCost: 0, best: safe.topSku[0] || null, weakest: null };
  safe.alerts = [{ level: "warn", title: "Mode tim aktif", body: "Profit, HPP, pencairan, refund, potongan, biaya iklan, dan audit sensitif disembunyikan." }];
  safe.assistant = {
    score: 0,
    health: "Mode Tim",
    forecast30Omzet: safe.assistant?.forecast30Omzet || 0,
    forecast30Profit: 0,
    accounting: {
      pendapatan: safe.totals?.omzet || 0,
      omzetKotor: 0,
      diskonSeller: 0,
      omzetNet: safe.totals?.omzet || 0,
      settlementCair: 0,
      hppPacking: 0,
      hpp: 0,
      packing: 0,
      potonganPlatform: 0,
      potonganPlatformFinal: 0,
      potonganPlatformEstimasi: 0,
      biayaIklan: 0,
      biayaIklanSettlement: 0,
      biayaIklanTopup: 0,
      totalBiaya: 0,
      danaTertahan: 0,
      refund: 0,
      returCancel: 0,
      profitBersih: 0,
      profitEstimasi: 0,
      profitFinal: 0,
      profitBelumFinal: 0,
      omsetFinal: 0,
      omsetBelumFinal: 0,
    },
    insights: ["Mode tim hanya menampilkan data operasional yang aman untuk dibagikan."],
    actions: ["Gunakan akses owner untuk melihat profit, biaya, pencairan, dan rekomendasi finansial lengkap."],
  };
  safe.adSpendRows = [];
  safe.auditEvents = [];
  safe.runs = [];
  return safe;
}

async function telegramReportSummaries() {
  const yesterday = dateOffsetIso(-1);
  const start30 = dateOffsetIso(-30);
  const yesterdaySummary = await computeSummary({ preset: "custom", startDate: yesterday, endDate: yesterday, store: "all" });
  const last30Summary = await computeSummary({ preset: "custom", startDate: start30, endDate: yesterday, store: "all" });
  return { yesterdaySummary, last30Summary };
}

function telegramMessage(summary, last30Summary = null) {
  const t = summary.totals || {};
  const m = (last30Summary && last30Summary.totals) || t;
  const top = last30Summary?.topSku?.[0] || summary.topSku?.[0] || { sku: "-", profit: 0 };
  const weak = last30Summary?.weakSku?.[0] || summary.weakSku?.[0] || { sku: "-", profit: 0 };
  const alerts = (summary.alerts || []).map(item => `- ${item.title}: ${item.body}`).join("\n") || "- Tidak ada alert besar";
  const money = value => `Rp${Math.round(Number(value || 0)).toLocaleString("id-ID")}`;
  const hasBook = Number(t.bookOrders || 0) > 0 || Number(t.bookOmzet || 0) > 0;
  const hasBook30 = Number(m.bookOrders || 0) > 0 || Number(m.bookOmzet || 0) > 0;
  const accountingOmzet = hasBook ? t.bookOmzet : t.omzet;
  const accountingProfit = hasBook ? t.bookProfit : t.finalProfit;
  const accountingMargin = hasBook ? t.bookMargin : t.finalMargin;
  const monthOmzet = hasBook30 ? m.bookOmzet : m.omzet;
  const monthProfit = hasBook30 ? m.bookProfit : m.finalProfit;
  const monthMargin = hasBook30 ? m.bookMargin : m.finalMargin;
  const yesterdayLabel = summary.filters?.startDate || "kemarin";
  const last30Label = last30Summary?.filters ? `${last30Summary.filters.startDate} s/d ${last30Summary.filters.endDate}` : "30 hari terakhir";
  return [
    "Ringkasan Keuangan TikTok",
    `Waktu: ${summary.generatedAt}`,
    `Update kemarin: ${yesterdayLabel}`,
    "",
    "Kemarin",
    `Order unik: ${t.orders || 0}`,
    `Omzet net: ${money(accountingOmzet)}`,
    `Settlement cair: ${money(hasBook ? t.bookSettlement : t.settlement)}`,
    `Dana tertahan: ${money(hasBook ? t.bookHeld : t.held)}`,
    `Potongan platform: ${money(hasBook ? t.bookPlatformFee : t.platformFee)}`,
    `Iklan settlement: ${money(t.adSpendSettlement || t.settlementAdSpend)}`,
    `Iklan top up: ${money(t.adSpendTopup)}`,
    `Profit bersih: ${money(accountingProfit)} (${Number(accountingMargin || 0).toFixed(1)}%)`,
    "",
    `30 hari terakhir (${last30Label})`,
    `Order unik: ${m.orders || 0}`,
    `Omzet net: ${money(monthOmzet)}`,
    `Settlement cair: ${money(hasBook30 ? m.bookSettlement : m.settlement)}`,
    `Dana tertahan: ${money(hasBook30 ? m.bookHeld : m.held)}`,
    `Potongan platform: ${money(hasBook30 ? m.bookPlatformFee : m.platformFee)}`,
    `Iklan settlement: ${money(m.adSpendSettlement || m.settlementAdSpend)}`,
    `Iklan top up: ${money(m.adSpendTopup)}`,
    `Profit bersih: ${money(monthProfit)} (${Number(monthMargin || 0).toFixed(1)}%)`,
    "",
    `SKU terbaik 30 hari: ${top.sku} (${money(top.profit)})`,
    `SKU perhatian 30 hari: ${weak.sku} (${money(weak.profit)})`,
    "",
    "Alert kemarin:",
    alerts,
  ].join("\n");
}

async function sendTelegram(summary, last30Summary = null) {
  const config = await readConfig();
  if (!config.telegramBotToken || !config.telegramChatId) throw new Error("Bot Token dan Chat ID Telegram belum diisi.");
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChatId, text: telegramMessage(summary, last30Summary) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || "Telegram menolak pesan.");
  return data;
}

module.exports = {
  DEFAULT_STORES,
  DEFAULT_STORE,
  normalizeStore,
  json,
  readJson,
  supabaseConfigured,
  supabaseSetupMessage,
  pgConfigured: supabaseConfigured,
  pgSetupMessage: supabaseSetupMessage,
  nowIso,
  emptySummary,
  buildFilters,
  computeSummary,
  computeDataQuality,
  redactSummary,
  importRows,
  readConfig,
  saveConfig,
  safeConfig,
  safeLog,
  ownerPinValid,
  requireOwner,
  normalizeStore,
  saveAdSpend,
  sendTelegram,
  telegramReportSummaries,
  normalizeDateForFilter,
};
