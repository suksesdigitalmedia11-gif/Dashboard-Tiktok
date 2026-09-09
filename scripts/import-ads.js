// Import ads and fix data
const db = require('better-sqlite3')('./data/finance.db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

db.pragma('journal_mode=WAL');
const STORE = 'custombase';
const DATA = path.join(__dirname, '..', 'data tiktok', 'custombase');

function rp(v) {
  if (typeof v === 'number') return Math.round(Math.abs(v));
  const t = String(v||'').trim(); if(!t) return 0;
  const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g,'');
  const p = Number.parseFloat(n.replace(/,/g,''));
  return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0;
}
function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number') return new Date(Date.UTC(1899,11,30) + v*86400000).toISOString().slice(0,10);
  const raw = String(v).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) return (slash[3].length===2?'20'+slash[3]:slash[3])+'-'+slash[2].padStart(2,'0')+'-'+slash[1].padStart(2,'0');
  const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');
  return '';
}
function field(row, ...names) {
  for (const n of names) if (row[n] !== undefined) return row[n];
  return '';
}

function readSheet(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const keys = Object.keys(sheet).filter(k => k[0] !== '!');
  let maxR = 0, maxC = 0;
  for (const k of keys) {
    try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c; } catch(e) {}
  }
  const headers = [];
  for (let c = 0; c <= maxC; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    headers.push(cell ? String(cell.v || '').trim() : `[col_${c}]`);
  }
  const rows = [];
  for (let r = 1; r <= maxR; r++) {
    const row = {};
    for (let c = 0; c <= maxC; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== '') row[headers[c]] = cell.v;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

// Import ads
console.log('=== IMPORTING ADS ===');
const adFile = 'iklan custombase mei - akhir juni.xlsx';
const adFp = path.join(DATA, adFile);

if (fs.existsSync(adFp)) {
  // Clear existing
  db.prepare("DELETE FROM finance_ad_spend WHERE store_name=?").run(STORE);
  
  const wb = XLSX.readFile(adFp, { cellDates: false, raw: true });
  const rows = readSheet(wb, 'sheet1');
  console.log(`Ad rows: ${rows.length}`);
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO finance_ad_spend(
      store_name, spend_date, amount, channel, campaign, note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `);
  
  let ins = 0, topUp = 0, gmv = 0, bill = 0;
  for (const row of rows) {
    const status = String(field(row, 'Status') || '').trim();
    if (status !== 'Success') continue;
    
    const txnType = String(field(row, 'Transaction type') || '').trim();
    const txnSubtype = String(field(row, 'Transaction subtype') || '').trim();
    const desc = String(field(row, 'Description') || '').trim();
    let amount = rp(field(row, 'Amount'));
    if (!amount) continue;
    
    let spendDate = parseDate(field(row, 'Transaction time'));
    if (!spendDate) spendDate = '2026-06-01';
    
    let channel = '';
    if (txnType === 'General' && txnSubtype === 'Add balance') {
      channel = 'TikTok Top Up';
      topUp += amount;
    } else if (txnType === 'General' && txnSubtype === 'Bill payment') {
      channel = 'TikTok Ads Settlement';
      gmv += amount;
      bill++;
    } else if (txnType === 'Promotions') {
      channel = 'TikTok Top Up';
      topUp += amount;
    } else {
      channel = txnType + ' ' + txnSubtype;
    }
    
    const note = `${txnType}/${txnSubtype}: ${desc}`.substring(0, 200);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    stmt.run(STORE, spendDate, amount, channel, 'Manual', note, now, now);
    ins++;
  }
  
  console.log(`Inserted: ${ins} ad rows`);
  console.log(`Top Up: ${topUp}, GMV/Settlement: ${gmv} (${bill} bill payments)`);
} else {
  console.log('Ad file not found');
}

// Verify
const adSum = db.prepare(`
  SELECT channel, COUNT(*) as c, SUM(amount) as s, MIN(spend_date) as mind, MAX(spend_date) as maxd
  FROM finance_ad_spend WHERE store_name=? GROUP BY channel
`).all(STORE);
console.log('\n=== AD SUMMARY ===');
for (const a of adSum) console.log(`  ${a.channel}: ${a.c} rows, ${Math.round(a.s).toLocaleString('id-ID')}, ${a.mind}..${a.maxd}`);

db.close();
console.log('\nDone!');
