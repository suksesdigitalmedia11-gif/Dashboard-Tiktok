// Check for Golden May fixture and available data
const db = require('better-sqlite3')('./data/finance.db');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== GOLDEN MEI FIXTURE SEARCH ===\n');

// 1. Check all test files for references
const testDir = path.join(__dirname, 'tests');
const testFiles = fs.readdirSync(testDir).filter(f => f.includes('golden') || f.includes('mei'));
console.log('Test files referencing May:');
for (const f of testFiles) {
  const content = fs.readFileSync(path.join(testDir, f), 'utf8');
  const xlsxRefs = content.match(/['"]([^'"\n]*\.xlsx)['"]/g) || [];
  const pathRefs = content.match(/path\.join\([^)]*\)/g) || [];
  console.log(`  ${f}:`);
  for (const r of xlsxRefs) console.log(`    ref: ${r}`);
}

// 2. Check git for xlsx files
console.log('\nGit xlsx files:');
try {
  const gitFiles = execSync('git ls-files -- "*xlsx" "*XLSX"', { cwd: __dirname, encoding: 'utf8' });
  gitFiles.split('\n').filter(Boolean).forEach(f => console.log(`  ${f}`));
} catch (e) { console.log('  (git not available)'); }

// 3. Check current May data in DB
console.log('\n=== CURRENT MAY DATA IN DB ===');
const mayOrders = db.prepare(`
  SELECT status, COUNT(DISTINCT order_id) as orders, COUNT(*) as lines,
    SUM(gross_product) as gross, SUM(seller_discount) as disc
  FROM finance_order_lines
  WHERE store_name='custombase' AND created_at >= '2026-05-01' AND created_at < '2026-06-01'
  GROUP BY status
`).all();
for (const r of mayOrders) {
  console.log(`  ${r.status}: ${r.orders} orders, ${r.lines} lines, gross=${Math.round(r.gross||0).toLocaleString('id-ID')}, disc=${Math.round(r.disc||0).toLocaleString('id-ID')}`);
}

// 4. What's the earliest created_at for May?
const earliest = db.prepare(`
  SELECT MIN(created_at) as d FROM finance_order_lines WHERE store_name='custombase' AND created_at >= '2026-05-01'
`).get();
console.log(`\nEarliest May order: ${earliest.d}`);
console.log('Expected: 2026-05-01 — FIXTURE_TIDAK_LENGKAP (starts May 2)');

// 5. How many Selesai do we get if we count DISTINCT order IDs?
const selesaiOids = db.prepare(`
  SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines 
  WHERE store_name='custombase' AND created_at >= '2026-05-01' AND created_at < '2026-06-01' AND status='Selesai'
`).get();
console.log(`\nUnique Selesai Order IDs: ${selesaiOids.c} (golden: 588, diff: ${588 - selesaiOids.c})`);

// 6. Get the actual income values
const mayInc = db.prepare(`
  SELECT transaction_type, SUM(settlement_amount) as s, SUM(total_fees) as f
  FROM finance_income_raw WHERE store_name='custombase' 
  AND order_created_time >= '2026-05-01' AND order_created_time < '2026-06-01'
  GROUP BY transaction_type
`).all();
console.log('\nMay Income:');
const pesanan = mayInc.find(r => r.transaction_type === 'Pesanan') || { s: 0, f: 0 };
const gmv = mayInc.find(r => r.transaction_type === 'Pembayaran GMV untuk Iklan TikTok') || { s: 0 };
console.log(`  Pesanan: settle=${Math.round(pesanan.s).toLocaleString('id-ID')} (golden: 8,772,345) ${Math.abs(pesanan.s - 8772345) <= 1 ? '✅' : '❌'}`);
console.log(`  Fee: ${Math.abs(Math.round(pesanan.f)).toLocaleString('id-ID')} (golden: 3,223,291) ${Math.abs(Math.abs(pesanan.f) - 3223291) <= 1 ? '✅' : '❌'}`);
console.log(`  GMV: ${Math.abs(Math.round(gmv.s)).toLocaleString('id-ID')} (golden: 1,472,709) ${Math.abs(Math.abs(gmv.s) - 1472709) <= 1 ? '✅' : '❌'}`);

db.close();
