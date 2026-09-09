/**
 * upload-memora-ads.js — Upload iklan memora Juli+Agustus (format Bahasa Indonesia)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/pg-connector').getDb();

const BASE = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok';

function uploadFile(folder, fileName, storeName) {
    return new Promise((resolve) => {
        const filePath = path.join(BASE, folder, fileName);
        let fileData;
        try { fileData = fs.readFileSync(filePath); }
        catch (e) { return resolve({ file: fileName, ok: false, error: 'File tidak ditemukan' }); }

        const boundary = '----Boundary' + Date.now();
        const CRLF = '\r\n';
        const headerBuf = Buffer.from(
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="store_name"' + CRLF + CRLF +
            storeName + CRLF +
            '--' + boundary + CRLF +
            'Content-Disposition: form-data; name="file"; filename="' + fileName + '"' + CRLF +
            'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' + CRLF + CRLF
        );
        const footerBuf = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);
        const body = Buffer.concat([headerBuf, fileData, footerBuf]);

        const req = http.request({
            hostname: 'localhost', port: 9876, path: '/api/upload', method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    const r = json.results ? json.results[0] : json;
                    console.log(json.ok ? '✅' : '❌', fileName, '|', 'kind:', r.kind || json.kind, '| +' + (r.inserted || json.inserted) + ' rows |', json.error || '');
                    resolve(json);
                } catch (_) {
                    console.log('❌', fileName, '| Non-JSON:', raw.substring(0, 200));
                    resolve({ ok: false });
                }
            });
        });
        req.on('error', (e) => { console.log('❌', fileName, '|', e.message); resolve({ ok: false }); });
        req.write(body); req.end();
    });
}

async function main() {
    console.log('=== UPLOAD IKLAN MEMORA (format Bahasa Indonesia) ===\n');

    // Clear ads memora dulu
    const del = db.prepare('DELETE FROM finance_ad_spend WHERE store_name=?').run('memora');
    console.log('Clear ads memora:', del.changes, 'rows\n');

    await uploadFile('memora', 'iklan juli memora.xlsx', 'memora');
    await uploadFile('memora', 'iklan agustus memora.xlsx', 'memora');

    // Verifikasi
    const f = n => 'Rp' + Number(n || 0).toLocaleString('id');
    const ads = db.prepare('SELECT COUNT(*) as c, SUM(amount) as total FROM finance_ad_spend WHERE store_name=?').get('memora');
    console.log('\nDB memora ads:', ads.c, 'rows | total:', f(ads.total));

    // Check API
    const http2 = require('http');
    const s = await new Promise(r => {
        http2.get('http://localhost:9876/api/summary?store=memora&preset=all', res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => r(JSON.parse(d)));
        }).on('error', () => r({}));
    });
    const t = s.totals || {};
    console.log('\nAPI memora (all):');
    console.log('  profit:', f(t.profit), '| margin:', t.margin ? t.margin.toFixed(1) + '%' : 'N/A');
    console.log('  ads:', f(t.ads), '| adTop:', f(t.adSpendTopup), '| adGMV:', f(t.adSpendSettlement));
    console.log('  net:', f(t.net), '| settlement:', f(t.settlement));
}

main().catch(e => console.error('FATAL:', e.message));
