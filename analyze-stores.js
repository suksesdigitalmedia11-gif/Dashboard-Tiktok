/**
 * Analisa detail: giftyours, cetakin, piksera, memora
 * Cek apakah rugi karena: biaya iklan terlalu besar, HPP tidak ada, atau data tidak lengkap
 */
const http = require('http');
const db = require('./lib/pg-connector').getDb();

function f(n) { return 'Rp' + Number(n || 0).toLocaleString('id'); }
function get(path) {
    return new Promise(r => {
        http.get('http://localhost:9876' + path, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({}); } });
        }).on('error', e => r({ error: e.message }));
    });
}

async function analyzeStore(store) {
    console.log('\n' + '='.repeat(60));
    console.log('ANALISA: ' + store.toUpperCase());
    console.log('='.repeat(60));

    // DB raw
    const ord = db.prepare("SELECT status, COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name=? GROUP BY status ORDER BY c DESC").all(store);
    const inc = db.prepare("SELECT transaction_type, COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name=? GROUP BY transaction_type ORDER BY c DESC").all(store);
    const ads = db.prepare("SELECT channel, COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name=? GROUP BY channel ORDER BY c DESC").all(store);

    console.log('\n[ORDERS by Status]:');
    ord.forEach(r => console.log('  ' + r.status.padEnd(20) + ': ' + r.c + ' | Omzet: ' + f(r.omzet) + ' | Disc: ' + f(r.disc)));

    console.log('\n[INCOME by Type]:');
    if (inc.length === 0) console.log('  TIDAK ADA DATA income_raw!');
    inc.forEach(r => console.log('  ' + String(r.transaction_type).substring(0, 40).padEnd(40) + ': ' + r.c + ' | ' + f(r.total)));

    console.log('\n[ADS by Channel]:');
    if (ads.length === 0) console.log('  TIDAK ADA DATA ads!');
    ads.forEach(r => console.log('  ' + String(r.channel || '').padEnd(30) + ': ' + r.c + ' | ' + f(r.total)));

    // API - semua bulan
    const s = await get('/api/summary?store=' + store + '&preset=all');
    const t = s.totals || {};
    console.log('\n[API Summary ALL]:');
    console.log('  orders: ' + (t.finalOrders || t.orders) + ' | gross: ' + f(t.gross) + ' | sellerDisc: ' + f(t.sellerDiscount));
    console.log('  net: ' + f(t.net) + ' | settlement: ' + f(t.settlement));
    console.log('  hpp: ' + f(t.hpp) + ' | packing: ' + f(t.packing));
    console.log('  ads: ' + f(t.ads) + ' | adTop: ' + f(t.adSpendTopup) + ' | adSettle: ' + f(t.adSpendSettlement));
    console.log('  profit: ' + f(t.profit) + ' | margin: ' + (t.margin ? t.margin.toFixed(1) + '%' : 'N/A'));
    console.log('  missingHppSkuCount: ' + (s.missingHppSkuCount || 0));

    // Diagnosis
    const hasMissingHpp = s.missingHppSkuCount > 0;
    const grossBase = t.gross || 0;
    const netBase = t.net || 0;
    const adRate = netBase ? (t.ads || 0) / netBase * 100 : 0;
    const hppRate = netBase ? ((t.hpp || 0) + (t.packing || 0)) / netBase * 100 : 0;
    console.log('\n[DIAGNOSIS]:');
    console.log('  Ratio Iklan/Net: ' + adRate.toFixed(1) + '%' + (adRate > 30 ? ' ← TINGGI!' : ''));
    console.log('  Ratio HPP+Packing/Net: ' + hppRate.toFixed(1) + '%');
    console.log('  Missing HPP SKU: ' + (s.missingHppSkuCount || 0) + (hasMissingHpp ? ' ← ADA SKU TANPA HPP' : ''));
    if (!inc.length) console.log('  TIDAK ADA income data → settlement tidak terhitung');
    if (!ads.length) console.log('  TIDAK ADA ads → biaya iklan tidak terhitung (profit potensial lebih tinggi)');

    return { store, margin: t.margin || 0, profit: t.profit || 0, net: t.net || 0, hasIncome: inc.length > 0, hasAds: ads.length > 0, missingHpp: s.missingHppSkuCount || 0 };
}

async function main() {
    const results = [];
    for (const store of ['giftyours', 'cetakin', 'piksera', 'memora', 'ventura']) {
        const r = await analyzeStore(store);
        results.push(r);
    }

    console.log('\n' + '='.repeat(60));
    console.log('RINGKASAN DIAGNOSIS SEMUA STORE');
    console.log('='.repeat(60));
    console.log('\nSTORE        | MARGIN | PROFIT         | INCOME? | ADS? | MISSING HPP | TINDAKAN');
    console.log(''.padEnd(90, '-'));
    results.forEach(r => {
        const action = !r.hasIncome ? 'Upload income/settlement!' :
            r.missingHpp > 0 ? 'Set HPP untuk ' + r.missingHpp + ' SKU!' :
                r.margin < 0 ? 'Cek biaya iklan vs omzet' :
                    r.margin < 10 ? 'Margin tipis, pantau' : 'OK ✅';
        console.log(
            r.store.padEnd(12) + ' | ' +
            (r.margin ? r.margin.toFixed(1) + '%' : 'N/A').padStart(6) + ' | ' +
            f(r.profit).padStart(14) + ' | ' +
            (r.hasIncome ? 'YA ' : 'TIDAK').padEnd(7) + ' | ' +
            (r.hasAds ? 'YA ' : 'TIDAK').padEnd(4) + ' | ' +
            String(r.missingHpp).padStart(11) + ' | ' +
            action
        );
    });
}

main().catch(e => console.error('FATAL:', e.message, e.stack));
