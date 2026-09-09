// Script: Upload + debug 3 file memora
const http = require('http');
const fs = require('fs');
const path = require('path');

async function uploadFile(filePath, storeName) {
    return new Promise((resolve) => {
        const boundary = 'bound' + Date.now();
        const filename = path.basename(filePath);
        const fileData = fs.readFileSync(filePath);
        const pre1 = '--' + boundary + '\r\nContent-Disposition: form-data; name="store"\r\n\r\n' + storeName + '\r\n';
        const pre2 = '--' + boundary + '\r\nContent-Disposition: form-data; name="files"; filename="' + filename + '"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n';
        const post = '\r\n--' + boundary + '--\r\n';
        const body = Buffer.concat([Buffer.from(pre1), Buffer.from(pre2), fileData, Buffer.from(post)]);
        const options = {
            hostname: 'localhost', port: 9876, path: '/api/upload',
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
        };
        const req = http.request(options, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ file: filename, status: res.statusCode, ...JSON.parse(d) }); }
                catch (e) { resolve({ file: filename, status: res.statusCode, raw: d.substring(0, 400) }); }
            });
        });
        req.on('error', e => resolve({ file: filename, error: e.message }));
        req.write(body); req.end();
    });
}

async function main() {
    const BASE = path.join(__dirname, '..');
    const files = [
        [path.join(BASE, 'Semua pesanan-memora-sampai-dengan-13-agustus.xlsx'), 'memora'],
        [path.join(BASE, 'penarikan-dana-memora.xlsx'), 'memora'],
        [path.join(BASE, 'iklan-memora.xlsx'), 'memora'],
    ];
    console.log('=== Upload Data Memora ===\n');
    for (const [fp, store] of files) {
        console.log('Upload:', path.basename(fp));
        const r = await uploadFile(fp, store);
        console.log('  status:', r.status, '| ok:', r.ok);
        if (r.results) r.results.forEach(x => console.log('  kind:', x.kind, '| rows:', x.rows, '| inserted:', x.inserted, '| updated:', x.updated, '| unchanged:', x.unchanged, '| msg:', x.message || ''));
        if (r.error) console.log('  ERROR:', r.error);
        if (r.raw) console.log('  raw:', r.raw);
        console.log();
    }

    // Debug: cek income_raw memora
    const { getDb } = require('../lib/pg-connector');
    const db = getDb();
    const income = db.prepare('SELECT COUNT(*) as c, SUM(settlement_amount) as total FROM finance_income_raw WHERE store_name=?').get('memora');
    const orders = db.prepare('SELECT COUNT(*) as c, SUM(settlement_received) as sr FROM finance_order_lines WHERE store_name=?').get('memora');
    const ads = db.prepare('SELECT COUNT(*) as c, SUM(amount) as total FROM finance_ad_spend WHERE store_name=?').get('memora');
    console.log('=== Debug DB Memora ===');
    console.log('income_raw:', JSON.stringify(income));
    console.log('order_lines:', JSON.stringify(orders));
    console.log('ad_spend:', JSON.stringify(ads));

    // Sample income rows
    const sampleIncome = db.prepare('SELECT store_name, order_id, transaction_type, settlement_amount FROM finance_income_raw WHERE store_name=? LIMIT 5').all('memora');
    console.log('Sample income_raw:', JSON.stringify(sampleIncome, null, 2));
}

main().catch(console.error);
