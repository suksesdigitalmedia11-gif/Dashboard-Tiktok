// Analisa mendalam DB + Laporan sheet penarikan dana custombase
const XLSX = require('xlsx');
const { getDb } = require('./lib/pg-connector');
const http = require('http');
const db = getDb();

async function main() {

    // 1. Parse Laporan sheet dari penarikan dana
    const pdFile = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok\\custombase\\penarikan dana juli custombase.xlsx';
    const pdWb = XLSX.readFile(pdFile, { cellDates: true, raw: false });
    const lapRows = XLSX.utils.sheet_to_json(pdWb.Sheets['Laporan'], { defval: '', header: 1 });
    console.log('=== SHEET LAPORAN (ringkasan TikTok resmi) ===');
    lapRows.slice(0, 35).forEach((r, i) => {
        const vals = r.filter(v => String(v).trim()).map(v => String(v).substring(0, 50)).join(' | ');
        if (vals.trim()) console.log('  Baris ' + (i + 1) + ': ' + vals);
    });

    // 2. Parse Detail pesanan
    console.log('\n=== DETAIL PESANAN - Breakdown Jenis Transaksi ===');
    const detailRows = XLSX.utils.sheet_to_json(pdWb.Sheets['Detail pesanan'], { defval: '' });
    console.log('Total rows:', detailRows.length);
    const settlementByType = {};
    let totalJP = 0, totalPesanan = 0, totalAdsGMV = 0;
    for (const r of detailRows) {
        const txType = r['Jenis transaksi'] || 'UNKNOWN';
        const amt = parseFloat(String(r['Jumlah penyelesaian pembayaran'] || 0).replace(',', '.')) || 0;
        settlementByType[txType] = (settlementByType[txType] || 0) + 1;
        totalJP += amt;
        if (txType === 'Pesanan') totalPesanan += amt;
        if (String(txType).includes('GMV') || String(txType).includes('Iklan')) totalAdsGMV += amt;
    }
    Object.entries(settlementByType).forEach(([t, c]) => console.log('  "' + t + '":', c, 'rows'));
    console.log('Total Jumlah Penyelesaian (semua):', totalJP.toLocaleString('id'));
    console.log('Total Pesanan saja:', totalPesanan.toLocaleString('id'));
    console.log('Total GMV/Ads settlement:', totalAdsGMV.toLocaleString('id'));

    // 3. DB State
    console.log('\n=== DB STATE custombase ===');
    const dbAll = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name='custombase'").get();
    const dbJuli = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc, COALESCE(SUM(settlement_received),0) as sr FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%'").get();
    const dbInc = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name='custombase'").get();
    const dbAds = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase'").get();
    const dbSt = db.prepare("SELECT status, COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' GROUP BY status ORDER BY c DESC").all();

    console.log('ORDER LINES ALL:', dbAll.c, 'rows | Omzet:', Number(dbAll.omzet).toLocaleString('id'));
    console.log('ORDER LINES JULI (2026-07%):', dbJuli.c, 'rows | Omzet:', Number(dbJuli.omzet).toLocaleString('id'), '| Disc:', Number(dbJuli.disc).toLocaleString('id'), '| SR:', Number(dbJuli.sr).toLocaleString('id'));
    console.log('INCOME RAW:', dbInc.c, 'rows | Settlement:', Number(dbInc.total).toLocaleString('id'));
    console.log('AD SPEND:', dbAds.c, 'rows | Total:', Number(dbAds.total).toLocaleString('id'));
    console.log('Status breakdown:');
    dbSt.forEach(r => console.log('  "' + r.status + '":', r.c));

    // 4. API summary Juli
    console.log('\n=== API /api/summary?store=custombase&preset=month&month=2026-07 ===');
    await new Promise(resolve => {
        http.get('http://localhost:9876/api/summary?store=custombase&preset=month&month=2026-07', res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const s = JSON.parse(d);
                    const t = s.totals || {};
                    console.log('  orders:', t.finalOrders || t.orders);
                    console.log('  gross: Rp' + Number(t.gross || 0).toLocaleString('id'));
                    console.log('  sellerDiscount: Rp' + Number(t.sellerDiscount || 0).toLocaleString('id'));
                    console.log('  net: Rp' + Number(t.net || 0).toLocaleString('id'));
                    console.log('  settlement: Rp' + Number(t.settlement || 0).toLocaleString('id'));
                    console.log('  ads: Rp' + Number(t.ads || 0).toLocaleString('id'));
                    console.log('  hpp: Rp' + Number(t.hpp || 0).toLocaleString('id'));
                    console.log('  packing: Rp' + Number(t.packing || 0).toLocaleString('id'));
                    console.log('  profit: Rp' + Number(t.profit || 0).toLocaleString('id'));
                    console.log('  incomeAvailable:', s.incomeAvailable);
                    console.log('  missingHppSkuCount:', s.missingHppSkuCount);
                } catch (e) { console.log('ERROR parse:', e.message, '\n', d.substring(0, 300)); }
                resolve();
            });
        }).on('error', e => { console.log('HTTP err:', e.message); resolve(); });
    });

    // 5. Cross-check vs screenshot dashboard
    console.log('\n=== CROSS-CHECK vs DASHBOARD SCREENSHOT ===');
    const DASH = {
        accrual: { orders: 6527, gross: 204945900, disc: 87547859, net: 117398041, settlement: 86247247, ads: 18416187, hpp: 24009900, packing: 16936000, profit: 26925860 },
        settlement: { orders: 6504, gross: 203888200, disc: 87081624, net: 116806576, settlement: 86247247, ads: 18416187, hpp: 23917700, packing: 16818000, profit: 27136060 },
    };
    const FILE = {
        orders: 6545, gross: 205461900, disc: 87754361, net: 117707539,
        laporan_settlement: 67360515, // dari sheet Laporan row 3
        ads: 19820474,
    };
    console.log('\n[ORDERS SELESAI]');
    console.log('  File (distinct order ID status selesai): 6545');
    console.log('  Dashboard Accrual: 6527 | Selisih: ' + (6545 - 6527));
    console.log('  Dashboard Settlement: 6504 | Selisih: ' + (6545 - 6504));
    console.log('  → Normal: Accrual include dikirim, Settlement hanya sudah cair\n');
    console.log('[OMZET KOTOR]');
    console.log('  File (status selesai): Rp' + FILE.gross.toLocaleString('id'));
    console.log('  Dashboard Accrual: Rp' + DASH.accrual.gross.toLocaleString('id') + ' | Selisih: Rp' + (FILE.gross - DASH.accrual.gross).toLocaleString('id'));
    console.log('  Dashboard Settlement: Rp' + DASH.settlement.gross.toLocaleString('id') + ' | Selisih: Rp' + (FILE.gross - DASH.settlement.gross).toLocaleString('id'));
    console.log('[DISKON SELLER]');
    console.log('  File: Rp' + FILE.disc.toLocaleString('id') + ' | Dashboard: Rp' + DASH.accrual.disc.toLocaleString('id') + ' | Selisih: Rp' + (FILE.disc - DASH.accrual.disc).toLocaleString('id'));
    console.log('[SETTLEMENT CAIR]');
    console.log('  Laporan TikTok resmi: Rp' + FILE.laporan_settlement.toLocaleString('id'));
    console.log('  Dashboard: Rp' + DASH.accrual.settlement.toLocaleString('id') + ' | Selisih: Rp' + (FILE.laporan_settlement - DASH.accrual.settlement).toLocaleString('id'));
    console.log('[IKLAN]');
    console.log('  File Amount total: Rp' + FILE.ads.toLocaleString('id'));
    console.log('  Dashboard: Rp' + DASH.accrual.ads.toLocaleString('id') + ' | Selisih: Rp' + (FILE.ads - DASH.accrual.ads).toLocaleString('id'));
    console.log('  → Kemungkinan filter type "Bill payment" hanya, atau bulan tidak match');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); });
