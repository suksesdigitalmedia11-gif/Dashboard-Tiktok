/**
 * upload-all-stores.js — Upload semua data real dari folder "data tiktok"
 * 
 * Script ini menggunakan API endpoint /api/upload yang sama persis
 * dengan web app UI (FormData multipart), sehingga validasi, parsing,
 * dan business logic server berjalan identik dengan upload manual dari browser.
 * 
 * Toko & file yang di-upload:
 *   ventura     : pesanan+penarikan+iklan × Juli+Agustus (6 file)
 *   GIFTYOURS→giftyours: pesanan+penarikan+iklan × Juli+Agustus (6 file)
 *   cetakin     : pesanan Juli, pesanan+iklan+penarikan Agustus, iklan Juli (5 file)
 *   memora      : pesanan+penarikan+iklan × Juli+Agustus (6 file)
 *   piksera     : pesanan+penarikan+iklan × Juli+Agustus (6 file)
 *   tempelin    : pesanan+penarikan Juli+Agustus, iklan Juli (5 file)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/pg-connector').getDb();

const BASE = 'C:\\Users\\Lenovo\\Documents\\dashboard-keuangan-tiktok\\data tiktok';
const SERVER = { host: 'localhost', port: 9876 };

// ═══════════════════════════════════════════════════════════
// Definisi semua file yang akan diupload
// Format: { folder, storeName, fileName }
// ═══════════════════════════════════════════════════════════
const FILES = [
    // VENTURA (6 file)
    { folder: 'ventura', storeName: 'ventura', fileName: 'pesanan juli ventura.xlsx' },
    { folder: 'ventura', storeName: 'ventura', fileName: 'pesanan agustus ventura.xlsx' },
    { folder: 'ventura', storeName: 'ventura', fileName: 'penarikan dana juli ventura.xlsx' },
    { folder: 'ventura', storeName: 'ventura', fileName: 'penarikan dana agustus ventura.xlsx' },
    { folder: 'ventura', storeName: 'ventura', fileName: 'iklan juli ventura.xlsx' },
    { folder: 'ventura', storeName: 'ventura', fileName: 'iklan agustus ventura.xlsx' },

    // GIFTYOURS → store_name: giftyours (6 file)
    { folder: 'GIFTYOURS', storeName: 'giftyours', fileName: 'pesanan juli giftyours.xlsx' },
    { folder: 'GIFTYOURS', storeName: 'giftyours', fileName: 'pesanan agustus giftyours.xlsx' },
    { folder: 'GIFTYOURS', storeName: 'giftyours', fileName: 'penarikan dana juli giftyours.xlsx' },
    { folder: 'GIFTYOURS', storeName: 'giftyours', fileName: 'penarikan dana agustus giftyours.xlsx' },
    { folder: 'GIFTYOURS', storeName: 'giftyours', fileName: 'iklan juli giftyours.xlsx' },
    { folder: 'GIFTYOURS', storeName: 'giftyours', fileName: 'iklan agustus giftyours.xlsx' },

    // CETAKIN — tidak ada penarikan Juli (5 file)
    { folder: 'cetakin', storeName: 'cetakin', fileName: 'pesanan juli cetakin.xlsx' },
    { folder: 'cetakin', storeName: 'cetakin', fileName: 'pesanan agustus cetakin.xlsx' },
    { folder: 'cetakin', storeName: 'cetakin', fileName: 'penarikan dana agustus cetakin.xlsx' },
    { folder: 'cetakin', storeName: 'cetakin', fileName: 'iklan juli cetakin.xlsx' },
    { folder: 'cetakin', storeName: 'cetakin', fileName: 'iklan agustus cetakin.xlsx' },

    // MEMORA (6 file)
    { folder: 'memora', storeName: 'memora', fileName: 'pesanan juli memora.xlsx' },
    { folder: 'memora', storeName: 'memora', fileName: 'pesanan agustus memora.xlsx' },
    { folder: 'memora', storeName: 'memora', fileName: 'penarikan dana juli memora.xlsx' },
    { folder: 'memora', storeName: 'memora', fileName: 'penarikan dana agustus memora.xlsx' },
    { folder: 'memora', storeName: 'memora', fileName: 'iklan agustus memora.xlsx' },
    { folder: 'memora', storeName: 'memora', fileName: 'iklan juli memora.xlsx' },

    // PIKSERA (6 file)
    { folder: 'piksera', storeName: 'piksera', fileName: 'pesanan juli piksera.xlsx' },
    { folder: 'piksera', storeName: 'piksera', fileName: 'pesanan agustus piksera.xlsx' },
    { folder: 'piksera', storeName: 'piksera', fileName: 'penarikan dana juli piksera.xlsx' },
    { folder: 'piksera', storeName: 'piksera', fileName: 'penarikan dana agustus piksera.xlsx' },
    { folder: 'piksera', storeName: 'piksera', fileName: 'iklan juli piksera.xlsx' },
    { folder: 'piksera', storeName: 'piksera', fileName: 'iklan agustus piksera.xlsx' },

    // TEMPELIN (5 file — tidak ada iklan Agustus di folder)
    { folder: 'TEMPELIN', storeName: 'tempelin', fileName: 'pesanan juli tempelin.xlsx' },
    { folder: 'TEMPELIN', storeName: 'tempelin', fileName: 'pesanan agustus tempelin.xlsx' },
    { folder: 'TEMPELIN', storeName: 'tempelin', fileName: 'penarikan dana juli tempelin.xlsx' },
    { folder: 'TEMPELIN', storeName: 'tempelin', fileName: 'penarikan dana agustus tempelin.xlsx' },
    { folder: 'TEMPELIN', storeName: 'tempelin', fileName: 'iklan juli tempelin.xlsx' },
];

// ═══════════════════════════════════════════════════════════
// Fungsi upload via FormData (identik dengan browser UI)
// ═══════════════════════════════════════════════════════════
function uploadFile(filePath, storeName) {
    return new Promise((resolve, reject) => {
        let fileData;
        try {
            fileData = fs.readFileSync(filePath);
        } catch (e) {
            return resolve({ ok: false, skipped: true, reason: 'File tidak ditemukan: ' + filePath });
        }

        const fileName = path.basename(filePath);
        const boundary = '----FormDataBoundary' + Date.now() + Math.random().toString(36).slice(2);
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

        const reqOptions = {
            ...SERVER,
            path: '/api/upload',
            method: 'POST',
            headers: {
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': body.length,
            },
        };

        const req = http.request(reqOptions, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    resolve({ file: fileName, store: storeName, ...json });
                } catch (_) {
                    resolve({ file: fileName, store: storeName, ok: false, error: 'Non-JSON response: ' + raw.substring(0, 200) });
                }
            });
        });
        req.on('error', (e) => resolve({ file: fileName, store: storeName, ok: false, error: e.message }));
        req.write(body);
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════
// Clear data lama untuk toko yang akan diupload ulang
// ═══════════════════════════════════════════════════════════
function clearStoreData(storeName) {
    const orders = db.prepare("DELETE FROM finance_order_lines WHERE store_name=?").run(storeName);
    const income = db.prepare("DELETE FROM finance_income_raw WHERE store_name=?").run(storeName);
    const ads = db.prepare("DELETE FROM finance_ad_spend WHERE store_name=?").run(storeName);
    return { orders: orders.changes, income: income.changes, ads: ads.changes };
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════
async function main() {
    console.log('='.repeat(65));
    console.log('  UPLOAD SEMUA DATA REAL — DASHBOARD KEUANGAN TIKTOK');
    console.log('='.repeat(65));

    // 1. Clear data lama per toko (kecuali custombase yang sudah benar)
    const storesToClear = ['ventura', 'giftyours', 'cetakin', 'memora', 'piksera', 'tempelin'];
    console.log('\n>>> CLEAR data lama (kecuali custombase)...');
    for (const store of storesToClear) {
        const r = clearStoreData(store);
        console.log(`  ${store.padEnd(12)} → orders:${r.orders} | income:${r.income} | ads:${r.ads} dihapus`);
    }

    // 2. Upload semua file
    console.log('\n>>> UPLOAD', FILES.length, 'FILE...\n');
    const results = [];
    let currentGroup = '';

    for (const { folder, storeName, fileName } of FILES) {
        const filePath = path.join(BASE, folder, fileName);
        const sizeMB = fs.existsSync(filePath)
            ? (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
            : '?';

        // Header per toko
        if (storeName !== currentGroup) {
            console.log(`\n  ─── ${storeName.toUpperCase()} ───`);
            currentGroup = storeName;
        }

        process.stdout.write(`  [${sizeMB} MB] ${fileName} → `);
        const result = await uploadFile(filePath, storeName);
        results.push(result);

        if (result.skipped) {
            console.log(`SKIP (${result.reason})`);
        } else if (!result.ok) {
            console.log(`❌ FAIL | ${result.error || JSON.stringify(result)}`);
        } else {
            // Flat result atau results array
            const r = result.results ? result.results[0] : result;
            console.log(`✅ OK | kind:${r.kind || result.kind} | +${r.inserted || result.inserted} | ~${r.updated || result.updated} | =${r.unchanged || result.unchanged}`);
        }
    }

    // 3. DB state setelah upload
    console.log('\n' + '='.repeat(65));
    console.log('  DB STATE SETELAH UPLOAD');
    console.log('='.repeat(65));
    const storeStat = db.prepare(`
    SELECT o.store_name,
      COUNT(DISTINCT o.order_id) as orders,
      COALESCE(SUM(o.order_amount),0) as omzet,
      COUNT(DISTINCT i.order_id) as income_rows,
      COALESCE(SUM(i.settlement_amount),0) as settlement,
      (SELECT COUNT(*) FROM finance_ad_spend a WHERE a.store_name=o.store_name) as ad_rows,
      (SELECT COALESCE(SUM(amount),0) FROM finance_ad_spend a WHERE a.store_name=o.store_name) as ad_total
    FROM finance_order_lines o
    LEFT JOIN finance_income_raw i ON i.store_name = o.store_name
    GROUP BY o.store_name ORDER BY orders DESC
  `).all();

    console.log('\nSTORE        | ORDERS | OMZET            | INCOME | SETTLEMENT       | ADS | ADS TOTAL');
    console.log(''.padEnd(92, '-'));
    for (const s of storeStat) {
        const f = (n) => 'Rp' + Number(n || 0).toLocaleString('id');
        console.log(
            String(s.store_name).padEnd(12) + ' | ' +
            String(s.orders).padStart(6) + ' | ' +
            f(s.omzet).padStart(16) + ' | ' +
            String(s.income_rows).padStart(6) + ' | ' +
            f(s.settlement).padStart(16) + ' | ' +
            String(s.ad_rows).padStart(3) + ' | ' +
            f(s.ad_total)
        );
    }

    // 4. Ringkasan hasil
    const ok = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok && !r.skipped).length;
    const skip = results.filter(r => r.skipped).length;
    console.log(`\n>>> SELESAI: ${ok} berhasil | ${fail} gagal | ${skip} skip`);

    if (fail > 0) {
        console.log('\n❌ FILE YANG GAGAL:');
        results.filter(r => !r.ok && !r.skipped).forEach(r => {
            console.log('  -', r.file, '→', r.error || JSON.stringify(r));
        });
    }
}

main().catch(e => {
    console.error('\n❌ FATAL:', e.message, e.stack);
    process.exit(1);
});
