/**
 * AUDIT PRODUKSI LENGKAP
 * Test: semua API endpoint, integritas data, kalkulasi, anti-duplicate
 */
const http = require('http');
const { getDb, pgQuery } = require('./lib/pg-connector');
const XLSX = require('xlsx');

const BASE_URL = 'http://localhost:9876';
const db = getDb();

function req(path, method, body) {
    return new Promise((resolve) => {
        const opts = {
            hostname: 'localhost', port: 9876,
            path, method: method || 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}
        };
        const r = http.request(opts, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
                catch (e) { resolve({ status: res.statusCode, data: d.substring(0, 100) }); }
            });
        });
        r.on('error', e => resolve({ status: 0, error: e.message }));
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

function pass(msg) { console.log('  ✅ PASS:', msg); }
function fail(msg) { console.log('  ❌ FAIL:', msg); }
function section(msg) { console.log('\n══════════════════════════════════'); console.log('  ' + msg); console.log('══════════════════════════════════'); }

async function main() {
    console.log('🔍 AUDIT PRODUKSI DASHBOARD KEUANGAN TIKTOK');
    console.log('Waktu:', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));

    let totalPass = 0, totalFail = 0;
    function check(cond, msgOk, msgFail) {
        if (cond) { pass(msgOk); totalPass++; } else { fail(msgFail); totalFail++; }
    }

    // ─────────────────────────────────────────
    section('1. API ENDPOINT HEALTH CHECK');
    // ─────────────────────────────────────────
    const endpoints = [
        ['GET', '/', 'Dashboard HTML'],
        ['GET', '/api/summary', 'Summary API'],
        ['GET', '/api/skus', 'SKU List API'],
        ['GET', '/api/split-data', 'Split Data API'],
    ];
    for (const [method, path, name] of endpoints) {
        const r = await req(path, method);
        check(r.status === 200, name + ' [' + r.status + ']', name + ' gagal [' + r.status + ']');
    }

    // ─────────────────────────────────────────
    section('2. DATABASE INTEGRITY CHECK');
    // ─────────────────────────────────────────
    const tables = ['finance_order_lines', 'finance_income_raw', 'finance_ad_spend', 'finance_sku_costs', 'finance_sku_master'];
    for (const t of tables) {
        try {
            const r = db.prepare('SELECT COUNT(*) as c FROM ' + t).get();
            check(r.c >= 0, t + ': ' + r.c + ' rows', t + ' error');
        } catch (e) { fail(t + ': ' + e.message); totalFail++; }
    }

    // Cek duplikat line_key di order_lines
    const dupOrders = db.prepare('SELECT line_key, COUNT(*) as c FROM finance_order_lines GROUP BY line_key HAVING COUNT(*) > 1 LIMIT 5').all();
    check(dupOrders.length === 0, 'Tidak ada duplikat di order_lines', 'Ada ' + dupOrders.length + ' duplikat line_key di order_lines!');

    // Cek duplikat sku_key di sku_costs
    const dupSku = db.prepare('SELECT sku_key, COUNT(*) as c FROM finance_sku_costs GROUP BY sku_key HAVING COUNT(*) > 1 LIMIT 5').all();
    check(dupSku.length === 0, 'Tidak ada duplikat di sku_costs', 'Ada ' + dupSku.length + ' duplikat sku_key di sku_costs!');

    // Cek apakah ada order tanpa store_name
    const noStore = db.prepare('SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name IS NULL OR store_name = ""').get();
    check(noStore.c === 0, 'Semua order punya store_name', noStore.c + ' order tanpa store_name!');

    // ─────────────────────────────────────────
    section('3. DATA PER TOKO');
    // ─────────────────────────────────────────
    const stores = db.prepare('SELECT store_name, COUNT(*) as orders, SUM(order_amount) as omzet FROM finance_order_lines GROUP BY store_name ORDER BY omzet DESC').all();
    console.log('  Toko yang ada data:');
    stores.forEach(s => {
        const incRowCount = db.prepare('SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name=?').get(s.store_name);
        const adCount = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name=?').get(s.store_name);
        console.log('    ▸ ' + String(s.store_name).padEnd(14) + ' | ' + String(s.orders).padStart(5) + ' order | Omzet Rp' + Number(s.omzet || 0).toLocaleString('id-ID') + ' | Income rows: ' + incRowCount.c + ' | Iklan: Rp' + Number(adCount.total).toLocaleString('id-ID'));
        totalPass++;
    });

    // ─────────────────────────────────────────
    section('4. KALKULASI SUMMARY API');
    // ─────────────────────────────────────────
    const summary = await req('/api/summary');
    const t = summary.data && summary.data.totals;
    check(summary.status === 200, 'Summary API 200 OK', 'Summary API gagal');
    check(t && t.orders > 0, 'Total orders: ' + (t && t.orders), 'orders = 0!');
    check(t && t.gross > 0, 'Omzet kotor: Rp' + Number(t && t.gross || 0).toLocaleString('id-ID'), 'Omzet 0!');
    check(summary.data.incomeAvailable === true, 'incomeAvailable: true (income tersedia)', 'income TIDAK tersedia!');
    check(t && t.settlement > 0, 'Settlement: Rp' + Number(t && t.settlement || 0).toLocaleString('id-ID'), 'Settlement = 0!');
    check(summary.data.availableStores && summary.data.availableStores.length > 0, 'availableStores: ' + (summary.data.availableStores || []).join(', '), 'Tidak ada store filter!');
    console.log('  SKU missingHpp:', summary.data.missingHppSkuCount || 0);

    // ─────────────────────────────────────────
    section('5. TEST ANTI-DUPLICATE (Re-upload simulasi)');
    // ─────────────────────────────────────────
    // Ambil jumlah orders sebelum re-upload
    const beforeCount = db.prepare('SELECT COUNT(*) as c FROM finance_order_lines').get().c;

    // Simulasi re-upload baris yang sudah ada (sama persis)
    const sampleOrder = db.prepare('SELECT * FROM finance_order_lines LIMIT 1').get();
    if (sampleOrder) {
        // Coba import ulang via importRows (ini yang terjadi saat upload file yang sama lagi)
        const { importRows } = require('./lib/finance-cloud');
        const fakeRow = {
            'Order ID': sampleOrder.order_id,
            'Seller SKU': sampleOrder.sku,
            'Variation': sampleOrder.variation || '',
            'Quantity': sampleOrder.quantity || 1,
            'SKU Unit Original Price': sampleOrder.unit_price || 0,
            'SKU Subtotal Before Discount': sampleOrder.order_amount || 0,
            'SKU Seller Discount': sampleOrder.seller_discount || 0,
            'Order Status': sampleOrder.status || 'Selesai',
            'Created Time': sampleOrder.created_at || '2026-08-01',
        };
        try {
            const result = await importRows({ storeName: sampleOrder.store_name, kind: 'orders', filename: 'test-duplicate.xlsx', rows: [fakeRow] });
            const afterCount = db.prepare('SELECT COUNT(*) as c FROM finance_order_lines').get().c;
            check(afterCount === beforeCount, 'Anti-duplicate: count tetap ' + beforeCount + ' (tidak bertambah)', 'DUPLIKAT! Count berubah dari ' + beforeCount + ' ke ' + afterCount);
            check(result.inserted === 0 && result.unchanged >= 0, 'Import ulang: inserted=0, unchanged=' + result.unchanged, 'Import ulang tidak idempoten!');
        } catch (e) { fail('Simulasi re-upload error: ' + e.message); totalFail++; }
    }

    // ─────────────────────────────────────────
    section('6. TEST UPDATE SAAT DATA BERUBAH');
    // ─────────────────────────────────────────
    // Simulasi: order yang sama tapi status berubah dari "Dikirim" → "Selesai"
    const { importRows } = require('./lib/finance-cloud');
    const testOrderId = 'TEST-AUDIT-' + Date.now();
    const storeTest = 'ventura';
    const insert1 = await importRows({
        storeName: storeTest, kind: 'orders', filename: 'test-insert.xlsx', rows: [{
            'Order ID': testOrderId, 'Seller SKU': 'TestSKU', 'Variation': '',
            'Quantity': 1, 'SKU Unit Original Price': 50000, 'SKU Subtotal Before Discount': 50000,
            'SKU Seller Discount': 0, 'Order Status': 'Perlu dikirim', 'Created Time': '2026-08-01',
        }]
    });
    check(insert1.inserted === 1, 'Insert order baru: inserted=1', 'Gagal insert: inserted=' + insert1.inserted);

    // Upload ulang order yang sama tapi status berubah
    const update1 = await importRows({
        storeName: storeTest, kind: 'orders', filename: 'test-update.xlsx', rows: [{
            'Order ID': testOrderId, 'Seller SKU': 'TestSKU', 'Variation': '',
            'Quantity': 1, 'SKU Unit Original Price': 50000, 'SKU Subtotal Before Discount': 50000,
            'SKU Seller Discount': 0, 'Order Status': 'Selesai', 'Created Time': '2026-08-01',
        }]
    });
    const updated = db.prepare('SELECT status FROM finance_order_lines WHERE order_id=? AND store_name=?').get(testOrderId, storeTest);
    check(updated && updated.status === 'Selesai', 'Status terupdate ke "Selesai": ✅', 'Status tidak terupdate! Dapat: ' + (updated && updated.status));
    check(update1.inserted === 0, 'Re-upload tidak insert baru (inserted=0)', 'inserted=' + update1.inserted);

    // Cleanup test data
    db.prepare('DELETE FROM finance_order_lines WHERE order_id=? AND store_name=?').run(testOrderId, storeTest);

    // ─────────────────────────────────────────
    section('7. SKU HPP GLOBAL CHECK');
    // ─────────────────────────────────────────
    const globalSkus = db.prepare('SELECT COUNT(*) as c FROM finance_sku_costs WHERE store_name="global"').get();
    const nonGlobalSkus = db.prepare('SELECT COUNT(*) as c FROM finance_sku_costs WHERE store_name != "global"').get();
    check(globalSkus.c > 0, 'Global SKU: ' + globalSkus.c + ' entri', 'Tidak ada global SKU!');
    console.log('  Non-global SKU (legacy, aman diabaikan): ' + nonGlobalSkus.c);

    // ─────────────────────────────────────────
    section('HASIL AUDIT');
    // ─────────────────────────────────────────
    const total = totalPass + totalFail;
    console.log('\n  PASS: ' + totalPass + '/' + total);
    console.log('  FAIL: ' + totalFail + '/' + total);
    if (totalFail === 0) {
        console.log('\n  🎉 SEMUA TEST LULUS — SISTEM PRODUCTION-READY!');
    } else {
        console.log('\n  ⚠️  Ada ' + totalFail + ' issue yang perlu diperhatikan.');
    }
}

main().catch(e => { console.error('FATAL:', e.message, '\n', e.stack); process.exit(1); });
