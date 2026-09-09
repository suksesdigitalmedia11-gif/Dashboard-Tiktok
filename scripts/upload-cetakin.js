// Script: Upload data cetakin ke server localhost:9876
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
            headers: {
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': body.length,
            }
        };

        const req = http.request(options, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const r = JSON.parse(d);
                    resolve({ file: filename, status: res.statusCode, ok: r.ok, message: r.message || r.error, results: r.results });
                } catch (e) {
                    resolve({ file: filename, status: res.statusCode, raw: d.substring(0, 300) });
                }
            });
        });
        req.on('error', e => resolve({ file: filename, error: e.message }));
        req.write(body);
        req.end();
    });
}

async function main() {
    const BASE = path.join(__dirname, '..');
    const files = [
        [path.join(BASE, 'DATA PENJUALAN CETAKIN JULI.xlsx'), 'cetakin'],
        [path.join(BASE, 'IKLAN CETAKIN JULI.xlsx'), 'cetakin'],
        [path.join(BASE, 'PENCAIRAN DANA CETAKINN.xlsx'), 'cetakin'],
    ];

    console.log('=== Upload Data Cetakin ke Server ===\n');
    for (const [filePath, store] of files) {
        if (!fs.existsSync(filePath)) { console.log('File tidak ditemukan:', filePath); continue; }
        console.log('Mengupload:', path.basename(filePath), '→ toko:', store, '...');
        const result = await uploadFile(filePath, store);
        console.log('  Status:', result.status, '| OK:', result.ok);
        if (result.message) console.log('  Pesan:', result.message);
        if (result.results) result.results.forEach(r => console.log('  -', r.filename, ':', r.kind, '|', r.inserted, 'baru |', r.updated, 'update'));
        if (result.error) console.log('  ERROR:', result.error);
        if (result.raw) console.log('  Raw:', result.raw);
        console.log();
    }
}

main().catch(console.error);
