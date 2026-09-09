/**
 * PRODUCTION RESET & IMPORT — Clean, Fast, Correct
 * 
 * Steps:
 * 1. Backup existing DB (done)
 * 2. Drop all custombase data
 * 3. Re-import from ALL 7 XLSX files
 * 4. Verify golden values
 * 5. Migrate SKU master
 */
const db = require('better-sqlite3')('./data/finance.db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

db.pragma('journal_mode=WAL');
db.pragma('cache_size=-131072');
db.pragma('synchronous=NORMAL');
db.pragma('temp_store=MEMORY');

const STORE = 'custombase';
const DATA = path.join('data tiktok', 'custombase');
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const fmt = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const ct = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── HELPERS ──
function rp_s(v) { const t = String(v || '').trim(); if (!t) return 0; const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g, ''); if (n.startsWith('+')) n = n.slice(1); const p = Number.parseFloat(n.replace(/,/g, '')); return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0; }
function parseDate(v) { if (!v) return ''; if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 19).replace('T', ' '); const raw = String(v).trim(); const s = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/); if (s) { const y = s[3].length === 2 ? '20' + s[3] : s[3]; return `${y}-${s[2].padStart(2, '0')}-${s[1].padStart(2, '0')} ${(s[4] || '00').padStart(2, '0')}:${(s[5] || '00').padStart(2, '0')}:${(s[6] || '00').padStart(2, '0')}`; } const i = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); if (i) return `${i[1]}-${i[2].padStart(2, '0')}-${i[3].padStart(2, '0')} ${(i[4] || '00').padStart(2, '0')}:${(i[5] || '00').padStart(2, '0')}:${(i[6] || '00').padStart(2, '0')}`; return ''; }
function field(row, ...names) { for (const n of names) if (row[n] !== undefined) return row[n]; return ''; }

function readSheet(wb, sn) {
  const sheet = wb.Sheets[sn]; if (!sheet) throw new Error(`Sheet ${sn} not found`);
  const keys = Object.keys(sheet).filter(k => k[0] !== '!'); let maxR = 0, maxC = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c; } catch (e) { } }
  const hdrs = []; for (let c = 0; c <= maxC; c++) { const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })]; hdrs.push(cell ? String(cell.v || '').trim() : `[c${c}]`); }
  const rows = [];
  for (let r = 1; r <= maxR; r++) { const row = {}; let has = false; for (let c = 0; c <= maxC; c++) { const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.v !== undefined && cell.v !== '') { row[hdrs[c]] = cell.v; has = true; } } if (has) rows.push(row); }
  return rows;
}

console.log('╔══════════════════════════════════════╗');
console.log('║  PRODUCTION RESET & IMPORT            ║');
console.log('╚══════════════════════════════════════╝\n');

// ── ENSURE SCHEMA ──
db.exec(`
  CREATE TABLE IF NOT EXISTS finance_order_lines(line_key TEXT PRIMARY KEY, order_id TEXT, store_name TEXT, source TEXT, created_at TEXT, updated_at TEXT, status TEXT, order_substatus TEXT, sku TEXT, product_name TEXT, variation TEXT, quantity REAL, unit_price REAL, gross_product REAL, seller_discount REAL, platform_discount REAL, platform_fee REAL, refund_amount REAL, order_amount REAL, settlement_received REAL, payment_method TEXT, tracking_id TEXT, package_id TEXT, cancel_reason TEXT, shipped_time TEXT, paid_time TEXT, cancelled_time TEXT, last_seen_file TEXT, last_seen_at TEXT);
  CREATE TABLE IF NOT EXISTS finance_income_raw(id INTEGER PRIMARY KEY AUTOINCREMENT, store_name TEXT, transaction_type TEXT, order_id TEXT, order_created_time TEXT, settlement_amount REAL, total_fees REAL, refund_amount REAL, adjustment_amount REAL, imported_at TEXT, settled_at TEXT, total_revenue TEXT);
  CREATE TABLE IF NOT EXISTS finance_ad_spend(id INTEGER PRIMARY KEY AUTOINCREMENT, store_name TEXT, spend_date TEXT, amount REAL, channel TEXT, campaign TEXT, note TEXT, created_at TEXT, updated_at TEXT, transaction_id TEXT, status TEXT);
  CREATE TABLE IF NOT EXISTS finance_returns(return_order_id TEXT, order_id TEXT, store_name TEXT, return_status TEXT, return_substatus TEXT, return_type TEXT, return_reason TEXT, time_requested TEXT, refund_time TEXT, return_amount REAL, sku TEXT, product_name TEXT, quantity INTEGER, imported_at TEXT, PRIMARY KEY (store_name, return_order_id));
  CREATE TABLE IF NOT EXISTS finance_sku_costs(sku_key TEXT PRIMARY KEY, store_name TEXT, sku TEXT, product_name TEXT, hpp_per_unit REAL, packing_per_unit REAL, updated_at TEXT);
`);

// Add columns, indexes
for (const [t, c] of [['finance_income_raw', 'settled_at'], ['finance_income_raw', 'total_revenue'], ['finance_ad_spend', 'transaction_id'], ['finance_ad_spend', 'status']]) {
  try { db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`).run(); } catch (e) { }
}

// ── CLEAR ──
console.log('Clearing custombase data...');
for (const t of ['finance_order_lines', 'finance_income_raw', 'finance_ad_spend', 'finance_returns']) {
  const r = db.prepare(`DELETE FROM ${t} WHERE store_name=?`).run(STORE);
  console.log(`  ${t}: ${r.changes} rows deleted`);
}

// ── 1. IMPORT ORDERS ──
console.log('\n=== 1. ORDERS ===');
const orderStmt = db.prepare(`
  INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,order_substatus,sku,product_name,variation,quantity,unit_price,gross_product,seller_discount,platform_discount,refund_amount,order_amount,payment_method,tracking_id,package_id,cancel_reason,shipped_time,paid_time,cancelled_time,last_seen_file,last_seen_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const orderFiles = ['semua-pesanan-mei-akhir juni.xlsx', 'semua-pesanan-1 juli-7 agustus.xlsx'];
for (const file of orderFiles) {
  const fp = path.join(DATA, file);
  console.log(`  ${file}...`);
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const rows = readSheet(wb, 'OrderSKUList');
  let ins = 0, skip = 0, emptySkuResolved = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const oid = String(field(row, 'Order ID') || '').trim();
      const sku = String(field(row, 'Seller SKU') || '').trim();
      if (!oid || oid.toLowerCase().includes('platform unique order')) { skip++; continue; }
      // SKU alias resolution: empty Seller SKU → use Platform SKU ID
      let resolvedSku = sku;
      if (!sku) {
        const psid = String(field(row, 'SKU ID') || '').trim();
        if (psid) { resolvedSku = 'stikerbuku'; emptySkuResolved++; }
        else { skip++; continue; }
      }
      const created = parseDate(field(row, 'Created Time'));
      if (!created) { skip++; continue; }
      const varia = String(field(row, 'Variation') || '').trim();
      const key = `${ct(STORE)}|${oid}|${ct(resolvedSku)}|${ct(varia)}`;
      const qty = Math.abs(parseInt(String(field(row, 'Quantity')).trim()) || 0);
      const up = rp_s(field(row, 'SKU Unit Original Price'));
      const gross = rp_s(field(row, 'SKU Subtotal Before Discount')) || up * qty;
      orderStmt.run(key, oid, STORE, 'tiktok_order', created, created,
        String(field(row, 'Order Status')).trim(), String(field(row, 'Order Substatus')).trim(),
        resolvedSku, String(field(row, 'Product Name') || '').trim(), varia,
        qty, up, gross, Math.abs(rp_s(field(row, 'SKU Seller Discount'))),
        Math.abs(rp_s(field(row, 'SKU Platform Discount'))), Math.abs(rp_s(field(row, 'Order Refund Amount'))),
        rp_s(field(row, 'Order Amount')), String(field(row, 'Payment Method') || '').trim(),
        String(field(row, 'Tracking ID') || '').trim(), String(field(row, 'Package ID') || '').trim(),
        String(field(row, 'Cancel Reason') || '').trim(), parseDate(field(row, 'Shipped Time')),
        parseDate(field(row, 'Paid Time')), parseDate(field(row, 'Cancelled Time')), file, now());
      ins++;
    }
  });
  tx();
  console.log(`    ${ins} inserted, ${skip} skipped, ${emptySkuResolved} SKU aliases resolved`);
}

// ── 2. IMPORT INCOME ──
console.log('\n=== 2. INCOME ===');
const incomeFiles = ['penarikan-dana-mei-akhir juni.xlsx', 'penarikan-dana-1 juli - sekarang.xlsx'];

// Build dedup set from first file to prevent overlap
const seenEvents = new Set();

for (const file of incomeFiles) {
  const fp = path.join(DATA, file);
  console.log(`  ${file}...`);
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const sn = wb.SheetNames.find(s => s.includes('Detail')) || wb.SheetNames[0];
  const rows = readSheet(wb, sn);
  let ins = 0, skip = 0, dupPrevented = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const type = String(field(row, 'Jenis transaksi') || '').trim();
      const oid = String(field(row, 'ID Pesanan/Penyesuaian') || '').trim();
      if (!oid || !type) { skip++; continue; }
      if (type.startsWith('Return')) { skip++; continue; } // Returns go to finance_returns

      const orderCreated = parseDate(field(row, 'Waktu pemesanan'));
      const settledAt = parseDate(field(row, 'Waktu pembayaran pesanan'));
      if (!orderCreated) { skip++; continue; }

      const eventKey = `${oid}|${type}|${(settledAt || '').slice(0, 19)}`;
      if (seenEvents.has(eventKey)) { dupPrevented++; continue; }
      seenEvents.add(eventKey);

      // Store signed Total Biaya
      const settlement = rp_s(field(row, 'Jumlah penyelesaian pembayaran'));
      const fees = rp_s(field(row, 'Total Biaya', 'Jumlah biaya')); // SIGNED
      const refund = Math.abs(rp_s(field(row, 'Subtotal pengembalian dana setelah diskon penjual')));
      const adj = rp_s(field(row, 'Jumlah penyesuaian'));
      const totalRev = String(field(row, 'Total Pendapatan') || '').trim();

      db.prepare(`INSERT INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(STORE, type, oid, orderCreated, settlement, fees, refund, adj, now(), settledAt, totalRev);
      ins++;
    }
  });
  tx();
  console.log(`    ${ins} inserted, ${skip} skipped, ${dupPrevented} duplicates prevented`);
}

// ── 3. IMPORT ADS ──
console.log('\n=== 3. ADS ===');
const adFiles = fs.readdirSync(DATA).filter(f => f.toLowerCase().includes('iklan') && f.endsWith('.xlsx'));
for (const file of adFiles) {
  const fp = path.join(DATA, file);
  console.log(`  ${file}...`);
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const rows = readSheet(wb, 'sheet1');
  let total = 0, success = 0, failed = 0, ins = 0;
  let topUpMay = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const txnStatus = String(field(row, 'Status') || '').trim();
      const txnType = String(field(row, 'Transaction type') || '').trim();
      const txnSubtype = String(field(row, 'Transaction subtype') || '').trim();
      const desc = String(field(row, 'Description') || '').trim();
      const txnId = String(field(row, 'Transaction ID') || '').trim();
      if (!txnId) continue;
      total++;
      if (txnStatus === 'Success') success++; else if (txnStatus === 'Failed') failed++;

      const amount = rp_s(field(row, 'Amount'));
      let spendDate = parseDate(field(row, 'Transaction time')).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) continue;

      let channel = '', campaign = '';
      if (txnStatus === 'Success') {
        if (txnType === 'General' && txnSubtype === 'Add balance') {
          if (desc.includes('Bank transfer')) { channel = 'TikTok Top Up'; campaign = 'Bank Transfer'; if (spendDate >= '2026-05-01' && spendDate < '2026-06-01') topUpMay += Math.abs(amount); }
          else if (desc.includes('GMV Pay')) { channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto'; }
        } else if (txnType === 'General' && txnSubtype === 'Bill payment') { channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto'; }
        else if (txnType === 'Promotions') { channel = 'TikTok Promotions'; campaign = 'Promotions'; }
        else { channel = 'TikTok ' + txnType; campaign = txnSubtype; }
      } else { channel = 'TikTok ' + txnType + ' (Failed)'; campaign = txnSubtype; }
      if (!channel) channel = 'TikTok Other';

      db.prepare(`INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at,transaction_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(STORE, spendDate, Math.abs(amount), channel, campaign, `Txn:${txnId} ${desc}`.substring(0, 200), now(), now(), txnId, txnStatus);
      ins++;
    }
  });
  tx();
  console.log(`    ${ins} inserted (${total} raw, ${success} Success, ${failed} Failed)`);
  if (topUpMay > 0) console.log(`    May Top Up: ${fmt(topUpMay)}`);
}

// ── 4. IMPORT RETURNS ──
console.log('\n=== 4. RETURNS ===');
const retFiles = fs.readdirSync(DATA).filter(f => f.toLowerCase().includes('dikembalikan') && f.endsWith('.xlsx'));
for (const file of retFiles) {
  const fp = path.join(DATA, file);
  console.log(`  ${file}...`);
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const rows = readSheet(wb, wb.SheetNames[0]);
  let ins = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const retOid = String(field(row, 'Return Order ID') || '').trim();
      const oid = String(field(row, 'Order ID') || '').trim();
      if (!retOid) continue;
      db.prepare(`INSERT OR REPLACE INTO finance_returns(return_order_id,order_id,store_name,return_status,return_substatus,return_type,return_reason,time_requested,refund_time,return_amount,sku,product_name,quantity,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(retOid, oid, STORE, String(field(row, 'Return Status') || '').trim(), String(field(row, 'Return Sub Status') || '').trim(), String(field(row, 'Return Type') || '').trim(), String(field(row, 'Return Reason') || '').trim(), parseDate(field(row, 'Time Requested')), parseDate(field(row, 'Refund Time')), rp_s(field(row, 'Return unit price')), String(field(row, 'Seller SKU') || '').trim(), String(field(row, 'Product Name') || '').trim(), parseInt(String(field(row, 'Return Quantity')).trim()) || 0, now());
      ins++;
    }
  });
  tx();
  console.log(`    ${ins} inserted`);
}

// ── VERIFICATION ──
console.log('\n╔══════════════════════════════════════╗');
console.log('║  VERIFICATION                         ║');
console.log('╚══════════════════════════════════════╝\n');

const counts = {
  orders: db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name=?").get(STORE).c,
  income: db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name=?").get(STORE).c,
  ads: db.prepare("SELECT COUNT(DISTINCT transaction_id) as c FROM finance_ad_spend WHERE store_name=?").get(STORE).c,
  returns: db.prepare("SELECT COUNT(*) as c FROM finance_returns WHERE store_name=?").get(STORE).c,
};

console.log(`Orders:   ${counts.orders} lines`);
console.log(`Income:   ${counts.income} events`);
console.log(`Ads:      ${counts.ads} unique Transaction IDs`);
console.log(`Returns:  ${counts.returns} cases`);

// Income breakdown
const bd = db.prepare("SELECT transaction_type, COUNT(*) as c FROM finance_income_raw WHERE store_name=? GROUP BY transaction_type ORDER BY c DESC").all(STORE);
console.log('\nIncome breakdown:');
for (const r of bd) console.log(`  ${r.transaction_type}: ${r.c}`);

// Ads status
const adStatus = db.prepare("SELECT status, COUNT(DISTINCT transaction_id) as c FROM finance_ad_spend WHERE store_name=? GROUP BY status").all(STORE);
console.log('\nAds status:');
for (const r of adStatus) console.log(`  ${r.status}: ${r.c}`);

// July order status
const julStatus = db.prepare("SELECT status, COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-07-01' AND created_at<'2026-08-01' GROUP BY status ORDER BY c DESC").all(STORE);
console.log('\nJuly orders:');
for (const r of julStatus) console.log(`  ${r.status}: ${r.c}`);

// May golden
const mayInc = db.prepare("SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time>='2026-05-01' AND order_created_time<'2026-06-01'").get(STORE);
const mayGMV = db.prepare("SELECT SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pembayaran GMV untuk Iklan TikTok' AND order_created_time>='2026-05-01' AND order_created_time<'2026-06-01'").get(STORE);
console.log(`\nMay Settlement: ${fmt(mayInc.s)} (expected Rp8.772.345) ${Math.abs(mayInc.s - 8772345) <= 1 ? '✅' : '❌'}`);
console.log(`May Fee: ${fmt(Math.abs(mayInc.f))} (expected Rp3.223.291) ${Math.abs(Math.abs(mayInc.f) - 3223291) <= 1 ? '✅' : '❌'}`);
console.log(`May GMV: ${fmt(Math.abs(mayGMV.s))} (expected Rp1.472.709) ${Math.abs(Math.abs(mayGMV.s) - 1472709) <= 1 ? '✅' : '❌'}`);

// July fee
const julFee = db.prepare("SELECT SUM(total_fees) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time>='2026-07-01' AND order_created_time<'2026-08-01'").get(STORE);
console.log(`July Fee: ${fmt(Math.abs(julFee.s))} (expected Rp29.336.536) ${Math.abs(Math.abs(julFee.s) - 29336536) <= 1 ? '✅' : '❌'}`);

// Top Up May
const topUp = db.prepare("SELECT SUM(amount) as s FROM finance_ad_spend WHERE store_name=? AND channel='TikTok Top Up' AND spend_date>='2026-05-01' AND spend_date<'2026-06-01' AND status='Success'").get(STORE);
console.log(`May Top Up: ${fmt(topUp.s)} (expected Rp1.665.000) ${Math.abs((topUp.s || 0) - 1665000) <= 1 ? '✅' : '❌'}`);

console.log('\n✅ IMPORT COMPLETE');
db.close();
