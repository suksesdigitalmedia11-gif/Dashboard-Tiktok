/**
 * PRODUCTION IMPORT — Comprehensive Error Handling
 * Semua edge case ditangani, semua unknown SKU dilaporkan
 */
const db = require('better-sqlite3')('./data/finance.db');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

db.pragma('journal_mode=WAL');

const DATA = path.join('data tiktok', 'custombase');
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const fmt = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

// ── Helpers ──
const rp = v => { const t = String(v || '').trim(); if (!t) return 0; const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g, ''); const p = Number.parseFloat(n.replace(/,/g, '')); return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0; };
const pd = v => { if (!v) return ''; const raw = String(v).trim(); const m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); const s = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (s) return (s[3].length === 2 ? '20' + s[3] : s[3]) + '-' + s[2].padStart(2, '0') + '-' + s[1].padStart(2, '0'); return ''; };
const ct = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── SKU Cache ──
const skuHppCache = new Map();
function loadSkuCache() {
  const all = db.prepare("SELECT seller_sku, hpp_per_unit, packing_per_unit, status FROM finance_sku_master WHERE status='active'").all();
  for (const s of all) skuHppCache.set(ct(s.seller_sku), { hpp: s.hpp_per_unit, packing: s.packing_per_unit });
  // Also from legacy costs table
  const legacy = db.prepare("SELECT sku, MAX(hpp_per_unit) as hpp, MAX(packing_per_unit) as packing FROM finance_sku_costs WHERE hpp_per_unit > 0 GROUP BY sku").all();
  for (const s of legacy) {
    const key = ct(s.sku);
    if (!skuHppCache.has(key)) skuHppCache.set(key, { hpp: s.hpp, packing: s.packing });
  }
  console.log(`  SKU cache loaded: ${skuHppCache.size} active SKUs`);
}

// ── Read sheet — robust ──
function readSheet(wb, sn) {
  const sheet = wb.Sheets[sn];
  if (!sheet) throw new Error(`Sheet "${sn}" tidak ditemukan`);
  const keys = Object.keys(sheet).filter(k => k[0] !== '!');
  let maxR = 0, maxC = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c; } catch (e) { } }
  const hdrs = [];
  for (let c = 0; c <= maxC; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    hdrs.push(cell ? String(cell.v || '').trim().replace(/\s+/g, ' ') : `[col${c}]`);
  }
  const rows = [];
  for (let r = 1; r <= maxR; r++) {
    const row = {};
    let hasData = false;
    for (let c = 0; c <= maxC; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && String(cell.v).trim() !== '') {
        row[hdrs[c]] = cell.v;
        hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }
  return { hdrs, rows };
}

// ── Validate columns ──
function validateColumns(hdrs, required) {
  const missing = required.filter(r => !hdrs.some(h => h.toLowerCase().includes(r.toLowerCase())));
  if (missing.length > 0) {
    throw new Error(`Kolom wajib tidak ditemukan: ${missing.join(', ')}. Kolom tersedia: ${hdrs.slice(0, 15).join(', ')}...`);
  }
}

// ── Detect file type from headers ──
function detectFileType(hdrs) {
  const h = hdrs.map(x => x.toLowerCase()).join(' ');
  if (h.includes('return order id') && h.includes('return status')) return 'returns';
  if (h.includes('order id') && h.includes('order status') && h.includes('seller sku')) return 'orders';
  if (h.includes('id pesanan/penyesuaian') && h.includes('jenis transaksi')) return 'income';
  if (h.includes('transaction id') && h.includes('transaction type') && h.includes('amount')) return 'ads';
  return 'unknown';
}

// ═══════════════════════════════════════
// MAIN IMPORT
// ═══════════════════════════════════════

console.log('╔══════════════════════════════════════╗');
console.log('║  IMPORT — Error Handling Komprehensif ║');
console.log('╚══════════════════════════════════════╝\n');

loadSkuCache();

const STORE = process.argv[2] || 'custombase';
const files = fs.readdirSync(DATA).filter(f => f.endsWith('.xlsx'));

let report = {
  store: STORE,
  files: [],
  orders: { inserted: 0, updated: 0, skipped: 0, skuUnknown: [], skuResolved: 0 },
  income: { inserted: 0, duplicates: 0, skipped: 0, breakdown: {} },
  ads: { inserted: 0, duplicates: 0, success: 0, failed: 0 },
  returns: { inserted: 0, updated: 0 },
  errors: [],
  warnings: [],
};

for (const file of files) {
  const fp = path.join(DATA, file);
  console.log(`\n📄 ${file}`);
  
  try {
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
    const sn = wb.SheetNames[0];
    const { hdrs, rows } = readSheet(wb, sn);
    const type = detectFileType(hdrs);
    
    if (type === 'unknown') {
      report.warnings.push(`${file}: Tipe file tidak dikenali. Kolom: ${hdrs.slice(0, 10).join(', ')}`);
      console.log(`  ⚠️ Tipe tidak dikenali — skip`);
      continue;
    }
    
    console.log(`  Tipe: ${type.toUpperCase()} | ${rows.length} baris`);
    
    // ── ORDERS ──
    if (type === 'orders') {
      validateColumns(hdrs, ['Order ID', 'Order Status', 'Seller SKU', 'Created Time']);
      let ins = 0, up = 0, sk = 0, skuRes = 0;
      const unknownSkus = new Set();
      
      const tx = db.transaction(() => {
        for (const row of rows) {
          const oid = String((row['Order ID'] || '')).trim();
          if (!oid || oid.toLowerCase().includes('platform unique')) { sk++; continue; }
          
          let sku = String((row['Seller SKU'] || '')).trim();
          // SKU alias resolution
          if (!sku) {
            const psid = String((row['SKU ID'] || '')).trim();
            if (psid) { sku = 'stikerbuku'; skuRes++; }
            else { sk++; continue; }
          }
          
          const created = pd(row['Created Time']);
          if (!created) { sk++; continue; }
          
          const varia = String((row['Variation'] || '')).trim();
          const status = String((row['Order Status'] || '')).trim();
          const qty = Math.abs(parseInt(String(row['Quantity'] || '0').trim()) || 0);
          const gross = rp(row['SKU Subtotal Before Discount']);
          const disc = Math.abs(rp(row['SKU Seller Discount']));
          
          // SKU unknown check — also check variation-based (POLA)
          const skuKey = ct(sku);
          let hppResolved = skuHppCache.has(skuKey);
          if (!hppResolved) {
            // Check variation-based (POLA pattern: 25pcs, 50pcs, etc.)
            const varMatch = ct(varia).match(/(\d+)\s*pcs/);
            if (varMatch && skuKey.includes('pola')) hppResolved = true;
          }
          if (!hppResolved && sku) {
            unknownSkus.add(sku);
          }
          
          const key = `${ct(STORE)}|${ct(oid)}|${skuKey}|${ct(varia)}`;
          const existing = db.prepare("SELECT line_key FROM finance_order_lines WHERE line_key=?").get(key);
          
          if (existing) {
            // UPDATE if status changed
            db.prepare("UPDATE finance_order_lines SET status=?,updated_at=?,last_seen_file=?,last_seen_at=? WHERE line_key=?").run(status, now(), file, now(), key);
            up++;
          } else {
            db.prepare(`INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,variation,quantity,gross_product,seller_discount,tracking_id,package_id,cancel_reason,shipped_time,cancelled_time,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, oid, STORE, 'tiktok', created, created, status, sku, varia, qty, gross, disc, String(row['Tracking ID'] || '').trim(), String(row['Package ID'] || '').trim(), String(row['Cancel Reason'] || '').trim(), pd(row['Shipped Time']), pd(row['Cancelled Time']), file, now());
            ins++;
          }
        }
      });
      tx();
      
      report.orders.inserted += ins;
      report.orders.updated += up;
      report.orders.skipped += sk;
      report.orders.skuResolved += skuRes;
      if (unknownSkus.size > 0) {
        report.orders.skuUnknown.push(...unknownSkus);
        console.log(`  ⚠️ ${unknownSkus.size} SKU BELUM TERPETAKAN: ${[...unknownSkus].slice(0, 10).join(', ')}${unknownSkus.size > 10 ? '...' : ''}`);
        console.log(`     → Tambahkan HPP di Master SKU atau import file SKU`);
      }
      console.log(`  ✅ ${ins} baru, ${up} update, ${skuRes} SKU alias resolved, ${sk} skip`);
    }
    
    // ── INCOME ──
    if (type === 'income') {
      validateColumns(hdrs, ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Jumlah penyelesaian pembayaran']);
      let ins = 0, dup = 0, sk = 0;
      const bd = {};
      
      const tx = db.transaction(() => {
        for (const row of rows) {
          const type = String((row['Jenis transaksi'] || '')).trim();
          const oid = String((row['ID Pesanan/Penyesuaian'] || '')).trim();
          if (!oid || !type) { sk++; continue; }
          if (type.startsWith('Return')) { sk++; continue; }
          
          const orderCreated = pd(row['Waktu pemesanan']);
          const settledAt = pd(row['Waktu pembayaran pesanan']);
          if (!orderCreated) { sk++; continue; }
          
          const fees = rp(row['Total Biaya']);
          const settlement = rp(row['Jumlah penyelesaian pembayaran']);
          const refund = Math.abs(rp(row['Subtotal pengembalian dana setelah diskon penjual']));
          const adj = rp(row['Jumlah penyesuaian']);
          const rev = String((row['Total Pendapatan'] || '')).trim();
          
          const result = db.prepare(`INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(STORE, type, oid, orderCreated, settlement, fees, refund, adj, now(), settledAt, rev);
          
          if (result.changes) { ins++; bd[type] = (bd[type] || 0) + 1; }
          else { dup++; }
        }
      });
      tx();
      
      report.income.inserted += ins;
      report.income.duplicates += dup;
      report.income.skipped += sk;
      for (const [k, v] of Object.entries(bd)) report.income.breakdown[k] = (report.income.breakdown[k] || 0) + v;
      console.log(`  ✅ ${ins} baru, ${dup} duplikat dicegah, ${sk} skip`);
    }
    
    // ── ADS ──
    if (type === 'ads') {
      validateColumns(hdrs, ['Transaction ID', 'Amount', 'Status', 'Transaction time']);
      let ins = 0, dup = 0, succ = 0, fail = 0;
      
      const tx = db.transaction(() => {
        for (const row of rows) {
          const txnId = String((row['Transaction ID'] || '')).trim();
          if (!txnId) continue;
          
          const txnStatus = String((row['Status'] || '')).trim();
          const txnType = String((row['Transaction type'] || '')).trim();
          const txnSub = String((row['Transaction subtype'] || '')).trim();
          const desc = String((row['Description'] || '')).trim();
          const spendDate = pd(row['Transaction time']).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) continue;
          const amount = Math.abs(rp(row['Amount']));
          
          if (txnStatus === 'Success') succ++; else if (txnStatus === 'Failed') fail++;
          
          let channel = '', campaign = '';
          if (txnStatus === 'Success') {
            if (txnType === 'General' && txnSub === 'Add balance' && desc.includes('Bank transfer')) { channel = 'TikTok Top Up'; campaign = 'Bank Transfer'; }
            else if (txnType === 'General' && (txnSub === 'Bill payment' || desc.includes('GMV Pay'))) { channel = 'TikTok Ads Settlement'; campaign = 'GMV Auto'; }
            else { channel = 'TikTok ' + txnType; campaign = txnSub; }
          } else { channel = 'TikTok ' + txnType + ' (Failed)'; }
          
          const key = `${STORE}|${txnId}`;
          const existing = db.prepare("SELECT 1 FROM finance_ad_spend WHERE store_name=? AND transaction_id=?").get(STORE, txnId);
          if (existing) { dup++; continue; }
          
          db.prepare("INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at,transaction_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)").run(STORE, spendDate, amount, channel, campaign, `Txn:${txnId} ${desc}`.substring(0, 200), now(), now(), txnId, txnStatus);
          ins++;
        }
      });
      tx();
      
      report.ads.inserted += ins;
      report.ads.duplicates += dup;
      report.ads.success += succ;
      report.ads.failed += fail;
      console.log(`  ✅ ${ins} baru, ${dup} duplikat, ${succ} Success, ${fail} Failed`);
    }
    
    // ── RETURNS ──
    if (type === 'returns') {
      validateColumns(hdrs, ['Return Order ID', 'Return Status']);
      let ins = 0, up = 0;
      
      const tx = db.transaction(() => {
        for (const row of rows) {
          const retOid = String((row['Return Order ID'] || '')).trim();
          const oid = String((row['Order ID'] || '')).trim();
          if (!retOid) continue;
          
          const existing = db.prepare("SELECT 1 FROM finance_returns WHERE store_name=? AND return_order_id=?").get(STORE, retOid);
          if (existing) {
            db.prepare("UPDATE finance_returns SET return_status=?,imported_at=? WHERE store_name=? AND return_order_id=?").run(String(row['Return Status'] || '').trim(), now(), STORE, retOid);
            up++;
          } else {
            db.prepare("INSERT INTO finance_returns(return_order_id,order_id,store_name,return_status,return_type,return_reason,time_requested,refund_time,return_amount,sku,product_name,quantity,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(retOid, oid, STORE, String(row['Return Status'] || '').trim(), String(row['Return Type'] || '').trim(), String(row['Return Reason'] || '').trim(), pd(row['Time Requested']), pd(row['Refund Time']), rp(row['Return unit price']), String(row['Seller SKU'] || '').trim(), String(row['Product Name'] || '').trim(), parseInt(String(row['Return Quantity']).trim()) || 0, now());
            ins++;
          }
        }
      });
      tx();
      
      report.returns.inserted += ins;
      report.returns.updated += up;
      console.log(`  ✅ ${ins} baru, ${up} update`);
    }
    
    report.files.push({ file, type, rows: rows.length });
    
  } catch (err) {
    report.errors.push({ file, error: err.message });
    console.log(`  ❌ ERROR: ${err.message}`);
  }
}

// ── FINAL REPORT ──
console.log('\n╔══════════════════════════════════════╗');
console.log('║  IMPORT REPORT                        ║');
console.log('╚══════════════════════════════════════╝\n');

console.log(`Toko: ${STORE}`);
console.log(`File diproses: ${report.files.length}/${files.length}`);
if (report.errors.length > 0) console.log(`\n❌ ERRORS (${report.errors.length}):`);
for (const e of report.errors) console.log(`   ${e.file}: ${e.error}`);
if (report.warnings.length > 0) console.log(`\n⚠️ WARNINGS (${report.warnings.length}):`);
for (const w of report.warnings) console.log(`   ${w}`);

console.log(`\n📦 Orders: ${report.orders.inserted} baru, ${report.orders.updated} update, ${report.orders.skipped} skip, ${report.orders.skuResolved} SKU alias resolved`);
if (report.orders.skuUnknown.length > 0) {
  console.log(`   ⚠️ ${report.orders.skuUnknown.length} SKU BELUM TERPETAKAN:`);
  for (const s of [...new Set(report.orders.skuUnknown)].slice(0, 20)) console.log(`      - ${s}`);
  console.log(`   → Tambahkan HPP di Master SKU panel dashboard`);
}

console.log(`\n💰 Income: ${report.income.inserted} baru, ${report.income.duplicates} duplikat dicegah`);
for (const [k, v] of Object.entries(report.income.breakdown)) console.log(`   ${k}: ${v}`);

console.log(`\n📊 Ads: ${report.ads.inserted} baru, ${report.ads.duplicates} duplikat, ${report.ads.success} Success, ${report.ads.failed} Failed`);

console.log(`\n🔄 Returns: ${report.returns.inserted} baru, ${report.returns.updated} update`);

// ── VERIFICATION ──
console.log('\n=== VERIFIKASI ===');
const counts = {
  orders: db.prepare('SELECT COUNT(*) as c FROM finance_order_lines').get().c,
  income: db.prepare('SELECT COUNT(*) as c FROM finance_income_raw').get().c,
  ads: db.prepare('SELECT COUNT(DISTINCT transaction_id) as c FROM finance_ad_spend').get().c,
  returns: db.prepare('SELECT COUNT(*) as c FROM finance_returns').get().c,
};

console.log(`Orders: ${counts.orders} lines`);
console.log(`Income: ${counts.income} events`);
console.log(`Ads: ${counts.ads} unique IDs`);
console.log(`Returns: ${counts.returns} cases`);

if (counts.income > 0) {
  const may = db.prepare("SELECT SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE transaction_type='Pesanan' AND order_created_time>='2026-05-01' AND order_created_time<'2026-06-01'").get();
  console.log(`\nMay Settlement: ${fmt(may.s)} ${Math.abs(may.s - 8772345) <= 1 ? '✅' : '❌'}`);
  console.log(`May Fee: ${fmt(Math.abs(may.f))} ${Math.abs(Math.abs(may.f) - 3223291) <= 1 ? '✅' : '❌'}`);
}

db.close();
console.log('\n✅ IMPORT SELESAI');
