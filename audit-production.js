// AUDIT PRODUKSI — jalankan dari root: node audit-production.js
const { getDb } = require('./lib/pg-connector');
const db = getDb();
const http = require('http');

function req(path) {
    return new Promise(resolve => {
        http.get('http://localhost:9876' + path, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
                catch (e) { resolve({ status: res.statusCode }); }
            });
        }).on('error', e => resolve({ status: 0, error: e.message }));
    });
}

let pass = 0, fail = 0;
function ok(msg) { console.log('  OK', msg); pass++; }
function ng(msg) { console.log('  XX', msg); fail++; }
function sec(msg) { console.log('\n=== ' + msg + ' ==='); }

async function main() {
    console.log('\nAUDIT PRODUKSI DASHBOARD KEUANGAN TIKTOK');
    console.log('Waktu: ' + new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }));

    // 1. API ENDPOINTS
    sec('1. API ENDPOINTS');
    for (const path of ['/', '/api/summary', '/api/skus', '/api/split-data']) {
        const r = await req(path);
        r.status === 200 ? ok(path + ' [200]') : ng(path + ' [' + r.status + ']');
    }

    // 2. TABEL DATABASE
    sec('2. DATABASE TABLES');
    for (const t of ['finance_order_lines', 'finance_income_raw', 'finance_ad_spend', 'finance_sku_costs', 'finance_sku_master']) {
        const r = db.prepare('SELECT COUNT(*) as c FROM ' + t).get();
        ok(t + ': ' + r.c + ' rows');
    }

    // 3. DUPLIKAT
    sec('3. CECK DUPLIKAT');
    const dupO = db.prepare('SELECT COUNT(*) as c FROM (SELECT line_key,COUNT(*) cnt FROM finance_order_lines GROUP BY line_key HAVING cnt>1)').get();
    dupO.c === 0 ? ok('Tidak ada duplikat order_lines') : ng('Ada ' + dupO.c + ' duplikat line_key!');
    const dupS = db.prepare('SELECT COUNT(*) as c FROM (SELECT sku_key,COUNT(*) cnt FROM finance_sku_costs GROUP BY sku_key HAVING cnt>1)').get();
    dupS.c === 0 ? ok('Tidak ada duplikat sku_costs') : ng('Ada ' + dupS.c + ' duplikat sku_key!');
    const noSt = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name IS NULL OR store_name=?").get('');
    noSt.c === 0 ? ok('Semua order punya store_name') : ng(noSt.c + ' order tanpa store_name!');

    // 4. DATA PER TOKO
    sec('4. DATA PER TOKO (REAL)');
    const stores = db.prepare('SELECT store_name,COUNT(*) as o,COALESCE(SUM(order_amount),0) as omzet,COALESCE(SUM(settlement_received),0) as sr FROM finance_order_lines GROUP BY store_name ORDER BY omzet DESC').all();
    for (const s of stores) {
        const inc = db.prepare('SELECT COUNT(*) as c,COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name=?').get(s.store_name);
        const ads = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name=?').get(s.store_name);
        ok(String(s.store_name).padEnd(12) + ' | ' + String(s.o).padStart(5) + ' order | Omzet Rp' + Number(s.omzet).toLocaleString('id') + ' | SettlementDB Rp' + Number(s.sr).toLocaleString('id') + ' | Income ' + inc.c + ' rows Rp' + Number(inc.total).toLocaleString('id') + ' | Iklan Rp' + Number(ads.total).toLocaleString('id'));
    }
    const skuG = db.prepare('SELECT COUNT(*) as c FROM finance_sku_costs WHERE store_name=? AND hpp_per_unit>0').get('global');
    ok('HPP Global SKU (hpp>0): ' + skuG.c + ' SKU');

    // 5. KALKULASI SUMMARY API
    sec('5. KALKULASI SUMMARY API');
    const sum = await req('/api/summary');
    const t = (sum.data && sum.data.totals) || {};
    t.orders > 0 ? ok('Total orders: ' + t.orders) : ng('orders=0!');
    t.gross > 0 ? ok('Omzet kotor: Rp' + Number(t.gross).toLocaleString('id')) : ng('Omzet gross=0!');
    sum.data && sum.data.incomeAvailable === true ? ok('incomeAvailable: TRUE') : ng('incomeAvailable FALSE — settlement tidak tersedia!');
    t.settlement > 0 ? ok('Settlement cair: Rp' + Number(t.settlement).toLocaleString('id')) : ng('Settlement=0!');
    const misHpp = (sum.data && sum.data.missingHppSkuCount) || 0;
    misHpp === 0 ? ok('Semua SKU ada HPP') : console.log('  WARN: ' + misHpp + ' SKU belum HPP (isi di tab SKU)');
    const avS = (sum.data && sum.data.availableStores) || [];
    avS.length > 0 ? ok('Store filters: ' + avS.join(', ')) : ng('Tidak ada store filter!');

    // 6. ANTI-DUPLICATE RE-UPLOAD
    sec('6. ANTI-DUPLICATE SIMULASI');
    const { importRows } = require('./lib/finance-cloud');
    const beforeCnt = db.prepare('SELECT COUNT(*) as c FROM finance_order_lines').get().c;
    const sampleRow = db.prepare('SELECT * FROM finance_order_lines LIMIT 1').get();
    if (sampleRow) {
        const r2 = await importRows({
            storeName: sampleRow.store_name, kind: 'orders',
            filename: 're-upload-test.xlsx',
            rows: [{
                'Order ID': sampleRow.order_id, 'Seller SKU': sampleRow.sku,
                'Variation': sampleRow.variation || '', 'Quantity': sampleRow.quantity || 1,
                'SKU Unit Original Price': sampleRow.unit_price || 0,
                'SKU Subtotal Before Discount': sampleRow.order_amount || 0,
                'SKU Seller Discount': sampleRow.seller_discount || 0,
                'Order Status': sampleRow.status || 'Selesai', 'Created Time': sampleRow.created_at || '2026-08-01',
            }]
        });
        const afterCnt = db.prepare('SELECT COUNT(*) as c FROM finance_order_lines').get().c;
        afterCnt === beforeCnt ? ok('Anti-duplicate: count tetap ' + beforeCnt + ' setelah re-upload') : ng('DUPLIKAT! ' + beforeCnt + '->' + afterCnt);
        r2.inserted === 0 ? ok('inserted=0 (tidak ada data ganda), unchanged/updated=' + ((r2.unchanged || 0) + (r2.updated || 0))) : ng('inserted=' + r2.inserted + ' (duplikat masuk!)');
    }

    // 7. UPDATE SAAT STATUS BERUBAH (juli → agustus scenario)
    sec('7. UPDATE OTOMATIS (Scenario bulan baru)');
    const tid = 'AUDIT-UPSERT-' + Date.now();
    const r3 = await importRows({
        storeName: 'ventura', kind: 'orders', filename: 'test-juli.xlsx',
        rows: [{ 'Order ID': tid, 'Seller SKU': 'TestAudit', 'Variation': '', 'Quantity': 1, 'SKU Unit Original Price': 99000, 'SKU Subtotal Before Discount': 99000, 'SKU Seller Discount': 0, 'Order Status': 'Perlu dikirim', 'Created Time': '2026-07-01' }]
    });
    r3.inserted >= 1 ? ok('Insert order Juli baru: inserted=' + r3.inserted) : ng('Gagal insert: ' + JSON.stringify(r3));

    const r4 = await importRows({
        storeName: 'ventura', kind: 'orders', filename: 'test-agustus.xlsx',
        rows: [{ 'Order ID': tid, 'Seller SKU': 'TestAudit', 'Variation': '', 'Quantity': 1, 'SKU Unit Original Price': 99000, 'SKU Subtotal Before Discount': 99000, 'SKU Seller Discount': 0, 'Order Status': 'Selesai', 'Created Time': '2026-07-01' }]
    });
    const upd = db.prepare("SELECT status FROM finance_order_lines WHERE order_id=? AND sku=?").get(tid, 'TestAudit');
    upd && upd.status === 'Selesai' ? ok('Status diupdate Perlu dikirim -> Selesai: BERHASIL') : ng('Status tidak update: dapat ' + JSON.stringify(upd));
    r4.inserted === 0 ? ok('Upload Agustus tidak buat duplikat (inserted=0)') : ng('Ada duplikat inserted=' + r4.inserted);
    db.prepare('DELETE FROM finance_order_lines WHERE order_id=?').run(tid);
    ok('Test data dibersihkan');

    // HASIL
    console.log('\n' + '='.repeat(50));
    console.log('  PASS: ' + pass + ' | FAIL: ' + fail);
    console.log(fail === 0 ? '  PRODUCTION READY — SEMUA TEST LULUS!' : '  ADA ' + fail + ' ISSUE!');
    console.log('='.repeat(50) + '\n');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
