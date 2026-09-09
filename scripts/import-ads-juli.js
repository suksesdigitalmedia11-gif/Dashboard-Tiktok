// Import ads July-August + Scan Golden May fixture
const db = require('better-sqlite3')('./data/finance.db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const STORE = 'custombase';
const DATA = path.join('data tiktok', 'custombase');
const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

function rp_s(v) { const t = String(v || '').trim(); if (!t) return 0; const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g, ''); if (n.startsWith('+')) n = n.slice(1); const p = Number.parseFloat(n.replace(/,/g, '')); return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0; }
function parseDate(v) { if (!v) return ''; if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10); const raw = String(v).trim(); const s = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (s) return (s[3].length === 2 ? '20' + s[3] : s[3]) + '-' + s[2].padStart(2, '0') + '-' + s[1].padStart(2, '0'); const i = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if (i) return i[1] + '-' + i[2].padStart(2, '0') + '-' + i[3].padStart(2, '0'); return ''; }
function field(row, ...names) { for (const n of names) if (row[n] !== undefined) return row[n]; return ''; }
function ct(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function readSheet(wb, sn) {
  const sheet = wb.Sheets[sn]; if (!sheet) return [];
  const keys = Object.keys(sheet).filter(k => k[0] !== '!'); let maxR = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; } catch (e) { } }
  const hdrs = []; for (let c = 0; c < 80; c++) { const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })]; hdrs.push(cell ? String(cell.v || '').trim() : ''); }
  const rows = [];
  for (let r = 1; r <= maxR; r++) { const row = {}; for (let c = 0; c < 80; c++) { const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.v !== undefined && cell.v !== '') row[hdrs[c]] = cell.v; } if (Object.keys(row).length > 0) rows.push(row); }
  return rows;
}

// Ensure status + transaction_id columns
try { db.prepare('ALTER TABLE finance_ad_spend ADD COLUMN status TEXT').run(); } catch (e) { }
try { db.prepare('ALTER TABLE finance_ad_spend ADD COLUMN transaction_id TEXT').run(); } catch (e) { }

// ═══════════════════════════════════
// IMPORT ADS JULY-AUGUST (INCREMENTAL)
// ═══════════════════════════════════
console.log('=== IMPORT ADS JULI-AGUSTUS ===');
const adFile2 = path.join(DATA, 'iklan 1juli-sekarang.xlsx');
console.log('File:', adFile2);
console.log('Exists:', fs.existsSync(adFile2));

const wb2 = XLSX.readFile(adFile2, { cellDates: false, raw: true });
const rows2 = readSheet(wb2, 'sheet1');
console.log('Raw rows:', rows2.length);

let total2 = 0, success2 = 0, failed2 = 0, inserted2 = 0, skipped2 = 0, updated2 = 0;

const upsertStmt = db.prepare(`
  INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at,transaction_id,status)
  VALUES(?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(store_name, transaction_id) DO UPDATE SET
    status=excluded.status, amount=excluded.amount, channel=excluded.channel,
    campaign=excluded.campaign, note=excluded.note, updated_at=excluded.updated_at
`);

for (const row of rows2) {
  const txnStatus = String(field(row, 'Status') || '').trim();
  const txnType = String(field(row, 'Transaction type') || '').trim();
  const txnSubtype = String(field(row, 'Transaction subtype') || '').trim();
  const desc = String(field(row, 'Description') || '').trim();
  const txnId = String(field(row, 'Transaction ID') || '').trim();
  if (!txnId) continue;

  total2++;
  if (txnStatus === 'Success') success2++;
  else if (txnStatus === 'Failed') failed2++;

  const amount = rp_s(field(row, 'Amount'));
  const spendDate = parseDate(field(row, 'Transaction time')).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) { skipped2++; continue; }

  let channel = '', campaign = '';

  if (txnStatus === 'Success') {
    if (txnType === 'General' && txnSubtype === 'Add balance') {
      if (desc.includes('Bank transfer')) {
        channel = 'TikTok Top Up'; campaign = 'Bank Transfer';
      } else if (desc.includes('GMV Pay')) {
        channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto';
      }
    } else if (txnType === 'General' && txnSubtype === 'Bill payment') {
      channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto';
    } else if (txnType === 'Promotions') {
      channel = 'TikTok Promotions'; campaign = 'Promotions';
    } else {
      channel = 'TikTok ' + txnType; campaign = txnSubtype;
    }
  } else {
    channel = 'TikTok ' + txnType + ' (Failed)'; campaign = txnSubtype;
  }
  if (!channel) channel = 'TikTok Other';

  // Check if exists for UPSERT tracking
  const existing = db.prepare('SELECT 1 FROM finance_ad_spend WHERE store_name=? AND transaction_id=?').get(STORE, txnId);
  
  upsertStmt.run(STORE, spendDate, Math.abs(amount), channel, campaign,
    'Txn:' + txnId + ' ' + desc.substring(0, 160), now, now, txnId, txnStatus);
  
  if (existing) updated2++; else inserted2++;
}

console.log('Raw transactions:', total2);
console.log('Success:', success2, 'Failed:', failed2);
console.log('Inserted:', inserted2, 'Updated:', updated2, 'Skipped:', skipped2);

// ═══════════════════════════════════
// VERIFY ADS TOTAL
// ═══════════════════════════════════
console.log('\n=== ADS TOTAL VERIFICATION ===');
const cnt = db.prepare('SELECT status, COUNT(*) as c, COUNT(DISTINCT transaction_id) as uniq FROM finance_ad_spend WHERE store_name=? GROUP BY status').all(STORE);
let totalAll = 0;
for (const r of cnt) { console.log('  ' + r.status + ': ' + r.c + ' rows, ' + r.uniq + ' unique txn IDs'); totalAll += r.c; }
console.log('  TOTAL: ' + totalAll + ' raw transactions');

const ch = db.prepare('SELECT channel, COUNT(*) as c FROM finance_ad_spend WHERE store_name=? AND status=\'Success\' GROUP BY channel').all(STORE);
console.log('\n  Success channels:');
for (const r of ch) console.log('    ' + r.channel + ': ' + r.c);

// Check Top Up July
const topUpJul = db.prepare("SELECT SUM(amount) as s FROM finance_ad_spend WHERE store_name=? AND channel='TikTok Top Up' AND spend_date>='2026-07-01' AND spend_date<'2026-08-01' AND status='Success'").get(STORE);
console.log('  July Top Up:', Math.round(topUpJul.s || 0), '(expected 0)');

// Check Top Up August
const topUpAug = db.prepare("SELECT SUM(amount) as s FROM finance_ad_spend WHERE store_name=? AND channel='TikTok Top Up' AND spend_date>='2026-08-01' AND spend_date<'2026-08-08' AND status='Success'").get(STORE);
console.log('  August Top Up:', Math.round(topUpAug.s || 0), '(expected 0)');

// ═══════════════════════════════════
// SCAN ORDER FILES FOR GOLDEN MAY
// ═══════════════════════════════════
console.log('\n=== SCAN ORDER FILES FOR GOLDEN MAY ===');
const orderFiles = fs.readdirSync(DATA).filter(f => f.endsWith('.xlsx'));

for (const file of orderFiles) {
  const fp = path.join(DATA, file);
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  
  // Check if this is an order file (has Order ID, Seller SKU, etc.)
  const sn = wb.SheetNames[0];
  const { rows } = readSheet(wb, sn);
  if (rows.length < 100) continue;
  
  const firstRow = rows[0];
  const hasOrderId = field(firstRow, 'Order ID');
  const hasSellerSku = field(firstRow, 'Seller SKU');
  const hasCreatedTime = field(firstRow, 'Created Time');
  
  if (!hasOrderId || !hasSellerSku || !hasCreatedTime) continue;
  
  // This is an order file — analyze dates
  let minDate = '', maxDate = '';
  const oids = new Set();
  let maySelesai = 0;
  
  for (const row of rows) {
    const oid = String(field(row, 'Order ID') || '').trim();
    if (!oid || oid.toLowerCase().includes('platform unique order')) continue;
    const sku = String(field(row, 'Seller SKU') || '').trim();
    if (!sku) continue;
    
    const created = parseDate(field(row, 'Created Time'));
    if (!created) continue;
    
    if (!minDate || created < minDate) minDate = created;
    if (!maxDate || created > maxDate) maxDate = created;
    oids.add(oid);
    
    const status = String(field(row, 'Order Status') || '').trim();
    if (created.startsWith('2026-05') && status === 'Selesai') maySelesai++;
  }
  
  console.log(`  ${file}:`);
  console.log(`    Rows: ${rows.length}, Unique OIDs: ${oids.size}`);
  console.log(`    Date range: ${minDate} → ${maxDate}`);
  console.log(`    May Selesai lines: ${maySelesai}`);
  console.log(`    Starts May 1? ${minDate.startsWith('2026-05-01') ? '✅ YES' : '❌ No (starts ' + minDate + ')'}`);
  console.log();
}

// ═══════════════════════════════════
// FINAL VERIFICATION
// ═══════════════════════════════════
console.log('=== FINAL ADS STATE ===');
const finalCnt = db.prepare('SELECT status, COUNT(DISTINCT transaction_id) as uniq FROM finance_ad_spend WHERE store_name=? GROUP BY status').all(STORE);
let totalUniq = 0, successUniq = 0, failedUniq = 0;
for (const r of finalCnt) {
  console.log('  ' + r.status + ': ' + r.uniq + ' unique Transaction IDs');
  totalUniq += r.uniq;
  if (r.status === 'Success') successUniq = r.uniq;
  if (r.status === 'Failed') failedUniq = r.uniq;
}
console.log('  TOTAL: ' + totalUniq + ' unique Transaction IDs');
console.log('  Expected: 464 raw, 462 success, 2 failed');
console.log('  Match: ' + (totalUniq === 464 && successUniq === 462 && failedUniq === 2 ? '✅ EXACT' : '❌ MISMATCH'));

db.close();
