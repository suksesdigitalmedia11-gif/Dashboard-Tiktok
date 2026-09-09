const http = require('http');
const get = p => new Promise(r => {
    http.get('http://localhost:9876' + p, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { r(JSON.parse(d)); } catch { r({}); } });
    }).on('error', () => r({}));
});
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

async function compare(store, month) {
    const [acc, sett] = await Promise.all([
        get(`/api/summary?store=${store}&preset=month&month=${month}&mode=accrual`),
        get(`/api/summary?store=${store}&preset=month&month=${month}&mode=settlement`),
    ]);
    const ta = acc.totals || {}, ts = sett.totals || {};
    console.log(`\n====== ${store.toUpperCase()} - ${month} ======`);
    const fields = [
        ['omzet (Kotor)', 'gross'],
        ['diskon seller', 'sellerDiscount'],
        ['omzet (Net)', 'net'],
        ['settlement cair', 'settlement'],
        ['dana tertahan', 'pendingSettlementOmzet'],
        ['platform fee', 'platformFee'],
        ['hpp', 'hpp'],
        ['packing', 'packing'],
        ['profit marketplace', 'profit'],
        ['orders (total)', 'orders'],
        ['orders (selesai)', 'finalOrders'],
    ];
    console.log(('CARD').padEnd(25), 'ACCRUAL'.padEnd(20), 'SETTLEMENT'.padEnd(20), 'SAMA?');
    for (const [label, key] of fields) {
        const a = Math.round(Number(ta[key] instanceof Set ? ta[key].size : (ta[key] || 0)));
        const s = Math.round(Number(ts[key] instanceof Set ? ts[key].size : (ts[key] || 0)));
        const sama = Math.abs(a - s) < 100 ? '✅' : '⚠️ BEDA';
        const aStr = key === 'orders' || key === 'finalOrders' ? String(a) : rp(a);
        const sStr = key === 'orders' || key === 'finalOrders' ? String(s) : rp(s);
        console.log(label.padEnd(25), aStr.padEnd(20), sStr.padEnd(20), sama);
    }
}

async function main() {
    await compare('custombase', '2026-07');
    await compare('custombase', '2026-08');
}
main().catch(e => console.error(e.message));
