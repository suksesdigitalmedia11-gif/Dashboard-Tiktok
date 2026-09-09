/**
 * AUDIT KOMPREHENSIF - Custombase Juli 2026
 * Bug 1: Order Selesai selisih 1 (6524 vs 6525)
 * Bug 2: Packing terlalu besar (harusnya per-order, bukan per-qty)
 * Bug 3: Iklan GMV kurang dari file Excel
 */
const db = require('./lib/pg-connector').getDb();
const XLSX = require('xlsx');
const path = require('path');

const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const sep = () => console.log('-'.repeat(70));

// ═══════════════════════════════════════════════
// BUG 1: ORDER SELESAI SELISIH 1
// ═══════════════════════════════════════════════
console.log('\n═══ BUG 1: ORDER SELESAI DISCREPANCY ═══');
sep();

// Baca file pesanan Juli custombase
let orderFile;
try {
    orderFile = XLSX.readFile('juli custombase.xlsx');
} catch (e) {
    console.log('❌ File "juli custombase.xlsx" tidak ditemukan:', e.message);
    orderFile = null;
}

let fileOrderSelesaiCount = 0;
let fileOrderIds = new Set();
if (orderFile) {
    const ws = orderFile.Sheets[orderFile.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    console.log('Total baris di file pesanan:', rows.length);

    // Deteksi kolom status dan order_id
    const sample = rows[0] || {};
    const allKeys = Object.keys(sample);
    console.log('Kolom tersedia:', allKeys.slice(0, 10).join(', '), '...');

    // Cari kolom yang relevan
    const statusKey = allKeys.find(k => k.toLowerCase().includes('status') || k.toLowerCase().includes('pesanan'));
    const orderKey = allKeys.find(k => k.toLowerCase().includes('nomor') || k.toLowerCase().includes('order id') || k.toLowerCase().includes('order_id'));
    console.log('Kolom status:', statusKey, '| Kolom order ID:', orderKey);

    if (statusKey && orderKey) {
        rows.forEach(r => {
            const status = String(r[statusKey] || '').trim();
            const orderId = String(r[orderKey] || '').trim();
            if (status.toLowerCase().includes('selesai') || status.toLowerCase().includes('completed')) {
                fileOrderIds.add(orderId);
                fileOrderSelesaiCount++;
            }
        });
        console.log('\nDari file Excel:');
        console.log('  Total baris "Selesai":', fileOrderSelesaiCount);
        console.log('  Unique order ID Selesai:', fileOrderIds.size);
    }
}

// DB: order Selesai custombase Juli
const dbOrders = db.prepare(`
  SELECT DISTINCT order_id, status, created_at
  FROM finance_order_lines
  WHERE store_name = 'custombase'
    AND created_at LIKE '2026-07%'
    AND (LOWER(status) LIKE '%selesai%' OR LOWER(status) LIKE '%complete%')
`).all();

const dbOrderIds = new Set(dbOrders.map(r => String(r.order_id)));
console.log('\nDari DB (finance_order_lines):');
console.log('  Unique order Selesai:', dbOrderIds.size);

// Cari selisih
if (fileOrderIds.size > 0) {
    const inFileNotInDb = [...fileOrderIds].filter(id => !dbOrderIds.has(id));
    const inDbNotInFile = [...dbOrderIds].filter(id => !fileOrderIds.has(id));
    console.log('\n  Order di file tapi TIDAK di DB:', inFileNotInDb.length);
    inFileNotInDb.slice(0, 5).forEach(id => console.log('    >', id));
    console.log('  Order di DB tapi TIDAK di file:', inDbNotInFile.length);
    inDbNotInFile.slice(0, 5).forEach(id => console.log('    >', id));
}

// Mode proyeksi (accrual) hitung: finalOrders (Selesai) vs estimatedOrders (Dikirim)
const allStatusCounts = db.prepare(`
  SELECT status, COUNT(DISTINCT order_id) as cnt
  FROM finance_order_lines
  WHERE store_name = 'custombase' AND created_at LIKE '2026-07%'
  GROUP BY status ORDER BY cnt DESC
`).all();
console.log('\nSemua status order di DB:');
allStatusCounts.forEach(r => console.log(`  ${r.status}: ${r.cnt} order`));

// ═══════════════════════════════════════════════
// BUG 2: PACKING CALCULATION
// ═══════════════════════════════════════════════
console.log('\n\n═══ BUG 2: PACKING CALCULATION ═══');
sep();

// Cek cara hitung packing sekarang
const packingRows = db.prepare(`
  SELECT 
    ol.order_id,
    COUNT(*) as line_count,
    SUM(ol.quantity) as total_qty,
    sc.packing_per_unit,
    SUM(ol.quantity) * COALESCE(sc.packing_per_unit, 0) as packing_per_qty_method,
    COALESCE(sc.packing_per_unit, 2000) as flat_rate_per_order
  FROM finance_order_lines ol
  LEFT JOIN (
    SELECT seller_sku, MAX(packing_per_unit) as packing_per_unit
    FROM finance_sku_costs WHERE status = 'active' GROUP BY seller_sku
  ) sc ON ol.sku = sc.seller_sku
  WHERE ol.store_name = 'custombase'
    AND ol.created_at LIKE '2026-07%'
    AND (LOWER(ol.status) LIKE '%selesai%' OR LOWER(ol.status) LIKE '%complet%')
  GROUP BY ol.order_id
  ORDER BY total_qty DESC
  LIMIT 10
`).all();

console.log('Contoh 10 order Selesai - perbandingan metode hitung packing:');
console.log('');
console.log('Order ID'.padEnd(20), 'Lines'.padEnd(8), 'Total Qty'.padEnd(12), 'Per-Qty Method'.padEnd(17), 'Per-Order Method');
packingRows.forEach(r => {
    const perQty = r.packing_per_qty_method || 0;
    const perOrder = r.flat_rate_per_order || 2000;
    const isDiff = perQty !== perOrder ? ' ⚠️ BEDA!' : '';
    console.log(
        String(r.order_id).slice(-12).padEnd(20),
        String(r.line_count).padEnd(8),
        String(r.total_qty).padEnd(12),
        rp(perQty).padEnd(17),
        rp(perOrder) + isDiff
    );
});

// Total agregat
const packingAgg = db.prepare(`
  SELECT 
    COUNT(DISTINCT ol.order_id) as order_count,
    SUM(ol.quantity * COALESCE(sc.packing_per_unit, 2000)) as total_per_qty,
    COUNT(DISTINCT ol.order_id) * 2000 as total_per_order_flat
  FROM finance_order_lines ol
  LEFT JOIN (
    SELECT seller_sku, MAX(packing_per_unit) as packing_per_unit
    FROM finance_sku_costs WHERE status = 'active' GROUP BY seller_sku
  ) sc ON ol.sku = sc.seller_sku
  WHERE ol.store_name = 'custombase'
    AND ol.created_at LIKE '2026-07%'
    AND (LOWER(ol.status) LIKE '%selesai%' OR LOWER(ol.status) LIKE '%complet%')
`).get();

console.log('\nSUMARY PACKING:');
console.log('  Jumlah order Selesai       :', packingAgg.order_count);
console.log('  [SALAH] Per-qty method      :', rp(packingAgg.total_per_qty), '← cara sekarang (per unit × 2000)');
console.log('  [BENAR] Per-order method    :', rp(packingAgg.total_per_order_flat), '← harusnya (per nomor order × 2000)');
console.log('  Selisih (overcounting)      :', rp(packingAgg.total_per_qty - packingAgg.total_per_order_flat));

// ═══════════════════════════════════════════════
// BUG 3: IKLAN GMV
// ═══════════════════════════════════════════════
console.log('\n\n═══ BUG 3: IKLAN GMV ═══');
sep();

let iklanFile;
try {
    iklanFile = XLSX.readFile('iklan juli custombase.xlsx');
} catch (e) {
    console.log('❌ File "iklan juli custombase.xlsx" tidak ditemukan:', e.message);
    iklanFile = null;
}

if (iklanFile) {
    console.log('Sheet yang tersedia:', iklanFile.SheetNames.join(', '));
    iklanFile.SheetNames.forEach(sheetName => {
        const ws = iklanFile.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (rows.length === 0) return;

        console.log(`\nSheet: "${sheetName}" (${rows.length} baris)`);
        const cols = Object.keys(rows[0] || {});
        console.log('Kolom:', cols.slice(0, 10).join(', '));

        // Cari kolom amount/nominal
        const amountCols = cols.filter(c =>
            c.toLowerCase().includes('amount') || c.toLowerCase().includes('biaya') ||
            c.toLowerCase().includes('nominal') || c.toLowerCase().includes('total') ||
            c.toLowerCase().includes('spend') || c.toLowerCase().includes('cost')
        );
        console.log('Kolom nominal:', amountCols.join(', '));

        // Total tiap kolom nominal
        amountCols.forEach(col => {
            const total = rows.reduce((sum, r) => {
                const val = String(r[col] || '').replace(/[^0-9.-]/g, '');
                return sum + (parseFloat(val) || 0);
            }, 0);
            if (total > 0) console.log(`  Total "${col}": ${rp(total)}`);
        });
    });
}

// DB: Iklan GMV Juli custombase
const dbIklan = db.prepare(`
  SELECT 
    SUM(amount) as total_gmv,
    COUNT(*) as rows,
    MIN(spend_date) as date_min,
    MAX(spend_date) as date_max
  FROM finance_ad_spend
  WHERE store_name = 'custombase'
    AND spend_date LIKE '2026-07%'
    AND source = 'gmv'
`).get();

const dbIklanTopup = db.prepare(`
  SELECT SUM(amount) as total_topup, COUNT(*) as rows
  FROM finance_ad_spend
  WHERE store_name = 'custombase'
    AND spend_date LIKE '2026-07%'
    AND source != 'gmv'
`).get();

console.log('\nDari DB (finance_ad_spend):');
console.log('  Iklan GMV Juli :', rp(dbIklan.total_gmv), '(', dbIklan.rows, 'entri,', dbIklan.date_min, '-', dbIklan.date_max, ')');
console.log('  Iklan Topup Juli:', rp(dbIklanTopup.total_topup), '(', dbIklanTopup.rows, 'entri)');

// Dari income_raw (GMV settlement)
const incomeGmv = db.prepare(`
  SELECT SUM(amount) as total, COUNT(*) as rows
  FROM finance_income_raw
  WHERE store_name = 'custombase'
    AND order_created_time LIKE '2026-07%'
    AND transaction_type LIKE '%Advertising%'
`).get();
console.log('  Dari income_raw (Advertising):', rp(incomeGmv.total), '(', incomeGmv.rows, 'entri)');

console.log('\n✅ Audit selesai!');
