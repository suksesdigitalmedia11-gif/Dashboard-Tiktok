/**
 * QUICK IMPORT — Add missing May orders and fix data
 * Uses existing schema without modifications
 */
const db = require('better-sqlite3')('./data/finance.db');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

db.pragma('journal_mode=WAL');

const STORE = 'custombase';
const DATA = path.join(__dirname, '..', 'data tiktok', 'custombase');
const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

const ct = v => String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
function rp(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const t = String(v||'').trim();
  if (!t) return 0;
  const neg = /^-/.test(t);
  let n = t.replace(/[^\d,.\-]/g,'');
  if (n.startsWith('+')) n = n.slice(1);
  const p = Number.parseFloat(n.replace(/,/g,''));
  return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0;
}
function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + v * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = String(v).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (slash) {
    const y = slash[3].length === 2 ? '20' + slash[3] : slash[3];
    return `${y}-${slash[2].padStart(2,'0')}-${slash[1].padStart(2,'0')} ${(slash[4]||'00').padStart(2,'0')}:${(slash[5]||'00').padStart(2,'0')}:${(slash[6]||'00').padStart(2,'0')}`;
  }
  const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')} ${(iso[4]||'00').padStart(2,'0')}:${(iso[5]||'00').padStart(2,'0')}:${(iso[6]||'00').padStart(2,'0')}`;
  }
  return '';
}
function field(row, ...names) {
  for (const n of names) if (row[n] !== undefined) return row[n];
  return '';
}
const lineKey = (store, oid, sku, varia) => `${ct(store)}|${String(oid||'').trim()}|${ct(sku)}|${ct(varia)}`;

function readSheet(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
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
    let hasData = false;
    for (let c = 0; c <= maxC; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== '') { row[headers[c]] = cell.v; hasData = true; }
    }
    if (hasData) rows.push(row);
  }
  return { rows, maxR };
}

async function main() {
  // Existing schema - just ensure indexes
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_income_unique ON finance_income_raw(store_name, order_id, transaction_type)"); } catch(e) {}
  
  // =========================================
  // IMPORT MAY ORDERS
  // =========================================
  console.log('=== IMPORTING MAY ORDERS ===');
  const orderFile = 'semua-pesanan-mei-akhir juni.xlsx';
  const fp = path.join(DATA, orderFile);
  
  if (!fs.existsSync(fp)) { console.log('File not found:', fp); return; }
  
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const { rows: rawRows } = readSheet(wb, 'OrderSKUList');
  console.log(`Raw rows: ${rawRows.length}`);
  
  let inserted = 0, skipped = 0, mayCount = 0;
  
  const orderStmt = db.prepare(`
    INSERT OR REPLACE INTO finance_order_lines(
      line_key, order_id, store_name, source, created_at, updated_at,
      status, order_substatus, sku, product_name, variation,
      quantity, unit_price, gross_product, seller_discount,
      platform_discount, platform_fee, refund_amount, order_amount,
      settlement_received, payment_method, tracking_id, package_id,
      cancel_reason, shipped_time, paid_time, cancelled_time,
      last_seen_file, last_seen_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  
  const insertBatch = db.transaction((batch) => {
    for (const row of batch) {
      const oid = String(field(row, 'Order ID') || '').trim();
      const sku = String(field(row, 'Seller SKU') || '').trim();
      if (!oid || !sku) { skipped++; continue; }
      if (oid.toLowerCase().includes('platform unique order')) { skipped++; continue; }
      if (sku.toLowerCase().includes('seller sku input by')) { skipped++; continue; }
      
      const created = parseDate(field(row, 'Created Time'));
      if (!created) { skipped++; continue; }
      
      // Only import May orders
      if (!created.startsWith('2026-05')) continue;
      
      const varia = String(field(row, 'Variation') || '').trim();
      const key = lineKey(STORE, oid, sku, varia);
      if (!key || key === 'custombase|||') { skipped++; continue; }
      
      const qty = Math.abs(parseInt(String(field(row, 'Quantity')).trim()) || 0);
      const up = rp(field(row, 'SKU Unit Original Price'));
      const gross = rp(field(row, 'SKU Subtotal Before Discount')) || up * qty;
      const sellerDisc = Math.abs(rp(field(row, 'SKU Seller Discount')));
      const platDisc = Math.abs(rp(field(row, 'SKU Platform Discount')));
      const refund = Math.abs(rp(field(row, 'Order Refund Amount')));
      const oa = rp(field(row, 'Order Amount'));
      const shipped = parseDate(field(row, 'Shipped Time'));
      const paid = parseDate(field(row, 'Paid Time'));
      const cancelled = parseDate(field(row, 'Cancelled Time'));
      const status = String(field(row, 'Order Status')).trim();
      const substatus = String(field(row, 'Order Substatus')).trim();
      const tracking = String(field(row, 'Tracking ID') || '').trim();
      const packageId = String(field(row, 'Package ID') || '').trim();
      const cancelReason = String(field(row, 'Cancelation/Return Type') || '').trim();
      const productName = String(field(row, 'Product Name') || '').trim();
      const payment = String(field(row, 'Payment Method') || '').trim();
      
      orderStmt.run(key, oid, STORE, 'tiktok_order', created, created,
        status, substatus, sku, productName, varia,
        qty, up, gross, sellerDisc,
        platDisc, 0, refund, oa,
        0, payment, tracking, packageId,
        cancelReason, shipped, paid, cancelled,
        orderFile, now);
      inserted++;
      mayCount++;
    }
  });
  
  const BATCH = 500;
  for (let i = 0; i < rawRows.length; i += BATCH) {
    insertBatch(rawRows.slice(i, i + BATCH));
  }
  
  console.log(`May orders: ${mayCount} lines inserted`);
  console.log(`Total inserted: ${inserted}, Skipped: ${skipped}`);
  
  // =========================================
  // IMPORT JULY-AUGUST ORDERS
  // =========================================
  console.log('\n=== IMPORTING JULY-AUGUST ORDERS ===');
  const orderFile2 = 'semua-pesanan-1 juli-7 agustus.xlsx';
  const fp2 = path.join(DATA, orderFile2);
  
  if (fs.existsSync(fp2)) {
    const wb2 = XLSX.readFile(fp2, { cellDates: false, raw: true });
    const { rows: rawRows2 } = readSheet(wb2, 'OrderSKUList');
    console.log(`Raw rows: ${rawRows2.length}`);
    
    let ins2 = 0, skip2 = 0;
    
    const insertBatch2 = db.transaction((batch) => {
      for (const row of batch) {
        const oid = String(field(row, 'Order ID') || '').trim();
        const sku = String(field(row, 'Seller SKU') || '').trim();
        if (!oid || !sku) { skip2++; continue; }
        if (oid.toLowerCase().includes('platform unique order')) { skip2++; continue; }
        if (sku.toLowerCase().includes('seller sku input by')) { skip2++; continue; }
        
        const created = parseDate(field(row, 'Created Time'));
        if (!created) { skip2++; continue; }
        
        const varia = String(field(row, 'Variation') || '').trim();
        const key = lineKey(STORE, oid, sku, varia);
        if (!key || key === 'custombase|||') { skip2++; continue; }
        
        const qty = Math.abs(parseInt(String(field(row, 'Quantity')).trim()) || 0);
        const up = rp(field(row, 'SKU Unit Original Price'));
        const gross = rp(field(row, 'SKU Subtotal Before Discount')) || up * qty;
        const sellerDisc = Math.abs(rp(field(row, 'SKU Seller Discount')));
        const platDisc = Math.abs(rp(field(row, 'SKU Platform Discount')));
        const refund = Math.abs(rp(field(row, 'Order Refund Amount')));
        const oa = rp(field(row, 'Order Amount'));
        const shipped = parseDate(field(row, 'Shipped Time'));
        const paid = parseDate(field(row, 'Paid Time'));
        const cancelled = parseDate(field(row, 'Cancelled Time'));
        const status = String(field(row, 'Order Status')).trim();
        const substatus = String(field(row, 'Order Substatus')).trim();
        const tracking = String(field(row, 'Tracking ID') || '').trim();
        const packageId = String(field(row, 'Package ID') || '').trim();
        const cancelReason = String(field(row, 'Cancelation/Return Type') || '').trim();
        const productName = String(field(row, 'Product Name') || '').trim();
        const payment = String(field(row, 'Payment Method') || '').trim();
        
        orderStmt.run(key, oid, STORE, 'tiktok_order', created, created,
          status, substatus, sku, productName, varia,
          qty, up, gross, sellerDisc,
          platDisc, 0, refund, oa,
          0, payment, tracking, packageId,
          cancelReason, shipped, paid, cancelled,
          orderFile2, now);
        ins2++;
      }
    });
    
    for (let i = 0; i < rawRows2.length; i += BATCH) {
      insertBatch2(rawRows2.slice(i, i + BATCH));
    }
    
    console.log(`July-Aug orders: ${ins2} lines inserted, ${skip2} skipped`);
  } else {
    console.log('July-August file not found');
  }
  
  // =========================================
  // RE-IMPORT INCOME (with better dedup)
  // =========================================
  console.log('\n=== IMPORTING INCOME ===');
  
  // Clear income for fresh import
  db.prepare("DELETE FROM finance_income_raw WHERE store_name=?").run(STORE);
  
  const incomeFile = 'penarikan-dana-mei-akhir juni.xlsx';
  const ifp = path.join(DATA, incomeFile);
  
  if (!fs.existsSync(ifp)) { console.log('Income file not found:', ifp); return; }
  
  const iwb = XLSX.readFile(ifp, { cellDates: false, raw: true });
  const { rows: iRows } = readSheet(iwb, 'Detail pesanan');
  console.log(`Income raw rows: ${iRows.length}`);
  
  const incomeStmt = db.prepare(`
    INSERT OR IGNORE INTO finance_income_raw(
      store_name, transaction_type, order_id, order_created_time,
      settlement_amount, total_fees, refund_amount,
      adjustment_amount, imported_at
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `);
  
  let iIns = 0, iSkip = 0;
  
  const incomeBatch = db.transaction((batch) => {
    for (const row of batch) {
      const type = String(field(row, 'Jenis transaksi') || '').trim();
      const oid = String(field(row, 'ID Pesanan/Penyesuaian') || '').trim();
      if (!oid || !type) { iSkip++; continue; }
      
      const orderCreated = parseDate(field(row, 'Waktu pemesanan'));
      const settlement = rp(field(row, 'Jumlah penyelesaian pembayaran'));
      const fees = Math.abs(rp(field(row, 'Total Biaya', 'Jumlah biaya')));
      const refund = Math.abs(rp(field(row, 'Subtotal pengembalian dana setelah diskon penjual')));
      const adj = rp(field(row, 'Jumlah penyesuaian'));
      
      incomeStmt.run(STORE, type, oid, orderCreated,
        settlement, fees, refund, adj, now);
      iIns++;
    }
  });
  
  for (let i = 0; i < iRows.length; i += BATCH) {
    incomeBatch(iRows.slice(i, i + BATCH));
  }
  
  console.log(`Income: ${iIns} inserted, ${iSkip} skipped`);
  
  // Also import second income file
  const incomeFile2 = 'penarikan-dana-1 juli - sekarang.xlsx';
  const ifp2 = path.join(DATA, incomeFile2);
  
  if (fs.existsSync(ifp2)) {
    const iwb2 = XLSX.readFile(ifp2, { cellDates: false, raw: true });
    const sheetName = iwb2.SheetNames.includes('Detail pesanan') ? 'Detail pesanan' : iwb2.SheetNames[0];
    const { rows: iRows2 } = readSheet(iwb2, sheetName);
    console.log(`Income file 2 raw rows: ${iRows2.length}`);
    
    let iIns2 = 0, iSkip2 = 0;
    
    const incomeBatch2 = db.transaction((batch) => {
      for (const row of batch) {
        const type = String(field(row, 'Jenis transaksi') || '').trim();
        const oid = String(field(row, 'ID Pesanan/Penyesuaian') || '').trim();
        if (!oid || !type) { iSkip2++; continue; }
        const orderCreated = parseDate(field(row, 'Waktu pemesanan'));
        const settlement = rp(field(row, 'Jumlah penyelesaian pembayaran'));
        const fees = Math.abs(rp(field(row, 'Total Biaya', 'Jumlah biaya')));
        const refund = Math.abs(rp(field(row, 'Subtotal pengembalian dana setelah diskon penjual')));
        const adj = rp(field(row, 'Jumlah penyesuaian'));
        incomeStmt.run(STORE, type, oid, orderCreated, settlement, fees, refund, adj, now);
        iIns2++;
      }
    });
    
    for (let i = 0; i < iRows2.length; i += BATCH) {
      incomeBatch2(iRows2.slice(i, i + BATCH));
    }
    
    console.log(`Income file 2: ${iIns2} inserted, ${iSkip2} skipped`);
  }
  
  // =========================================
  // VERIFY
  // =========================================
  console.log('\n=== VERIFICATION ===');
  const orderCount = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name=?").get(STORE);
  const orderMonths = db.prepare("SELECT DISTINCT substr(created_at,1,7) as m, COUNT(*) as c FROM finance_order_lines WHERE store_name=? GROUP BY m ORDER BY m").all(STORE);
  console.log(`Total orders: ${orderCount.c} rows`);
  for (const m of orderMonths) console.log(`  ${m.m}: ${m.c} rows`);
  
  const incomeCount = db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name=?").get(STORE);
  const incomeMonths = db.prepare("SELECT DISTINCT substr(order_created_time,1,7) as m, COUNT(*) as c, SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' GROUP BY m ORDER BY m").all(STORE);
  console.log(`Total income: ${incomeCount.c} rows`);
  const ff = n => Math.round(n||0).toLocaleString('id-ID');
  for (const m of incomeMonths) console.log(`  ${m.m}: ${m.c} Pesanan rows, settlement=${ff(m.s)}`);
  
  // Check May specifically
  const mayOrders = db.prepare("SELECT DISTINCT substr(created_at,1,7) as m, status, COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at LIKE '2026-05%' GROUP BY status").all(STORE);
  console.log(`\nMay 2026 order status distribution:`);
  for (const s of mayOrders) console.log(`  ${s.status}: ${s.c} orders`);
  
  db.close();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
