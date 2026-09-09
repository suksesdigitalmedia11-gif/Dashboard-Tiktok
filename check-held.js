const http = require('http');
function get(p) {
    return new Promise(r => {
        http.get('http://localhost:9876' + p, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (_) { r({}); } });
        }).on('error', () => r({}));
    });
}
function rp(n) { return 'Rp' + Math.round(n || 0).toLocaleString('id'); }

async function main() {
    const [all, jul, aug] = await Promise.all([
        get('/api/summary?store=all&preset=all'),
        get('/api/summary?store=all&preset=month&month=2026-07'),
        get('/api/summary?store=all&preset=month&month=2026-08'),
    ]);

    function show(label, s) {
        const t = s.totals || {};
        console.log(`\n=== ${label} ===`);
        console.log('Net omzet    :', rp(t.net));
        console.log('Platform fee :', rp(t.platformFee));
        console.log('Settlement   :', rp(t.settlement));
        console.log('Dana Tertahan:', rp(t.held));
        console.log('  (formula)  : Net', rp(t.net), '- PlatFee', rp(t.platformFee), '- Settlement', rp(t.settlement));
        console.log('pendingOrders:', t.pendingSettlementOrders, '| pendingOmzet:', rp(t.pendingSettlementOmzet));
        console.log('Orders Selesai:', t.finalOrders, '| Dikirim:', t.estimatedOrders);
    }

    show('FILTER ALL', all);
    show('FILTER JULI 2026', jul);
    show('FILTER AGUSTUS 2026', aug);

    // Cross check: Juli held + Agustus held
    const julHeld = (jul.totals || {}).held || 0;
    const augHeld = (aug.totals || {}).held || 0;
    const allHeld = (all.totals || {}).held || 0;
    console.log('\n=== CROSS CHECK ===');
    console.log('Juli held  :', rp(julHeld));
    console.log('Agustus held:', rp(augHeld));
    console.log('Juli + Agustus:', rp(julHeld + augHeld), '(naif sum)');
    console.log('ALL held   :', rp(allHeld));
    console.log('Selisih ALL vs naif sum:', rp(allHeld - julHeld - augHeld));
}
main().catch(e => console.error(e.message));
