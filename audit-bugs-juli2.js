const db = require('./lib/pg-connector').getDb();
const XLSX = require('xlsx');
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const sep = () => console.log('-'.repeat(70));

// ═══ BUG 1: 18 ORDER TIDAK MASUK DB ═══
console.log('\n═══ BUG 1: DETAIL 18 ORDER YANG TIDAK ADA DI DB ═══');
sep();

const orderFile = XLSX.readFile('juli custombase.xlsx');
const ws = orderFile.Sheets[orderFile.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

// Kumpulkan semua order Selesai dari file
const fileSelesaiOrders = {};
rows.forEach(r => {
    const status = String(r['Order Status'] || '').trim();
    const orderId = String(r['Order ID'] || '').trim();
    if (status.toLowerCase().includes('completed') || status.toLowerCase().includes('selesai')) {
        if (!fileSelesaiOrders[orderId]) {
            fileSelesaiOrders[orderId] = { status, sku: r['Seller SKU'] || r['SKU ID'] || '-', orderId };
        }
    }
});

// Ambil semua order dari DB
const dbOrderIds = new Set(
    db.prepare(`SELECT DISTINCT order_id FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%'`).all().map(r => String(r.order_id))
);

const missing18 = Object.keys(fileSelesaiOrders).filter(id => !dbOrderIds.has(id));
console.log(`Total order Selesai di file: ${Object.keys(fileSelesaiOrders).length} unique order`);
console.log(`Missing di DB: ${missing18.length} order`);
if (missing18.length > 0) {
    console.log('\nDaftar order yang TIDAK MASUK DB:');
    missing18.forEach(id => {
        const info = fileSelesaiOrders[id];
        console.log(`  Order: ${id} | Status file: ${info.status} | SKU: ${info.sku}`);
    });
}

// ═══ BUG 2: PACKING ═══
console.log('\n\n═══ BUG 2: PACKING — METODE SEKARANG VS YANG BENAR ═══');
sep();

// Hitungan SISTEM SEKARANG (packing_per_unit × qty per row)
const packingNow = db.prepare(`
  SELECT 
    COUNT(DISTINCT ol.order_id) as unique_orders,
    SUM(ol.quantity * COALESCE(sc.packing_per_unit, 0)) as total_packing_per_qty,
    SUM(ol.quantity) as total_qty
  FROM finance_order_lines ol
  LEFT JOIN finance_sku_costs sc ON ol.sku = sc.sku AND sc.store_name = 'global'
  WHERE ol.store_name = 'custombase'
    AND ol.created_at LIKE '2026-07%'
    AND LOWER(ol.status) LIKE '%selesai%'
`).get();

// Hitungan BENAR (per unique order = 1 paket = 1 × Rp2000)
const packingCorrect_flatRate = packingNow.unique_orders * 2000;

// Dari DB: rata-rata per order (untuk verifikasi)
const avgQtyPerOrder = db.prepare(`
  SELECT AVG(qty_per_order) as avg_qty
  FROM (
    SELECT order_id, SUM(quantity) as qty_per_order
    FROM finance_order_lines
    WHERE store_name='custombase' AND created_at LIKE '2026-07%' AND LOWER(status) LIKE '%selesai%'
    GROUP BY order_id
  )
`).get();

console.log('Jumlah unique order Selesai     :', packingNow.unique_orders);
console.log('Total qty semua SKU dalam order :', Math.round(packingNow.total_qty));
console.log('Rata-rata qty per order         :', Math.round(avgQtyPerOrder.avg_qty * 10) / 10, 'unit');
console.log('');
console.log('[SISTEM SEKARANG] Per-qty × Rp2000 :', rp(packingNow.total_packing_per_qty), '← SALAH (kalikan qty!!)');
console.log('[YANG BENAR]      Per-order × Rp2000:', rp(packingCorrect_flatRate), '← BENAR (1 order = 1 paket)');
console.log('Overcounting                       :', rp(packingNow.total_packing_per_qty - packingCorrect_flatRate));

// Contoh konkret
const exampleOrder = db.prepare(`
  SELECT ol.order_id, ol.sku, ol.quantity, sc.packing_per_unit
  FROM finance_order_lines ol
  LEFT JOIN finance_sku_costs sc ON ol.sku = sc.sku AND sc.store_name = 'global'
  WHERE ol.store_name='custombase' AND ol.created_at LIKE '2026-07%' AND LOWER(ol.status) LIKE '%selesai%'
  AND ol.order_id IN (
    SELECT order_id FROM finance_order_lines WHERE store_name='custombase' AND LOWER(status) LIKE '%selesai%' 
    GROUP BY order_id HAVING COUNT(*) > 1 LIMIT 1
  )
  ORDER BY ol.order_id, ol.sku
`).all();
if (exampleOrder.length > 0) {
    const ex_id = exampleOrder[0].order_id;
    console.log(`\nContoh order ${ex_id} (punya beberapa baris SKU):`);
    let sumQty = 0, sumPacking = 0;
    exampleOrder.forEach(r => {
        const pack = (r.quantity || 0) * (r.packing_per_unit || 0);
        sumQty += r.quantity;
        sumPacking += pack;
        console.log(`  SKU: ${r.sku} | qty: ${r.quantity} | packing_per_unit: ${r.packing_per_unit} | packing dihitung: ${rp(pack)}`);
    });
    console.log(`  TOTAL packing di sistem sekarang: ${rp(sumPacking)} ← SALAH`);
    console.log(`  SEHARUSNYA (1 order = 1 paket): ${rp(2000)}`);
}

// ═══ BUG 3: IKLAN GMV ═══
console.log('\n\n═══ BUG 3: IKLAN GMV — FILE EXCEL VS DB ═══');
sep();

// Baca file iklan
const iklanFile = XLSX.readFile('iklan juli custombase.xlsx');
console.log('Sheet di file iklan:', iklanFile.SheetNames.join(', '));

let totalFromFile = 0;
iklanFile.SheetNames.forEach(sheetName => {
    const ws = iklanFile.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) return;
    console.log(`\nSheet: "${sheetName}" (${rows.length} baris)`);
    console.log('Kolom:', Object.keys(rows[0] || {}).join(' | '));

    // Print beberapa baris untuk lihat struktur
    rows.slice(0, 3).forEach((r, i) => {
        console.log(`  Row ${i + 1}:`, JSON.stringify(r).slice(0, 150));
    });

    // Hitung total dari semua kolom numerik
    const cols = Object.keys(rows[0] || {});
    cols.forEach(col => {
        const total = rows.reduce((sum, r) => {
            const val = String(r[col] || '').replace(/[Rp,.\s]/g, '');
            const num = parseFloat(val);
            return sum + (isNaN(num) ? 0 : Math.abs(num));
        }, 0);
        if (total > 100000) {
            console.log(`  Total "${col}": ${rp(total)}`);
            totalFromFile += total;
        }
    });
});

// DB: Semua iklan custombase Juli
const dbIklanAll = db.prepare(`
  SELECT channel, status, COUNT(*) as rows, SUM(amount) as total
  FROM finance_ad_spend
  WHERE store_name='custombase' AND spend_date LIKE '2026-07%'
  GROUP BY channel, status
`).all();
console.log('\nSemua data iklan di DB (Juli):');
dbIklanAll.forEach(r => console.log(`  channel:${r.channel || '-'} | status:${r.status || '-'} | rows:${r.rows} | total:${rp(r.total)}`));

const dbTotal = dbIklanAll.reduce((s, r) => s + (r.total || 0), 0);
console.log('\nTotal iklan di DB     :', rp(dbTotal));

// Income raw - GMV ads
const incomeAds = db.prepare(`
  SELECT COUNT(*) as rows, SUM(total_revenue) as total, transaction_type
  FROM finance_income_raw
  WHERE store_name='custombase' AND order_created_time LIKE '2026-07%'
    AND (transaction_type LIKE '%Advertising%' OR transaction_type LIKE '%ads%' OR transaction_type LIKE '%iklan%')
  GROUP BY transaction_type
`).all();
console.log('\nIncome raw GMV/Ads Juli:');
if (incomeAds.length === 0) console.log('  (tidak ada entri advertising di income_raw)');
incomeAds.forEach(r => console.log(`  ${r.transaction_type}: ${r.rows} baris → ${rp(r.total)}`));
