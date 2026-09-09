/**
 * Clear custombase data + upload semua 6 file (Juli & Agustus)
 * Jalankan dari root: node upload-all-custombase.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok\\custombase';
const STORE = 'custombase';

const FILES = [
    'pesanan juli custombase.xlsx',
    'penarikan dana juli custombase.xlsx',
    'iklan juli custombase.xlsx',
    'pesanan agustus custombase.xlsx',
    'penarikan dana agustus custombase.xlsx',
    'iklan agustus custombase.xlsx',
];

function upload(filePath, storeName) {
    return new Promise((resolve, reject) => {
        const fileData = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);
        const boundary = '----FormBoundary' + Date.now();
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
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
        };
        const req = http.request(opts, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ file: fileName, ...JSON.parse(d) }); }
                catch (e) { resolve({ file: fileName, status: res.statusCode, raw: d.substring(0, 200) }); }
            });
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

async function main() {
    // Step 1: Clear data custombase
    const db = require('./lib/pg-connector').getDb();
    console.log('>>> CLEAR custombase data (order+income+ads)...');
    const d1 = db.prepare("DELETE FROM finance_order_lines WHERE store_name='custombase'").run();
    const d2 = db.prepare("DELETE FROM finance_income_raw WHERE store_name='custombase'").run();
    const d3 = db.prepare("DELETE FROM finance_ad_spend WHERE store_name='custombase'").run();
    console.log('Cleared:', d1.changes, 'orders |', d2.changes, 'income |', d3.changes, 'ads');

    // Step 2: Upload semua file
    console.log('\n>>> UPLOAD 6 FILE custombase...\n');
    const results = [];
    for (const f of FILES) {
        const fp = path.join(BASE, f);
        if (!fs.existsSync(fp)) { console.log('SKIP (tidak ada):', f); continue; }
        const sizeMB = (fs.statSync(fp).size / 1024 / 1024).toFixed(1);
        process.stdout.write('  [' + sizeMB + ' MB] ' + f + ' ... ');
        try {
            const r = await upload(fp, STORE);
            const status = r.ok ? 'OK' : 'FAIL';
            console.log(status + ' | kind:' + r.kind + ' | inserted:' + r.inserted + ' | updated:' + r.updated + ' | unchanged:' + r.unchanged);
            if (!r.ok) console.log('    ERROR:', r.error || r.msg || r.raw);
            results.push(r);
        } catch (e) { console.log('ERROR:', e.message); }
    }

    // Step 3: DB summary setelah upload
    console.log('\n>>> DB STATE SETELAH UPLOAD:');
    const o = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet FROM finance_order_lines WHERE store_name='custombase'").get();
    const oJ = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%'").get();
    const oA = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-08%'").get();
    const inc = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name='custombase'").get();
    const incJ = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name='custombase' AND order_created_time LIKE '2026-07%'").get();
    const ads = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase'").get();
    const adsJ = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%'").get();
    const adsA = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-08%'").get();

    function f(n) { return 'Rp' + Number(n || 0).toLocaleString('id'); }
    console.log('order_lines ALL  :', o.c, 'rows | Omzet:', f(o.omzet));
    console.log('order_lines JULI :', oJ.c, 'rows | Omzet:', f(oJ.omzet), '| Disc:', f(oJ.disc));
    console.log('order_lines AGUST :', oA.c, 'rows | Omzet:', f(oA.omzet));
    console.log('income_raw ALL   :', inc.c, 'rows | Settlement:', f(inc.total));
    console.log('income_raw JULI  :', incJ.c, 'rows | Settlement:', f(incJ.total));
    console.log('ad_spend ALL     :', ads.c, 'rows | Total:', f(ads.total));
    console.log('ad_spend JULI    :', adsJ.c, 'rows | Total:', f(adsJ.total));
    console.log('ad_spend AGUST   :', adsA.c, 'rows | Total:', f(adsA.total));

    // Step 4: Cek status breakdown
    const st = db.prepare("SELECT status, COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%' GROUP BY status ORDER BY c DESC").all();
    console.log('\nStatus JULI:');
    st.forEach(r => console.log('  "' + r.status + '":', r.c));
}

main().catch(e => console.error('FATAL:', e.message, e.stack));
