/**
 * debug-skip-files.js — Debug server response untuk file yang SKIP
 * Lalu re-upload file yang berhasil diparse
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok';
const SERVER = { host: 'localhost', port: 9876 };

function uploadFileDebug(folder, fileName, storeName) {
    return new Promise((resolve) => {
        const filePath = path.join(BASE, folder, fileName);
        let fileData;
        try {
            fileData = fs.readFileSync(filePath);
        } catch (e) {
            return resolve({ file: fileName, ok: false, error: 'File tidak ditemukan: ' + e.message });
        }

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
            ...SERVER, path: '/api/upload', method: 'POST',
            headers: {
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': body.length,
            },
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                console.log('\n=== ' + fileName + ' [' + storeName + '] ===');
                console.log('HTTP Status:', res.statusCode);
                try {
                    const json = JSON.parse(raw);
                    if (json.ok) {
                        const r = json.results ? json.results[0] : json;
                        console.log('RESULT:', json.ok ? 'OK' : 'FAIL',
                            '| kind:', r.kind || json.kind,
                            '| inserted:', r.inserted || json.inserted,
                            '| updated:', r.updated || json.updated,
                            '| rows:', r.rows || json.rows);
                    } else {
                        console.log('ERROR:', json.error || JSON.stringify(json).substring(0, 300));
                    }
                    resolve({ file: fileName, ...json });
                } catch (_) {
                    console.log('NON-JSON RESPONSE:', raw.substring(0, 300));
                    resolve({ file: fileName, ok: false, error: 'Non-JSON: ' + raw.substring(0, 100) });
                }
            });
        });
        req.on('error', (e) => {
            console.log('REQUEST ERROR:', e.message);
            resolve({ file: fileName, ok: false, error: e.message });
        });
        req.write(body);
        req.end();
    });
}

async function main() {
    console.log('=== DEBUG UPLOAD FILE SKIP ===\n');

    const skipFiles = [
        { folder: 'ventura', fileName: 'penarikan dana juli ventura.xlsx', storeName: 'ventura' },
        { folder: 'GIFTYOURS', fileName: 'penarikan dana juli giftyours.xlsx', storeName: 'giftyours' },
        { folder: 'TEMPELIN', fileName: 'penarikan dana juli tempelin.xlsx', storeName: 'tempelin' },
    ];

    for (const f of skipFiles) {
        await uploadFileDebug(f.folder, f.fileName, f.storeName);
    }

    console.log('\n=== SELESAI ===');
}

main().catch(e => console.error('FATAL:', e.message));
