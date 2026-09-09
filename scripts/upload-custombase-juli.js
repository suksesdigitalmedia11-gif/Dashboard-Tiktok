/**
 * Script upload custombase Juli ke server + validasi data
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const XLSX = require('xlsx');

const BASE = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok\\custombase';
const FILES_JULI = [
    'pesanan juli custombase.xlsx',
    'penarikan dana juli custombase.xlsx',
    'iklan juli custombase.xlsx',
];
const STORE = 'custombase';
const SERVER = 'http://localhost:9876';

function uploadFile(filePath, storeName) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) });
        form.append('store_name', storeName);
        const opts = {
            hostname: 'localhost', port: 9876, path: '/api/upload',
            method: 'POST', headers: form.getHeaders()
        };
        const req = http.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ file: path.basename(filePath), status: res.statusCode, ...JSON.parse(d) }); }
                catch (e) { resolve({ file: path.basename(filePath), status: res.statusCode, raw: d.substring(0, 200) }); }
            });
        });
        req.on('error', reject);
        form.pipe(req);
    });
}

async function main() {
    console.log('=== UPLOAD custombase JULI ke Server ===\n');
    for (const f of FILES_JULI) {
        const fp = path.join(BASE, f);
        if (!fs.existsSync(fp)) { console.log('FILE TIDAK ADA:', f); continue; }
        const r = await uploadFile(fp, STORE);
        const stat = r.ok ? 'OK' : 'FAIL';
        console.log(stat, '|', r.file);
        console.log('   kind:', r.kind, '| rows:', r.rows, '| inserted:', r.inserted, '| updated:', r.updated, '| unchanged:', r.unchanged);
        if (!r.ok) console.log('   ERROR:', r.error || r.msg || r.raw);
        console.log();
    }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
