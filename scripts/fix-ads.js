// Fix ads: store ALL raw transactions including Failed
const db = require('better-sqlite3')('./data/finance.db');
const XLSX = require('xlsx');
const path = require('path');
const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

const STORE = 'custombase';
const DATA = path.join('data tiktok', 'custombase');

function rp_s(v) { const t = String(v || '').trim(); if (!t) return 0; const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g, ''); if (n.startsWith('+')) n = n.slice(1); const p = Number.parseFloat(n.replace(/,/g, '')); return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0; }
function parseDate(v) { if (!v) return ''; if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10); const raw = String(v).trim(); const s = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (s) return (s[3].length === 2 ? '20' + s[3] : s[3]) + '-' + s[2].padStart(2, '0') + '-' + s[1].padStart(2, '0'); const i = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if (i) return i[1] + '-' + i[2].padStart(2, '0') + '-' + i[3].padStart(2, '0'); return ''; }
function field(row, ...names) { for (const n of names) if (row[n] !== undefined) return row[n]; return ''; }

function readSheet(wb, sn) {
  const sheet = wb.Sheets[sn]; if (!sheet) return [];
  const keys = Object.keys(sheet).filter(k => k[0] !== '!'); let maxR = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; } catch (e) { } }
  const hdrs = []; for (let c = 0; c < 80; c++) { const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })]; hdrs.push(cell ? String(cell.v || '').trim() : ''); }
  const rows = [];
  for (let r = 1; r <= maxR; r++) { const row = {}; for (let c = 0; c < 80; c++) { const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.v !== undefined && cell.v !== '') row[hdrs[c]] = cell.v; } if (Object.keys(row).length > 0) rows.push(row); }
  return rows;
}

// Add status column
try { db.prepare('ALTER TABLE finance_ad_spend ADD COLUMN status TEXT').run(); } catch (e) { }

// Clear and reimport ALL transactions
db.prepare('DELETE FROM finance_ad_spend WHERE store_name=?').run(STORE);

const adFile = path.join(DATA, 'iklan custombase mei - akhir juni.xlsx');
const wb = XLSX.readFile(adFile, { cellDates: false, raw: true });
const rows = readSheet(wb, 'sheet1');

let total = 0, success = 0, failed = 0, topUpMay = 0;
let gmvMay = 0;

const stmt = db.prepare('INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at,transaction_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)');

for (const row of rows) {
  const txnStatus = String(field(row, 'Status') || '').trim();
  const txnType = String(field(row, 'Transaction type') || '').trim();
  const txnSubtype = String(field(row, 'Transaction subtype') || '').trim();
  const desc = String(field(row, 'Description') || '').trim();
  const txnId = String(field(row, 'Transaction ID') || '').trim();
  if (!txnId) continue;

  total++;
  if (txnStatus === 'Success') success++;
  else if (txnStatus === 'Failed') failed++;

  const amount = rp_s(field(row, 'Amount'));
  const spendDate = parseDate(field(row, 'Transaction time')).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) continue;

  let channel = '', campaign = '';

  if (txnStatus === 'Success') {
    if (txnType === 'General' && txnSubtype === 'Add balance') {
      if (desc.includes('Bank transfer')) {
        channel = 'TikTok Top Up'; campaign = 'Bank Transfer';
        if (spendDate >= '2026-05-01' && spendDate < '2026-06-01') topUpMay += Math.abs(amount);
      } else if (desc.includes('GMV Pay')) {
        channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto';
        if (spendDate >= '2026-05-01' && spendDate < '2026-06-01') gmvMay += Math.abs(amount);
      }
    } else if (txnType === 'General' && txnSubtype === 'Bill payment') {
      channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto';
      if (spendDate >= '2026-05-01' && spendDate < '2026-06-01') gmvMay += Math.abs(amount);
    } else if (txnType === 'Promotions') {
      channel = 'TikTok Promotions'; campaign = 'Promotions';
    } else {
      channel = 'TikTok ' + txnType; campaign = txnSubtype;
    }
  } else {
    channel = 'TikTok ' + txnType + ' (Failed)'; campaign = txnSubtype;
  }

  if (!channel) channel = 'TikTok Other';
  stmt.run(STORE, spendDate, Math.abs(amount), channel, campaign,
    'Txn:' + txnId + ' ' + desc.substring(0, 160), now, now, txnId, txnStatus);
}

console.log('=== ADS IMPORT RESULT ===');
console.log('Raw file rows:', rows.length);
console.log('Total raw transactions:', total);
console.log('Success:', success);
console.log('Failed:', failed);
console.log('INSERTED:', total);
console.log('May Top Up (Bank Transfer):', topUpMay, '(expected 1,665,000)', Math.abs(topUpMay - 1665000) <= 1 ? '✅' : '❌');
console.log('May GMV (Ads file):', gmvMay);

// Verify DB
const cnt = db.prepare('SELECT status, COUNT(*) as c FROM finance_ad_spend WHERE store_name=? GROUP BY status').all(STORE);
console.log('\nDB status breakdown:');
for (const r of cnt) console.log(' ', r.status, ':', r.c);

const ch = db.prepare('SELECT channel, COUNT(*) as c FROM finance_ad_spend WHERE store_name=? GROUP BY channel').all(STORE);
console.log('\nDB channel breakdown:');
for (const r of ch) console.log(' ', r.channel, ':', r.c);

db.close();
