/**
 * Upload custombase Juli ke server + Analisa langsung dari Excel
 * Metode: multipart/form-data manual (tanpa dependency eksternal)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BASE = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok\\custombase';
const STORE = 'custombase';

function uploadFile(filePath, storeName) {
    return new Promise((resolve, reject) => {
        const fileData = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);
        const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
        const CRLF = '\r\n';
        const header = Buffer.from(
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="store_name"' + CRLF + CRLF +
            storeName + CRLF +
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="file"; filename="' + fileName + '"' + CRLF +
            'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' + CRLF + CRLF
        );
        const footer = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);
        const body = Buffer.concat([header, fileData, footer]);

        const opts = {
            hostname: 'localhost', port: 9876, path: '/api/upload', method: 'POST',
            headers: {
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': body.length
            }
        };
        const req = http.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ file: fileName, status: res.statusCode, ...JSON.parse(d) }); }
                catch (e) { resolve({ file: fileName, status: res.statusCode, raw: d.substring(0, 300) }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Parse Excel langsung untuk kalkulasi independen (ground truth dari file)
function parseExcel(filePath) {
    const wb = XLSX.readFile(filePath, { cellDates: true, raw: false });
    // Pilih sheet yang benar
    const sheetNames = wb.SheetNames;
    let sheetName = sheetNames.includes('OrderSKUList') ? 'OrderSKUList'
        : sheetNames.includes('Detail pesanan') ? 'Detail pesanan'
            : sheetNames.find(s => s.toLowerCase().includes('pesanan')) || sheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return { rows, sheetName, sheetNames };
}

function ru(v) { // rupiah ubah
    if (!v && v !== 0) return 0;
    const s = String(v).replace(/[^\d,.-]/g, '').replace(',', '.');
    return Math.abs(parseFloat(s)) || 0;
}

function ct(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function main() {
    console.log('======================================================');
    console.log(' ANALISA MENDALAM custombase JULI 2026');
    console.log('======================================================\n');

    // ── UPLOAD 3 FILE JULI ──
    console.log('=== FASE 1: UPLOAD FILE ===');
    const files = [
        'pesanan juli custombase.xlsx',
        'penarikan dana juli custombase.xlsx',
        'iklan juli custombase.xlsx',
    ];
    const uploadResults = {};
    for (const f of files) {
        const fp = path.join(BASE, f);
        if (!fs.existsSync(fp)) { console.log('SKIP (tidak ada):', f); continue; }
        process.stdout.write('Upload: ' + f + ' ... ');
        try {
            const r = await uploadFile(fp, STORE);
            uploadResults[f] = r;
            console.log(r.ok ? 'OK' : 'FAIL', '| kind:', r.kind, '| rows:', r.rows, '| inserted:', r.inserted, '| updated:', r.updated, '| unchanged:', r.unchanged);
            if (!r.ok) console.log('  ERROR:', JSON.stringify(r).substring(0, 300));
        } catch (e) { console.log('ERROR:', e.message); }
    }

    // ── ANALISA LANGSUNG DARI EXCEL (GROUND TRUTH) ──
    console.log('\n=== FASE 2: ANALISA EXCEL SUMBER (Ground Truth) ===');

    // -- PESANAN --
    const pesananFile = path.join(BASE, 'pesanan juli custombase.xlsx');
    const wb = XLSX.readFile(pesananFile, { cellDates: true, raw: false });
    let sheetName = wb.SheetNames.includes('OrderSKUList') ? 'OrderSKUList'
        : wb.SheetNames.includes('Detail pesanan') ? 'Detail pesanan'
            : wb.SheetNames[0];
    console.log('\n[PESANAN] Sheet dipilih:', sheetName, '| Sheets:', wb.SheetNames.join(', '));
    const pesananRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    console.log('[PESANAN] Total rows di file:', pesananRows.length);

    // Kolom-kolom kunci (lihat header dulu)
    if (pesananRows.length > 0) {
        const headers = Object.keys(pesananRows[0]);
        console.log('[PESANAN] Headers:', headers.slice(0, 20).join(' | '));
    }

    // Kalkulasi dari pesanan
    const STATUS_SELESAI = ['selesai', 'completed', 'delivered', 'dikirim', 'shipped'];
    const STATUS_CANCEL = ['dibatalkan', 'cancelled', 'canceled', 'cancel', 'cancellations'];
    const STATUS_RETUR = ['dikembalikan', 'returned', 'return'];

    let totalOrders = new Set(), totalSelesai = new Set(), totalCancel = new Set(), totalRetur = new Set();
    let omzetKotor = 0, diskonSeller = 0, ordersByStatus = {};

    for (const r of pesananRows) {
        const orderId = String(r['Order ID'] || r['ID pesanan'] || '').trim();
        const status = ct(r['Order Status'] || r['Status pesanan'] || r['Status'] || '');
        const subtotal = ru(r['SKU Subtotal Before Discount'] || r['Total Harga Produk'] || r['SKU Subtotal Sebelum Diskon'] || 0);
        const diskon = ru(r['SKU Seller Discount'] || r['Diskon Seller'] || r['Diskon yang diberikan seller'] || 0);

        if (!orderId) continue;
        totalOrders.add(orderId);
        ordersByStatus[status] = (ordersByStatus[status] || 0) + 1;

        if (STATUS_SELESAI.some(s => status.includes(s))) {
            totalSelesai.add(orderId);
            omzetKotor += subtotal;
            diskonSeller += diskon;
        } else if (STATUS_CANCEL.some(s => status.includes(s))) {
            totalCancel.add(orderId);
        } else if (STATUS_RETUR.some(s => status.includes(s))) {
            totalRetur.add(orderId);
        }
    }
    const omzetNet = omzetKotor - diskonSeller;
    console.log('\n[PESANAN LINI KRITIS]:');
    console.log('  Total unique Order IDs di file:', totalOrders.size);
    console.log('  Status Selesai:', totalSelesai.size, '| Omzet Kotor: Rp' + omzetKotor.toLocaleString('id'));
    console.log('  Diskon Seller: Rp' + diskonSeller.toLocaleString('id'));
    console.log('  Omzet Net: Rp' + omzetNet.toLocaleString('id'));
    console.log('  Status Cancel:', totalCancel.size);
    console.log('  Status Retur:', totalRetur.size);
    console.log('  Breakdown status (top 10):');
    Object.entries(ordersByStatus).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([s, c]) => console.log('    "' + s + '":', c));

    // -- PENARIKAN DANA (INCOME) --
    console.log('\n[PENARIKAN DANA / SETTLEMENT]:');
    const pdFile = path.join(BASE, 'penarikan dana juli custombase.xlsx');
    const pdWb = XLSX.readFile(pdFile, { cellDates: true, raw: false });
    // Cari sheet income
    function sheetHasIncome(ws) {
        for (const key in ws) {
            if (!key || key[0] === '!') continue;
            const v = ct(String(ws[key].w || ws[key].v || ''));
            if (v.includes('idpesananpenyesuaian') || v.includes('orderadjustmentid') || v.includes('jumlahpenyelesaian')) return true;
        }
        return false;
    }
    let pdSheet = pdWb.SheetNames.find(s => sheetHasIncome(pdWb.Sheets[s])) || pdWb.SheetNames[0];
    console.log('  Sheet dipilih:', pdSheet, '| Sheets:', pdWb.SheetNames.join(', '));
    const pdRows = XLSX.utils.sheet_to_json(pdWb.Sheets[pdSheet], { defval: '' });
    console.log('  Total rows di file:', pdRows.length);
    if (pdRows.length > 0) {
        console.log('  Headers:', Object.keys(pdRows[0]).slice(0, 15).join(' | '));
    }

    let settlementTotal = 0, settlementPesanan = 0, settlementAdj = 0, settlementAds = 0, settlementCounts = {};
    const AD_TYPES = ['gmvmax', 'tiktokads', 'iklan', 'ads'];
    for (const r of pdRows) {
        // Cari kolom settlement amount
        const amt = ru(
            r['Jumlah Penyelesaian'] || r['Total Settlement'] || r['Settlement Amount'] ||
            r['Jumlah'] || r['Amount'] || 0
        );
        const type = ct(Object.values(r).slice(0, 5).join(' '));
        const txType = ct(r['Tipe transaksi'] || r['Transaction Type'] || r['Jenis Transaksi'] || '');
        settlementCounts[txType] = (settlementCounts[txType] || 0) + 1;

        if (AD_TYPES.some(t => txType.includes(t))) { settlementAds += amt; }
        else if (txType === 'pesanan' || txType === 'order') { settlementPesanan += amt; settlementTotal += amt; }
        else { settlementAdj += amt; settlementTotal += amt; }
    }
    console.log('  Settlement Pesanan: Rp' + settlementPesanan.toLocaleString('id'));
    console.log('  Settlement Lainnya: Rp' + settlementAdj.toLocaleString('id'));
    console.log('  Settlement Iklan (dari PD): Rp' + settlementAds.toLocaleString('id'));
    console.log('  TOTAL Settlement Non-Ads: Rp' + settlementTotal.toLocaleString('id'));
    console.log('  Breakdown tipe transaksi (top 10):');
    Object.entries(settlementCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([t, c]) => console.log('    "' + t + '":', c, 'rows'));

    // -- IKLAN --
    console.log('\n[IKLAN]:');
    const ikFile = path.join(BASE, 'iklan juli custombase.xlsx');
    const ikWb = XLSX.readFile(ikFile, { cellDates: true, raw: false });
    const ikSheet = ikWb.SheetNames[0];
    const ikRows = XLSX.utils.sheet_to_json(ikWb.Sheets[ikSheet], { defval: '' });
    console.log('  Total rows:', ikRows.length, '| Sheet:', ikSheet);
    let totalIklan = 0;
    for (const r of ikRows) {
        const cost = ru(r['Cost'] || r['Biaya'] || r['Total Cost'] || r['Amount'] || r['Biaya Iklan'] || 0);
        totalIklan += cost;
    }
    console.log('  Total Biaya Iklan dari file: Rp' + totalIklan.toLocaleString('id'));
    if (ikRows.length > 0) console.log('  Headers:', Object.keys(ikRows[0]).slice(0, 10).join(' | '));

    // ── BANDINGKAN DENGAN DASHBOARD ──
    console.log('\n=== FASE 3: CROSS-CHECK vs DASHBOARD ===');
    console.log('\nAngka dari DASHBOARD (screenshot):');
    const DASH_ACCRUAL = {
        orderSelesai: 6527, omzetKotor: 204945900, diskonSeller: 87547859,
        omzetNet: 117398041, settlementCair: 86247247, potonganPlatform: 29791739,
        biayaIklan: 18416187, hpp: 24009900, packing: 16936000,
        profit: 26925860
    };
    const DASH_SETTLEMENT = {
        orderSelesai: 6504, omzetKotor: 203888200, diskonSeller: 87081624,
        omzetNet: 116806576, settlementCair: 86247247, potonganPlatform: 29791739,
        biayaIklan: 18416187, hpp: 23917700, packing: 16818000,
        profit: 27136060
    };

    console.log('  [Accrual] Order Selesai:', DASH_ACCRUAL.orderSelesai, '| File:', totalSelesai.size);
    console.log('  [Accrual] Omzet Kotor dashboard: Rp' + DASH_ACCRUAL.omzetKotor.toLocaleString('id') + ' | File: Rp' + omzetKotor.toLocaleString('id'));
    console.log('  [Accrual] Diskon Seller dashboard: Rp' + DASH_ACCRUAL.diskonSeller.toLocaleString('id') + ' | File: Rp' + diskonSeller.toLocaleString('id'));
    console.log('  Settlement Cair dashboard: Rp' + DASH_ACCRUAL.settlementCair.toLocaleString('id') + ' | File calc: Rp' + settlementTotal.toLocaleString('id'));
    console.log('  Biaya Iklan dashboard: Rp' + DASH_ACCRUAL.biayaIklan.toLocaleString('id') + ' | File: Rp' + totalIklan.toLocaleString('id'));

    // ── CEK DB SETELAH UPLOAD ──
    console.log('\n=== FASE 4: DATABASE CHECK SETELAH UPLOAD ===');
    const { getDb } = require('./lib/pg-connector');
    const db = getDb();
    const dbOrders = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name='custombase'").get();
    const dbOrdersJuli = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%'").get();
    const dbIncome = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name='custombase'").get();
    const dbAds = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase'").get();
    const dbStatus = db.prepare("SELECT status, COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' GROUP BY status ORDER BY c DESC LIMIT 10").all();

    console.log('order_lines custombase (ALL):', dbOrders.c, 'rows | Omzet: Rp' + Number(dbOrders.omzet).toLocaleString('id'));
    console.log('order_lines custombase (Juli 2026):', dbOrdersJuli.c, 'rows | Omzet: Rp' + Number(dbOrdersJuli.omzet).toLocaleString('id'));
    console.log('income_raw custombase:', dbIncome.c, 'rows | Settlement: Rp' + Number(dbIncome.total).toLocaleString('id'));
    console.log('ad_spend custombase:', dbAds.c, 'rows | Total: Rp' + Number(dbAds.total).toLocaleString('id'));
    console.log('Breakdown status di DB:');
    dbStatus.forEach(r => console.log('  "' + r.status + '":', r.c));

    // ── QUERY API SUMMARY ──
    console.log('\n=== FASE 5: API SUMMARY JULI - custombase ===');
    await new Promise(resolve => {
        http.get('http://localhost:9876/api/summary?store=custombase&preset=month&month=2026-07', res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const s = JSON.parse(d);
                    const t = s.totals || {};
                    console.log('API Response (Accrual mode, Juli):');
                    console.log('  finalOrders:', t.finalOrders || t.orders);
                    console.log('  gross: Rp' + Number(t.gross || 0).toLocaleString('id'));
                    console.log('  sellerDiscount: Rp' + Number(t.sellerDiscount || 0).toLocaleString('id'));
                    console.log('  net: Rp' + Number(t.net || 0).toLocaleString('id'));
                    console.log('  settlement: Rp' + Number(t.settlement || 0).toLocaleString('id'));
                    console.log('  ads: Rp' + Number(t.ads || 0).toLocaleString('id'));
                    console.log('  hpp: Rp' + Number(t.hpp || 0).toLocaleString('id'));
                    console.log('  packing: Rp' + Number(t.packing || 0).toLocaleString('id'));
                    console.log('  profit: Rp' + Number(t.profit || 0).toLocaleString('id'));
                    console.log('  incomeAvailable:', s.incomeAvailable);
                } catch (e) { console.log('Parse error:', e.message, d.substring(0, 200)); }
                resolve();
            });
        }).on('error', e => { console.log('HTTP error:', e.message); resolve(); });
    });

    console.log('\n======================================================');
    console.log(' SELESAI — lihat angka di atas untuk cross-check');
    console.log('======================================================');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
