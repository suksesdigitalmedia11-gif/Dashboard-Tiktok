/**
 * Verifikasi semua store: DB state + API summary (last7 dan semua bulan tersedia)
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

async function main() {
    // 1. DB state semua store
    console.log('=== DB STATE SEMUA STORE ===\n');
    const stores = db.prepare("SELECT store_name, COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet FROM finance_order_lines GROUP BY store_name ORDER BY c DESC").all();
    const incStores = db.prepare("SELECT store_name, COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw GROUP BY store_name ORDER BY c DESC").all();
    const adStores = db.prepare("SELECT store_name, COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend GROUP BY store_name ORDER BY c DESC").all();

    console.log('STORE            | ORDERS | OMZET            | INCOME ROWS | SETTLEMENT       | ADS ROWS | ADS TOTAL');
    console.log(''.padEnd(100, '-'));
    for (const s of stores) {
        const inc = incStores.find(i => i.store_name === s.store_name) || { c: 0, total: 0 };
        const ads = adStores.find(a => a.store_name === s.store_name) || { c: 0, total: 0 };
        console.log(
            String(s.store_name).padEnd(16) + ' | ' +
            String(s.c).padStart(6) + ' | ' +
            String(f(s.omzet)).padStart(16) + ' | ' +
            String(inc.c).padStart(11) + ' | ' +
            String(f(inc.total)).padStart(16) + ' | ' +
            String(ads.c).padStart(8) + ' | ' +
            f(ads.total)
        );
    }

    // 2. Bulan tersedia per store
    console.log('\n=== AVAILABLE MONTHS PER STORE ===');
    for (const s of stores) {
        const months = db.prepare("SELECT DISTINCT substr(created_at,1,7) as m, COUNT(*) as c FROM finance_order_lines WHERE store_name=? GROUP BY m ORDER BY m").all(s.store_name);
        const selesai = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name=? AND status='Selesai'").get(s.store_name);
        console.log(s.store_name + ': [' + months.map(m => m.m + '(' + m.c + ')').join(', ') + '] | Selesai: ' + selesai.c);
    }

    // 3. API summary untuk semua store - preset=all (pakai semua data)
    console.log('\n=== API SUMMARY ALL STORES (all months) ===\n');
    const storeNames = stores.map(s => s.store_name);
    for (const store of storeNames) {
        const s = await get('/api/summary?store=' + store + '&preset=all');
        const t = s.totals || {};
        const netCheck = t.gross && t.sellerDiscount ? Math.abs(t.net - (t.gross - t.sellerDiscount)) < 100 : null;
        const marginCheck = t.net && t.profit !== undefined ? Math.abs(t.margin - (t.profit / t.net * 100)) < 0.5 : null;
        console.log(store.padEnd(12) + ' | orders:' + String(t.finalOrders || t.orders || 0).padStart(6) +
            ' | gross:' + String(f(t.gross)).padStart(14) + ' | NET:' + String(f(t.net)).padStart(14) +
            ' | profit:' + String(f(t.profit)).padStart(14) + ' | margin:' + (t.margin ? t.margin.toFixed(1) + '%' : 'N/A').padStart(7) +
            ' | ads:' + String(f(t.ads)).padStart(12) +
            ' | net✅:' + (netCheck === null ? 'N/A' : netCheck ? 'OK' : 'FAIL') +
            ' | margin✅:' + (marginCheck === null ? 'N/A' : marginCheck ? 'OK' : 'FAIL'));
    }

    // 4. Quick profit check per bulan untuk custombase
    console.log('\n=== CUSTOMBASE BREAKDOWN PER BULAN ===');
    for (const month of ['2026-07', '2026-08']) {
        const s = await get('/api/summary?store=custombase&preset=month&month=' + month);
        const t = s.totals || {};
        console.log(month + ': orders=' + (t.finalOrders || t.orders) + ' | gross=' + f(t.gross) + ' | NET=' + f(t.net) + ' | profit=' + f(t.profit) + ' | margin=' + (t.margin ? t.margin.toFixed(1) + '%' : 'N/A') + ' | ads=' + f(t.ads));
    }
}

main().catch(e => console.error('FATAL:', e.message, e.stack));
