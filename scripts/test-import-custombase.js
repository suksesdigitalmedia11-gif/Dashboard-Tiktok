/**
 * Test Import CustomBase → SQLite lokal
 * Verifikasi: import semua file CustomBase, lalu hitung summary
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Force SQLite mode
process.env.DATABASE_URL = '';

const { importRows, computeSummary, buildFilters, normalizeStore } = require('../lib/finance-cloud');
const pg = require('../lib/pg-connector');

const DATA_DIR = path.join(__dirname, '..', 'data tiktok', 'custombase');
const STORE = 'custombase';

function readExcelRows(filepath) {
  const wb = XLSX.readFile(filepath, { cellDates: false, raw: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  // Fix range
  const keys = Object.keys(ws).filter(k => k && k[0] !== '!');
  let maxRow = 0, maxCol = 0;
  for (const k of keys) {
    try { const c = XLSX.utils.decode_cell(k); if (c.r > maxRow) maxRow = c.r; if (c.c > maxCol) maxCol = c.c; } catch(e) {}
  }
  if (maxRow > 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows;
}

function formatRupiah(n) {
  return 'Rp' + Math.round(Number(n || 0)).toLocaleString('id-ID');
}

async function main() {
  console.log('=== TEST IMPORT CUSTOMBASE KE SQLITE LOKAL ===\n');
  
  // Init schema
  await pg.initSchema();
  console.log('[1/4] Schema OK\n');

  // --- STEP 1: Import SKU Template ---
  console.log('[2/4] Import SKU Template...');
  const skuFile = path.join(__dirname, '..', 'sku-template.xlsx');
  const skuRows = readExcelRows(skuFile);
  console.log(`  File: ${skuRows.length} rows`);
  
  const skuResult = await importRows({
    storeName: 'global',
    kind: 'sku',
    filename: 'sku-template.xlsx',
    rows: skuRows,
  });
  console.log(`  Result: ${JSON.stringify(skuResult)}`);

  // --- STEP 2: Import Pesanan (OrderSKUList) ---
  console.log('\n[3/4] Import Pesanan CustomBase...');
  const orderFile = path.join(DATA_DIR, 'semua-pesanan-april-sekarang.xlsx');
  const orderRows = readExcelRows(orderFile);
  console.log(`  File: ${orderRows.length} rows`);
  
  const orderResult = await importRows({
    storeName: STORE,
    kind: 'orders',
    filename: 'semua-pesanan-april-sekarang.xlsx',
    rows: orderRows,
  });
  console.log(`  Result: ${JSON.stringify(orderResult)}`);

  // --- STEP 3: Import Income Statements ---
  console.log('\n[4/4] Import Income Statement...');
  
  const incomeFiles = [
    'penarikan-dana-april-mei.xlsx',
    'penarikan-dana-juni-sekarang.xlsx',
  ];
  
  for (const fname of incomeFiles) {
    const fpath = path.join(DATA_DIR, fname);
    if (!fs.existsSync(fpath)) {
      console.log(`  SKIP: ${fname} (not found)`);
      continue;
    }
    const incomeRows = readExcelRows(fpath);
    console.log(`  File: ${fname} (${incomeRows.length} rows)`);
    
    const result = await importRows({
      storeName: STORE,
      kind: 'income',
      filename: fname,
      rows: incomeRows,
    });
    console.log(`  Result: ${JSON.stringify(result)}`);
  }

  // --- STEP 4: Import Ad Spend ---
  console.log('\n[5/5] Import Iklan...');
  const adFile = path.join(DATA_DIR, 'custombase-iklan-april-sekarang.xlsx');
  const adRows = readExcelRows(adFile);
  console.log(`  File: ${adRows.length} rows`);
  
  // Detect kind from ad file
  const adResult = await importRows({
    storeName: STORE,
    kind: 'ads',
    filename: 'custombase-iklan-april-sekarang.xlsx',
    rows: adRows,
  });
  console.log(`  Result: ${JSON.stringify(adResult)}`);

  // --- VERIFIKASI: Hitung Summary ---
  console.log('\n========================================');
  console.log('VERIFIKASI: computeSummary()');
  console.log('========================================\n');
  
  const filters = buildFilters({ preset: 'all', store: STORE });
  const summary = await computeSummary(filters);
  
  const t = summary.totals;
  console.log(`Total Orders: ${t.orders}`);
  console.log(`  Final (Selesai): ${t.finalOrders}`);
  console.log(`  Estimated (Dikirim): ${t.estimatedOrders}`);
  console.log(`  Cancelled: ${t.cancelledOrders}`);
  console.log(`  Held (Dana Tertahan): ${t.heldOrders}`);
  console.log('');
  console.log(`FINANSIAL:`);
  console.log(`  Omzet:                ${formatRupiah(t.omzet)}`);
  console.log(`  Platform Fee:         ${formatRupiah(t.platformFee)}`);
  console.log(`  Platform Fee Final:   ${formatRupiah(t.platformFeeFinal)}`);
  console.log(`  Platform Fee Estimasi:${formatRupiah(t.platformFeeEstimated)}`);
  console.log(`  Refund:               ${formatRupiah(t.refund)}`);
  console.log(`  Penggantian:          ${formatRupiah(t.adjustmentAmount)}`);
  console.log(`  Settlement:           ${formatRupiah(t.settlement)}`);
  console.log(`  HPP:                  ${formatRupiah(t.hpp)}`);
  console.log(`  Packing:              ${formatRupiah(t.packing)}`);
  console.log(`  Ad Spend (GMV):       ${formatRupiah(t.adSpendSettlement)}`);
  console.log(`  Ad Spend (Top-up):    ${formatRupiah(t.adSpendTopup)}`);
  console.log(`  Ad Spend (Total):     ${formatRupiah(t.adSpend)}`);
  console.log(`  ---`);
  console.log(`  Profit:               ${formatRupiah(t.profit)}`);
  console.log(`  Margin:               ${(t.margin || 0).toFixed(1)}%`);
  console.log(`  Final Profit:         ${formatRupiah(t.finalProfit)}`);
  console.log(`  Final Margin:         ${(t.finalMargin || 0).toFixed(1)}%`);
  console.log(`  Book Profit:          ${formatRupiah(t.bookProfit)}`);
  console.log(`  Book Margin:          ${(t.bookMargin || 0).toFixed(1)}%`);
  console.log('');
  console.log(`BOOK (berbasis income statement):`);
  console.log(`  Book Omzet:           ${formatRupiah(t.bookOmzet)}`);
  console.log(`  Book Settlement:      ${formatRupiah(t.bookSettlement)}`);
  console.log(`  Book Profit:          ${formatRupiah(t.bookProfit)}`);
  console.log('');
  console.log(`TOP SKU:`);
  for (const sku of (summary.topSku || []).slice(0, 5)) {
    console.log(`  ${sku.sku}: profit=${formatRupiah(sku.profit)}, margin=${(sku.margin||0).toFixed(1)}%, orders=${sku.orders}`);
  }
  console.log('');
  console.log(`ALERTS:`);
  for (const a of (summary.alerts || [])) {
    console.log(`  [${a.level}] ${a.title}: ${a.body}`);
  }
  
  // Count rows in DB
  const db = pg.getDb();
  const orderCount = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name = ?").get(STORE);
  const skuCostCount = db.prepare("SELECT COUNT(*) as c FROM finance_sku_costs").get();
  const adCount = db.prepare("SELECT COUNT(*) as c FROM finance_ad_spend WHERE store_name = ?").get(STORE);
  const incomeCount = db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name = ?").get(STORE);
  
  console.log(`\nDATABASE COUNTS:`);
  console.log(`  finance_order_lines (custombase): ${orderCount.c}`);
  console.log(`  finance_sku_costs: ${skuCostCount.c}`);
  console.log(`  finance_ad_spend (custombase): ${adCount.c}`);
  console.log(`  finance_income_raw (custombase): ${incomeCount.c}`);

  console.log('\n=== TEST IMPORT SELESAI ===');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
