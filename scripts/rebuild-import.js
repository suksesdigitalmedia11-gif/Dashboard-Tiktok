/**
 * REBUILD IMPORT — Custombase (Mei – Agustus 2026)
 * 
 * Full rebuild: clears all custombase data and re-imports from all XLSX files.
 * Uses better-sqlite3 with WAL mode, prepared statements, batch transactions (500 rows).
 * 
 * Sources:
 *   Orders:  semua-pesanan-mei-akhir juni.xlsx + semua-pesanan-1 juli-7 agustus.xlsx
 *   Income:  penarikan-dana-mei-akhir juni.xlsx + penarikan-dana-1 juli - sekarang.xlsx
 *   Ads:     iklan custombase mei - akhir juni.xlsx
 *   Returns: Pesanan yang Barang_Dananya Dikembalikan-1juli-sekarang.xlsx
 */

const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ── Constants ───────────────────────────────────────────────────────────────
const STORE = 'custombase';
const DATA_DIR = path.join(__dirname, '..', 'data tiktok', 'custombase');
const DB_PATH = path.join(__dirname, '..', 'data', 'finance.db');
const BATCH_SIZE = 500;
const now = new Date().toISOString();

// ── Helpers ─────────────────────────────────────────────────────────────────
const ct = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Parse rupiah or numeric string to integer (absolute value, handle negatives) */
function rp(v) {
  const t = String(v || '').trim();
  if (!t) return 0;
  const neg = /^-/.test(t);
  let n = t.replace(/[^\d,.\-]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  const p = Number.parseFloat(n.replace(/,/g, ''));
  return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0;
}

/** Parse date from various formats to YYYY-MM-DD */
function pd(v) {
  if (!v) return '';
  const r = String(v).trim();
  // YYYY/MM/DD or YYYY-MM-DD
  const iso = r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) return iso[1] + '-' + iso[2].padStart(2, '0') + '-' + iso[3].padStart(2, '0');
  // MM/DD/YYYY or DD/MM/YYYY (try both)
  const s = r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (s) {
    // TikTok uses DD/MM/YYYY
    const yr = s[3].length === 2 ? '20' + s[3] : s[3];
    return yr + '-' + s[2].padStart(2, '0') + '-' + s[1].padStart(2, '0');
  }
  return '';
}

/** Parse datetime: returns YYYY-MM-DD HH:MM:SS format */
function pdt(v) {
  if (!v) return '';
  const r = String(v).trim();
  // YYYY/MM/DD HH:MM:SS or YYYY-MM-DD HH:MM:SS
  const isoDT = r.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoDT) {
    return isoDT[1] + '-' + isoDT[2].padStart(2, '0') + '-' + isoDT[3].padStart(2, '0') +
           ' ' + isoDT[4].padStart(2, '0') + ':' + isoDT[5] + ':' + (isoDT[6] || '00');
  }
  // MM/DD/YYYY HH:MM:SS (TikTok format: DD/MM/YYYY HH:MM:SS)
  const s = r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (s) {
    const yr = s[3].length === 2 ? '20' + s[3] : s[3];
    return yr + '-' + s[2].padStart(2, '0') + '-' + s[1].padStart(2, '0') +
           ' ' + s[4].padStart(2, '0') + ':' + s[5] + ':' + (s[6] || '00');
  }
  return '';
}

/** Extract first 19 chars (YYYY-MM-DD HH:MM:SS) from a datetime-like string */
function first19(v) {
  const dt = pdt(v);
  return dt ? dt.substring(0, 19) : '';
}

/** Number formatter */
const fmt = n => Math.round(n || 0).toLocaleString('id-ID');

// ── Statistics Tracker ──────────────────────────────────────────────────────
class Stats {
  constructor(label) {
    this.label = label;
    this.read = 0;
    this.inserted = 0;
    this.updated = 0;
    this.skipped = 0;
    this.errors = 0;
  }
  print() {
    console.log(`  ${this.label}:`);
    console.log(`    Rows read:    ${this.read.toLocaleString('id-ID')}`);
    console.log(`    Inserted:     ${this.inserted.toLocaleString('id-ID')}`);
    console.log(`    Updated:      ${this.updated.toLocaleString('id-ID')}`);
    console.log(`    Skipped:      ${this.skipped.toLocaleString('id-ID')}`);
    if (this.errors > 0) console.log(`    Errors:       ${this.errors}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     REBUILD IMPORT — custombase (Mei – Agustus 2026)     ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Open database with WAL mode
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');  // 64MB cache
  db.pragma('busy_timeout = 30000');
  console.log(`Database: ${DB_PATH} (WAL mode, 64MB cache)\n`);

  // ── Step 0: Rebuild indices ─────────────────────────────────────────────
  console.log('━━━ REBUILDING INDICES ━━━');
  // Drop existing unique indices that conflict with new dedup logic
  try { db.prepare('DROP INDEX IF EXISTS idx_income_unique').run(); console.log('  Dropped idx_income_unique'); } catch(e) {}
  try { db.prepare('DROP INDEX IF EXISTS idx_ad_unique').run(); console.log('  Dropped idx_ad_unique'); } catch(e) {}
  
  // Create new unique indices matching import dedup keys
  // Income dedup: store_name + order_id + transaction_type + first 19 chars of waktu_pembayaran_pesanan (stored as settled_at)
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_income_unique ON finance_income_raw(store_name, order_id, transaction_type, settled_at)').run();
  console.log('  Created idx_income_unique (store_name, order_id, transaction_type, settled_at)');
  
  // Ad dedup: store_name + transaction_id
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name, transaction_id)').run();
  console.log('  Created idx_ad_unique (store_name, transaction_id)');

  // ── Step 1: Clear all custombase data ──────────────────────────────────
  console.log('\n━━━ CLEARING custombase DATA ━━━');
  const tables = ['finance_order_lines', 'finance_income_raw', 'finance_ad_spend'];
  for (const tbl of tables) {
    const result = db.prepare(`DELETE FROM ${tbl} WHERE store_name = ?`).run(STORE);
    console.log(`  ${tbl}: ${result.changes} rows deleted`);
  }

  // ── Step 2: IMPORT ORDERS ──────────────────────────────────────────────
  console.log('\n━━━ ORDERS ━━━');
  const orderFiles = [
    { file: 'semua-pesanan-mei-akhir juni.xlsx', label: 'Mei–Juni', sheet: 'OrderSKUList' },
    { file: 'semua-pesanan-1 juli-7 agustus.xlsx', label: 'Juli–Agustus', sheet: 'OrderSKUList' },
  ];
  
  const orderStats = new Stats('TOTAL ORDERS');
  
  for (const { file, label, sheet } of orderFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) {
      console.log(`  SKIP ${label} (not found): ${file}`);
      continue;
    }
    
    console.log(`  Loading ${label}: ${file}...`);
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
    const ws = wb.Sheets[sheet];
    if (!ws) {
      console.log(`  SKIP: sheet "${sheet}" not found`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    const fileStats = { read: 0, inserted: 0, updated: 0, skipped: 0 };
    
    const insertOrder = db.prepare(`
      INSERT OR REPLACE INTO finance_order_lines(
        line_key, order_id, store_name, source, created_at, updated_at,
        status, order_substatus, sku, product_name, variation, quantity,
        unit_price, gross_product, seller_discount, platform_discount,
        platform_fee, refund_amount, order_amount, settlement_received,
        payment_method, tracking_id, package_id, cancel_reason,
        shipped_time, paid_time, cancelled_time, adjustment_amount,
        last_seen_file, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertOrderBatch = db.transaction((batch) => {
      for (const params of batch) insertOrder.run(...params);
    });
    
    let batch = [];
    
    for (const r of rows) {
      fileStats.read++;
      const oid = String(r['Order ID'] || '').trim();
      const sku = String(r['Seller SKU'] || '').trim();
      
      // Skip description row
      if (!oid || oid.toLowerCase().includes('platform unique order id')) {
        fileStats.skipped++;
        continue;
      }
      if (!sku) {
        fileStats.skipped++;
        continue;
      }
      
      const varia = String(r['Variation'] || '').trim();
      const lineKey = ct(STORE) + '|' + oid + '|' + ct(sku) + '|' + ct(varia);
      const created = pdt(r['Created Time']);
      if (!created) { fileStats.skipped++; continue; }
      
      const qty = Math.abs(parseInt(String(r['Quantity']).trim()) || 0);
      const up = rp(r['SKU Unit Original Price']);
      const gross = rp(r['SKU Subtotal Before Discount']) || up * qty;
      const sellerDisc = Math.abs(rp(r['SKU Seller Discount']));
      const platDisc = Math.abs(rp(r['SKU Platform Discount']));
      const refundAmt = rp(r['Order Refund Amount']);
      
      // Order Amount: use column if it exists and has a value, otherwise calculate
      let orderAmt = 0;
      const rawOrderAmt = String(r['Order Amount'] || '').trim();
      if (rawOrderAmt && !isNaN(rp(rawOrderAmt))) {
        orderAmt = rp(rawOrderAmt);
      } else {
        // Calculate: gross - seller_discount - platform_discount (approximation)
        orderAmt = gross - sellerDisc - platDisc;
      }
      
      const shipped = pdt(r['Shipped Time']) || null;
      const paid = pdt(r['Paid Time']) || null;
      const cancelled = pdt(r['Cancelled Time']) || null;
      
      const params = [
        lineKey, oid, STORE, 'tiktok_order', created, now,
        String(r['Order Status'] || '').trim(),
        String(r['Order Substatus'] || '').trim(),
        sku,
        String(r['Product Name'] || '').trim(),
        varia,
        qty, up, gross, sellerDisc, platDisc,
        0, // platform_fee (filled from income later)
        refundAmt,
        orderAmt,
        0, // settlement_received (filled from income later)
        String(r['Payment Method'] || '').trim(),
        String(r['Tracking ID'] || '').trim(),
        String(r['Package ID'] || '').trim(),
        String(r['Cancelation/Return Type'] || r['Cancel Reason'] || '').trim(),
        shipped, paid, cancelled,
        0, // adjustment_amount
        file,
        now
      ];
      
      batch.push(params);
      fileStats.inserted++;
      
      if (batch.length >= BATCH_SIZE) {
        insertOrderBatch(batch);
        batch = [];
      }
    }
    
    // Flush remaining
    if (batch.length > 0) insertOrderBatch(batch);
    
    console.log(`    ${label}: ${fileStats.read} read, ${fileStats.inserted} inserted, ${fileStats.skipped} skipped`);
    orderStats.read += fileStats.read;
    orderStats.inserted += fileStats.inserted;
    orderStats.skipped += fileStats.skipped;
  }
  
  orderStats.print();

  // ── Step 3: IMPORT INCOME ──────────────────────────────────────────────
  console.log('\n━━━ INCOME ━━━');
  const incomeFiles = [
    { file: 'penarikan-dana-mei-akhir juni.xlsx', label: 'Mei–Juni', sheet: 'Detail pesanan' },
    { file: 'penarikan-dana-1 juli - sekarang.xlsx', label: 'Juli–Sekarang', sheet: 'Detail pesanan', altSheet: 'Sheet1' },
  ];
  
  const incomeStats = new Stats('TOTAL INCOME');
  
  // Prepare statement for INSERT OR IGNORE (relies on unique index for dedup)
  // Unique index: (store_name, order_id, transaction_type, settled_at)
  const insertIncome = db.prepare(`
    INSERT OR IGNORE INTO finance_income_raw(
      store_name, transaction_type, order_id, order_created_time,
      settlement_amount, total_fees, refund_amount, adjustment_amount,
      imported_at, settled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const { file, label, sheet, altSheet } of incomeFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) {
      console.log(`  SKIP ${label} (not found): ${file}`);
      continue;
    }
    
    console.log(`  Loading ${label}: ${file}...`);
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true, cellFormula: false, cellStyles: false });
    
    // Try primary sheet, then alt
    let ws = wb.Sheets[sheet];
    if (!ws && altSheet) ws = wb.Sheets[altSheet];
    if (!ws) {
      console.log(`  SKIP: sheet "${sheet}"${altSheet ? ' or "' + altSheet + '"' : ''} not found. Available: ${wb.SheetNames.join(', ')}`);
      continue;
    }
    
    // Expand sheet range — XLSX files often have truncated !ref ranges
    const ikeys = Object.keys(ws).filter(k => k && k[0] !== '!');
    let maxRow = 0, maxCol = 0;
    for (const k of ikeys) {
      try { const c = XLSX.utils.decode_cell(k); if (c.r > maxRow) maxRow = c.r; if (c.c > maxCol) maxCol = c.c; } catch (e) {}
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
    
    // Read as array (header row + data rows)
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    
    const fileStats = { read: 0, inserted: 0, skipped: 0 };
    const typeBreakdown = {};
    
    const insertIncomeBatch = db.transaction((batch) => {
      for (const params of batch) {
        const result = insertIncome.run(...params);
        if (result.changes > 0) fileStats.inserted++;
        else fileStats.skipped++;
      }
    });
    
    let batch = [];
    
    // Row 0 = headers, rows 1..n = data
    for (let i = 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (!r || !r[1]) continue; // Skip empty rows
      
      fileStats.read++;
      
      const orderId = String(r[0] || '').trim();       // ID Pesanan/Penyesuaian
      const txType = String(r[1] || '').trim();        // Jenis transaksi
      const orderTime = pd(r[2]);                       // Waktu pemesanan
      const paymentTime = first19(r[3]);                // Waktu pembayaran pesanan (first 19 chars for dedup)
      const settlement = rp(r[5]);                      // Jumlah penyelesaian pembayaran
      const fees = Math.abs(rp(r[14]));                 // Total Biaya
      const refund = rp(r[11]);                         // Subtotal pengembalian dana setelah diskon penjual
      
      if (!orderId || !txType) {
        fileStats.skipped++;
        continue;
      }
      
      // Track type breakdown
      typeBreakdown[txType] = (typeBreakdown[txType] || 0) + 1;
      
      batch.push([STORE, txType, orderId, orderTime, settlement, fees, refund, 0, now, paymentTime]);
      
      if (batch.length >= BATCH_SIZE) {
        insertIncomeBatch(batch);
        batch = [];
      }
    }
    
    // Flush remaining
    if (batch.length > 0) insertIncomeBatch(batch);
    
    console.log(`    ${label}: ${fileStats.read} read, ${fileStats.inserted} inserted, ${fileStats.skipped} dup/skipped`);
    for (const [type, count] of Object.entries(typeBreakdown).sort()) {
      console.log(`      ${type}: ${count}`);
    }
    
    incomeStats.read += fileStats.read;
    incomeStats.inserted += fileStats.inserted;
    incomeStats.skipped += fileStats.skipped;
  }
  
  // Verify stored income
  const storedIncome = db.prepare(`
    SELECT transaction_type, COUNT(*) as c, SUM(settlement_amount) as total
    FROM finance_income_raw WHERE store_name = ?
    GROUP BY transaction_type ORDER BY c DESC
  `).all(STORE);
  console.log('  Stored (deduped):');
  for (const si of storedIncome) {
    console.log(`    ${si.transaction_type}: ${si.c} rows, Σ=${fmt(si.total)}`);
  }
  
  incomeStats.print();

  // ── Step 4: IMPORT ADS ─────────────────────────────────────────────────
  console.log('\n━━━ AD SPEND ━━━');
  const adFiles = [
    { file: 'iklan custombase mei - akhir juni.xlsx', label: 'Mei–Juni', sheet: 'sheet1' },
  ];
  
  const adStats = new Stats('TOTAL AD SPEND');
  
  const insertAd = db.prepare(`
    INSERT OR IGNORE INTO finance_ad_spend(
      store_name, spend_date, amount, channel, campaign, note,
      created_at, updated_at, transaction_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const { file, label, sheet } of adFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) {
      console.log(`  SKIP ${label} (not found): ${file}`);
      continue;
    }
    
    console.log(`  Loading ${label}: ${file}...`);
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
    const ws = wb.Sheets[sheet];
    if (!ws) {
      console.log(`  SKIP: sheet "${sheet}" not found`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    const fileStats = { read: 0, inserted: 0, skipped: 0, settlementAd: 0, topUp: 0 };
    
    const insertAdBatch = db.transaction((batch) => {
      for (const params of batch) {
        const result = insertAd.run(...params);
        if (result.changes > 0) fileStats.inserted++;
        else fileStats.skipped++;
      }
    });
    
    let batch = [];
    
    for (const r of rows) {
      fileStats.read++;
      
      const txType = String(r['Transaction type'] || '').trim();
      const txSubtype = String(r['Transaction subtype'] || '').trim();
      const status = String(r['Status'] || '').trim();
      const txId = String(r['Transaction ID'] || '').trim();
      const desc = String(r['Description'] || '').trim();
      const amount = rp(r['Amount']);
      
      if (!txId || status !== 'Success') {
        fileStats.skipped++;
        continue;
      }
      
      // Classify per task spec:
      //   Bill payment + Success + GMV Pay → settlement ad
      //   Add balance + Success → top up
      //   Everything else → skip
      const isGMVPay = desc.toLowerCase().includes('gmv pay');
      
      let channel, campaign;
      
      if (txType === 'General' && txSubtype === 'Bill payment' && isGMVPay) {
        channel = 'TikTok Settlement Ad';
        campaign = 'GMV Pay Settlement';
        fileStats.settlementAd++;
      } else if (txType === 'General' && txSubtype === 'Add balance') {
        channel = 'TikTok Top Up';
        campaign = 'Manual Top Up';
        fileStats.topUp++;
      } else {
        fileStats.skipped++;
        continue;
      }
      
      // Parse date from Transaction time
      const spendDate = String(r['Transaction time'] || '').trim();
      const datePart = pdt(spendDate).substring(0, 10) || spendDate.substring(0, 10).replace(/\//g, '-');
      
      batch.push([STORE, datePart, amount, channel, campaign, desc, now, now, txId]);
      
      if (batch.length >= BATCH_SIZE) {
        insertAdBatch(batch);
        batch = [];
      }
    }
    
    if (batch.length > 0) insertAdBatch(batch);
    
    console.log(`    ${label}: ${fileStats.read} read, ${fileStats.inserted} inserted, ${fileStats.skipped} skipped`);
    console.log(`      Settlement Ads: ${fileStats.settlementAd}`);
    console.log(`      Top Ups:        ${fileStats.topUp}`);
    
    adStats.read += fileStats.read;
    adStats.inserted += fileStats.inserted;
    adStats.skipped += fileStats.skipped;
  }
  
  adStats.print();

  // ── Step 5: IMPORT RETURNS ─────────────────────────────────────────────
  console.log('\n━━━ RETURNS ━━━');
  const returnFiles = [
    { file: 'Pesanan yang Barang_Dananya Dikembalikan-1juli-sekarang.xlsx', label: 'Juli–Sekarang' },
  ];
  
  const returnStats = new Stats('TOTAL RETURNS');
  
  for (const { file, label } of returnFiles) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) {
      console.log(`  SKIP ${label} (not found): ${file}`);
      continue;
    }
    
    console.log(`  Loading ${label}: ${file}...`);
    const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      console.log(`  SKIP: no sheets found`);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    const fileStats = { read: 0, inserted: 0, skipped: 0 };
    
    // Returns go into finance_income_raw with return_id populated
    // Dedup: store_name + Return Order ID
    const insertReturn = db.prepare(`
      INSERT OR IGNORE INTO finance_income_raw(
        store_name, transaction_type, order_id, order_created_time,
        settlement_amount, total_fees, refund_amount, adjustment_amount,
        imported_at, return_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertReturnBatch = db.transaction((batch) => {
      for (const params of batch) {
        const result = insertReturn.run(...params);
        if (result.changes > 0) fileStats.inserted++;
        else fileStats.skipped++;
      }
    });
    
    let batch = [];
    
    for (const r of rows) {
      fileStats.read++;
      
      const returnId = String(r['Return Order ID'] || '').trim();
      const orderId = String(r['Order ID'] || '').trim();
      
      if (!returnId) {
        fileStats.skipped++;
        continue;
      }
      
      const returnType = String(r['Return Type'] || '').trim();
      const orderAmount = rp(r['Order Amount']);
      const returnUnitPrice = rp(r['Return unit price']);
      
      batch.push([
        STORE,
        'Return - ' + returnType,
        orderId,
        pdt(r['Time Requested']),
        -Math.abs(returnUnitPrice || orderAmount), // negative settlement (money going out)
        0, // total_fees
        returnUnitPrice || orderAmount, // refund_amount
        0, // adjustment_amount
        now,
        returnId
      ]);
      
      if (batch.length >= BATCH_SIZE) {
        insertReturnBatch(batch);
        batch = [];
      }
    }
    
    if (batch.length > 0) insertReturnBatch(batch);
    
    console.log(`    ${label}: ${fileStats.read} read, ${fileStats.inserted} inserted, ${fileStats.skipped} skipped`);
    returnStats.read += fileStats.read;
    returnStats.inserted += fileStats.inserted;
    returnStats.skipped += fileStats.skipped;
  }
  
  returnStats.print();

  // ── Step 6: VERIFICATION ───────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                     VERIFICATION                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  // Order counts by status
  const orderCounts = db.prepare(`
    SELECT status, COUNT(DISTINCT order_id) as orders, COUNT(*) as lines
    FROM finance_order_lines WHERE store_name = ?
    GROUP BY status ORDER BY lines DESC
  `).all(STORE);
  console.log('ORDER STATUS BREAKDOWN:');
  for (const o of orderCounts) {
    console.log(`  ${o.status}: ${o.orders} orders (${o.lines} lines)`);
  }
  
  // Income summary by type
  const incomeSummary = db.prepare(`
    SELECT transaction_type, COUNT(*) as c, SUM(settlement_amount) as total_settlement,
           SUM(total_fees) as total_fees, SUM(refund_amount) as total_refund
    FROM finance_income_raw WHERE store_name = ?
    GROUP BY transaction_type ORDER BY c DESC
  `).all(STORE);
  console.log('\nINCOME SUMMARY:');
  for (const ir of incomeSummary) {
    console.log(`  ${ir.transaction_type}: ${ir.c} rows | Settlement=${fmt(ir.total_settlement)} | Fees=${fmt(ir.total_fees)} | Refund=${fmt(ir.total_refund)}`);
  }
  
  // Ad spend summary
  const adSummary = db.prepare(`
    SELECT channel, COUNT(*) as c, SUM(amount) as total
    FROM finance_ad_spend WHERE store_name = ?
    GROUP BY channel ORDER BY c DESC
  `).all(STORE);
  console.log('\nAD SPEND SUMMARY:');
  for (const a of adSummary) {
    console.log(`  ${a.channel}: ${a.c} rows, Σ=${fmt(a.total)}`);
  }
  
  // Monthly income breakdown
  console.log('\nMONTHLY INCOME (Pesanan):');
  const monthlyIncome = db.prepare(`
    SELECT substr(order_created_time, 1, 7) as month,
           COUNT(*) as c,
           SUM(settlement_amount) as settlement,
           SUM(total_fees) as fees
    FROM finance_income_raw
    WHERE store_name = ? AND transaction_type = 'Pesanan'
    GROUP BY month ORDER BY month
  `).all(STORE);
  for (const m of monthlyIncome) {
    console.log(`  ${m.month}: ${m.c} rows | Settlement=${fmt(m.settlement)} | Fees=${fmt(m.fees)}`);
  }
  
  console.log('\n✅ REBUILD COMPLETE');
  
  db.close();
}

// ── Execute ─────────────────────────────────────────────────────────────────
try {
  main();
} catch (e) {
  console.error('FATAL ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
}
