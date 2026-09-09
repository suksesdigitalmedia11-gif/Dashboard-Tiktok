/**
 * Upload file piksera yang tersisa + verifikasi memora profit fix
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

function f(n) { return 'Rp' + Number(n || 0).toLocaleString('id'); }

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
                catch (e) { resolve({ file: fileName, raw: d.substring(0, 300) }); }
            });
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

function get(path) {
    return new Promise(r => {
        http.get('http://localhost:9876' + path, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({}); } });
        }).on('error', e => r({ error: e.message }));
    });
}

async function main() {
    // 1. Upload file piksera
    console.log('=== UPLOAD FILE PIKSERA ===');
    const pikserFile = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok\\piksera\\semua-pesanan-piksera.xlsx';
    if (fs.existsSync(pikserFile)) {
        const sz = (fs.statSync(pikserFile).size / 1024).toFixed(0);
        process.stdout.write('[' + sz + ' KB] ' + path.basename(pikserFile) + ' ...');
        const r = await upload(pikserFile, 'piksera');
        console.log(' ' + (r.ok ? 'OK' : 'FAIL') + ' | kind:' + r.kind + ' | inserted:' + r.inserted + ' | updated:' + r.updated);
        if (!r.ok) console.log('  ERROR:', r.error || r.raw);
    } else {
        console.log('File tidak ditemukan:', pikserFile);
    }

    // 2. Verifikasi fix memora profit (tidak lagi null)
    console.log('\n=== VERIFIKASI MEMORA (profit fix) ===');
    const mem = await get('/api/summary?store=memora&preset=all');
    const mt = mem.totals || {};
    console.log('profit:', mt.profit, mt.profit !== null ? '(ADA ✅)' : '(MASIH NULL ❌)');
    console.log('margin:', mt.margin ? mt.margin.toFixed(1) + '%' : 'N/A');
    console.log('settlement:', f(mt.settlement), '| hpp:', f(mt.hpp), '| packing:', f(mt.packing), '| ads:', f(mt.ads));
    const expectedProfit = (mt.settlement || 0) - (mt.hpp || 0) - (mt.packing || 0) - (mt.ads || 0);
    console.log('Expected profit (settlement-hpp-packing-ads):', f(expectedProfit));
    console.log('Profit match?', Math.abs((mt.profit || 0) - expectedProfit) < 100 ? 'YES ✅' : 'NO ❌ (diff: ' + f(Math.abs((mt.profit || 0) - expectedProfit)) + ')');

    // 3. Final: verifikasi semua store setelah fix
    console.log('\n=== FINAL SUMMARY SEMUA STORE (setelah semua fix) ===');
    console.log('STORE        | ORDERS | NET            | PROFIT         | MARGIN | ADS            | STATUS');
    console.log(''.padEnd(95, '-'));
    for (const store of ['ventura', 'custombase', 'giftyours', 'cetakin', 'piksera', 'memora']) {
        const s = await get('/api/summary?store=' + store + '&preset=all');
        const t = s.totals || {};
        const marginOk = t.profit !== null && t.net && Math.abs(t.margin - (t.profit / t.net * 100)) < 0.5;
        const netOk = t.gross && t.sellerDiscount && Math.abs(t.net - (t.gross - t.sellerDiscount)) < 100;
        const status = t.profit === null ? '⚠️ profit null' : (netOk && marginOk ? '✅ OK' : '❌ CHECK');
        console.log(
            store.padEnd(12) + ' | ' +
            String(t.finalOrders || t.orders || 0).padStart(6) + ' | ' +
            String(f(t.net)).padStart(14) + ' | ' +
            String(t.profit !== null ? f(t.profit) : 'null').padStart(14) + ' | ' +
            String(t.margin !== null ? (t.margin || 0).toFixed(1) + '%' : 'N/A').padStart(6) + ' | ' +
            String(f(t.ads)).padStart(14) + ' | ' +
            status
        );
    }
}

main().catch(e => console.error('FATAL:', e.message, e.stack));
