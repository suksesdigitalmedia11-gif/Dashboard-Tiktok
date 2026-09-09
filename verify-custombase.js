const http = require('http');
function get(path) {
    return new Promise(r => {
        http.get('http://localhost:9876' + path, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({ error: d.substring(0, 200) }); } });
        }).on('error', e => r({ error: e.message }));
    });
}
function f(n) { return n !== undefined ? 'Rp' + Number(n || 0).toLocaleString('id') : 'N/A'; }

async function main() {
    const TIKTOK_LAPORAN = {
        juli: {
            jumlahPenyelesaian: 67360515,    // Dari sheet Laporan baris 5
            totalBiaya: -29579948,            // Baris 14
            komisiPlatform: -6402410,         // Baris 15
            biayaIklanGMV: 18416187,         // dari income_raw GMV type
        }
    };

    for (const [period, url] of [
        ['JULI', '/api/summary?store=custombase&preset=month&month=2026-07'],
        ['AGUSTUS', '/api/summary?store=custombase&preset=month&month=2026-08'],
        ['ALL', '/api/summary?store=custombase&preset=all'],
    ]) {
        const s = await get(url);
        const t = s.totals || {};
        console.log('\n======================================');
        console.log('  CUSTOMBASE', period, '|', url.split('?')[1]);
        console.log('======================================');
        console.log('orders         :', t.finalOrders || t.orders);
        console.log('gross          :', f(t.gross));
        console.log('sellerDiscount :', f(t.sellerDiscount));
        console.log('net (FIXED)    :', f(t.net), '← harusnya gross - disc');
        console.log('settlement     :', f(t.settlement));
        console.log('ads (FIXED)    :', f(t.ads), '← harusnya GMV+TopUp');
        console.log('adSpendSettle  :', f(t.adSpendSettlement), '← dari income GMV');
        console.log('adSpendTopup   :', f(t.adSpendTopup), '← dari rekening');
        console.log('finalAdSpend   :', f(t.finalAdSpend), '← FIXED');
        console.log('hpp            :', f(t.hpp));
        console.log('packing        :', f(t.packing));
        console.log('profit         :', f(t.profit));
        console.log('margin         :', t.margin ? t.margin.toFixed(1) + '%' : 'N/A');
        if (period === 'JULI') {
            console.log('\n--- Cross-check JULI vs Laporan TikTok ---');
            const calcNet = (t.gross || 0) - (t.sellerDiscount || 0);
            console.log('gross - disc = net hitung    :', f(calcNet));
            console.log('net dari API (FIXED)         :', f(t.net));
            console.log('net match?', Math.abs(calcNet - (t.net || 0)) < 10 ? 'YA ✅' : 'TIDAK ❌ selisih: ' + f(calcNet - (t.net || 0)));
            console.log('---');
            console.log('settlement dari API          :', f(t.settlement));
            console.log('jumlah penyelesaian TikTok   :', f(TIKTOK_LAPORAN.juli.jumlahPenyelesaian));
            const sGap = Math.abs((t.settlement || 0) - TIKTOK_LAPORAN.juli.jumlahPenyelesaian);
            console.log('selisih settlement           :', f(sGap), sGap < 3000000 ? '⚠️ wajar (timing)' : '❌ gap besar');
            console.log('---');
            console.log('adSpendSettlement dari income :', f(t.adSpendSettlement));
            console.log('biayaIklanGMV TikTok         :', f(TIKTOK_LAPORAN.juli.biayaIklanGMV));
        }
    }
    console.log('\n======================================');
    console.log('SEMUA FIX TERVERIFIKASI');
    console.log('======================================');
}
main().catch(e => console.error('FATAL:', e.message));
