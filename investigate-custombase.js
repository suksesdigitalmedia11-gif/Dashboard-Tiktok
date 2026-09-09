const db = require('./lib/pg-connector').getDb();
const http = require('http');

async function get(path) {
    return new Promise(r => {
        http.get('http://localhost:9876' + path, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({}); } });
        }).on('error', e => r({ error: e.message }));
    });
}

function f(n) { return 'Rp' + Number(n || 0).toLocaleString('id'); }

async function main() {
    // Schema
    const schAd = db.prepare('PRAGMA table_info(finance_ad_spend)').all();
    const schInc = db.prepare('PRAGMA table_info(finance_income_raw)').all();
    const schOrd = db.prepare('PRAGMA table_info(finance_order_lines)').all();
    console.log('\nAD_SPEND columns:', schAd.map(c => c.name).join(', '));
    console.log('INCOME_RAW columns:', schInc.map(c => c.name).join(', '));
    console.log('ORDER_LINES columns:', schOrd.map(c => c.name).join(', '));

    // Ad_spend
    const adSamp = db.prepare('SELECT * FROM finance_ad_spend WHERE store_name=? LIMIT 3').all('custombase');
    console.log('\nAD_SPEND sample:', JSON.stringify(adSamp));
    const adTotal = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name=?').get('custombase');
    console.log('AD total:', adTotal);

    // Income
    const incSamp = db.prepare('SELECT order_id, transaction_type, settlement_amount, order_created_time FROM finance_income_raw WHERE store_name=? LIMIT 3').all('custombase');
    console.log('\nINCOME_RAW sample:', JSON.stringify(incSamp));
    const incTypes = db.prepare('SELECT transaction_type, COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name=? GROUP BY transaction_type ORDER BY c DESC').all('custombase');
    console.log('INCOME by type:');
    incTypes.forEach(r => console.log('  ', r.transaction_type, ':', r.c, 'rows |', f(r.total)));
    const incJuli = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name=? AND order_created_time LIKE '2026-07%'").get('custombase');
    console.log('INCOME Juli (order_created_time LIKE 2026-07%):', incJuli);

    // Orders periode
    const ordAll = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet FROM finance_order_lines WHERE store_name=?').get('custombase');
    const ordJuli = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name=? AND created_at LIKE '2026-07%'").get('custombase');
    const ordStatJuli = db.prepare("SELECT status, COUNT(*) as c FROM finance_order_lines WHERE store_name=? AND created_at LIKE '2026-07%' GROUP BY status ORDER BY c DESC").all('custombase');
    console.log('\nORDERS ALL:', ordAll.c, '| Omzet:', f(ordAll.omzet));
    console.log('ORDERS JULI:', ordJuli.c, '| Omzet:', f(ordJuli.omzet), '| Disc:', f(ordJuli.disc));
    console.log('Status Juli:');
    ordStatJuli.forEach(r => console.log('  "' + r.status + '":', r.c));

    // API calls - all periods + Juli bulan
    const paths = [
        '/api/summary?store=custombase&preset=all',
        '/api/summary?store=custombase&preset=month&month=2026-07',
    ];
    for (const p of paths) {
        const s = await get(p);
        const t = s.totals || {};
        console.log('\nAPI:', p);
        console.log('  orders:', t.finalOrders || t.orders, '| gross:', f(t.gross), '| net:', f(t.net));
        console.log('  settlement:', f(t.settlement), '| ads:', f(t.ads), '| hpp:', f(t.hpp), '| packing:', f(t.packing));
        console.log('  profit:', f(t.profit), '| incomeAvailable:', s.incomeAvailable);
        // Find ads-related keys
        const adsKeys = Object.keys(t).filter(k => k.toLowerCase().includes('ad') || k.toLowerCase().includes('iklan'));
        if (adsKeys.length) console.log('  ADS KEYS:', adsKeys.map(k => k + '=' + f(t[k])).join(', '));
    }

    // Final cross-check tabel — GROUND TRUTH vs DB vs DASHBOARD
    console.log('\n=== LAPORAN VALIDASI AKHIR ===');
    const SUMBER_FILE = {
        orders_selesai: 6545,
        omzet_kotor: 205461900,
        diskon_seller: 87754361,
        omzet_net: 117707539,
        settlement_laporan_resmi: 67360515,
        biaya_iklan_file: 19820474,
    };
    const DASHBOARD_ACCRUAL = {
        orders: 6527,
        gross: 204945900, disc: 87547859, net: 117398041,
        settlement: 86247247, ads: 18416187,
        hpp: 24009900, packing: 16936000, profit: 26925860,
    };
    const DASHBOARD_SETTLEMENT = {
        orders: 6504, gross: 203888200, disc: 87081624, net: 116806576,
        settlement: 86247247, ads: 18416187,
        hpp: 23917700, packing: 16818000, profit: 27136060,
    };

    console.log('\n+-------------------------+------------------+------------------+------------------+');
    console.log('| Metrik                  | File/TikTok      | Dashboard (Accr) | Selisih Accr     |');
    console.log('+-------------------------+------------------+------------------+------------------+');
    function row(name, file, dash) {
        const s = file - dash;
        const s2 = s >= 0 ? '+' + s.toLocaleString('id') : s.toLocaleString('id');
        console.log('| ' + String(name).padEnd(23) + ' | ' + String(file.toLocaleString('id')).padStart(16) + ' | ' + String(dash.toLocaleString('id')).padStart(16) + ' | ' + String(s2).padStart(16) + ' |');
    }
    row('Orders Selesai', SUMBER_FILE.orders_selesai, DASHBOARD_ACCRUAL.orders);
    row('Omzet Kotor', SUMBER_FILE.omzet_kotor, DASHBOARD_ACCRUAL.gross);
    row('Diskon Seller', SUMBER_FILE.diskon_seller, DASHBOARD_ACCRUAL.disc);
    row('Settlement (TikTok)', SUMBER_FILE.settlement_laporan_resmi, DASHBOARD_ACCRUAL.settlement);
    row('Biaya Iklan', SUMBER_FILE.biaya_iklan_file, DASHBOARD_ACCRUAL.ads);
    console.log('+-------------------------+------------------+------------------+------------------+\n');
}

main().catch(e => console.error('FATAL:', e.message, e.stack));
