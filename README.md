# 📊 Dashboard Keuangan TikTok Shop

> **Sistem monitoring keuangan real-time untuk seller TikTok Shop** — Pantau omzet, profit, HPP, dana tertahan, dan iklan dari semua toko dalam satu tampilan.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)
![Database](https://img.shields.io/badge/Database-SQLite%20%7C%20Turso%20%7C%20PostgreSQL-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20Mac-lightgrey)
![License](https://img.shields.io/badge/License-Sukses%20Digital%20Media-orange)

---

## 🎯 Apa Itu Dashboard Ini?

Dashboard ini adalah **aplikasi web lokal** yang membantu kamu memantau keuangan toko TikTok Shop secara akurat dan detail. Cukup jalankan di komputer, upload file Excel dari Seller Center TikTok, dan semua angka penting langsung muncul secara otomatis.

**Cocok untuk:**
- 🏪 Seller TikTok Shop yang punya 1 atau lebih toko
- 📊 Yang ingin tahu profit bersih setelah potongan HPP, iklan, dan fee platform
- 💰 Yang ingin memantau uang yang sudah cair vs yang masih tertahan di TikTok
- 👥 Tim bisnis yang butuh akses data terbatas (tanpa data profit rahasia)

---

## ✨ Fitur Lengkap

### 📈 Laporan Keuangan Akurat
| Fitur | Keterangan |
|-------|-----------|
| 💰 **Omzet & Profit Real** | Omzet kotor, diskon seller, omzet net, dan profit bersih setelah semua potongan |
| 📦 **HPP + Biaya Packing** | Hitung otomatis biaya produksi dan packing per SKU, hanya untuk order yang berhasil (bukan cancel) |
| 🔒 **Dana Tertahan** | Tampilkan order yang uangnya belum cair beserta estimasi kapan cair |
| 📡 **Iklan TikTok** | Lacak biaya iklan GMV Max (dipotong otomatis TikTok) dan iklan top-up (transfer manual) |
| 📋 **Settlement Cair** | Rekonsiliasi data pencairan dari file Income Statement TikTok |

### 🏪 Multi-Toko & Multi-Periode
| Fitur | Keterangan |
|-------|-----------|
| 🏪 **Multi-Toko** | Pantau banyak toko sekaligus (ventura, custombase, giftyours, cetakin, memora, piksera, tempelin, dll.) |
| 🕐 **Filter Periode** | All, 7 Hari, 14 Hari, Bulan Ini, Pilih Bulan, atau Range Tanggal Custom |
| 🔄 **2 Mode Tampilan** | **Kas Nyata (Settlement)** vs **Proyeksi (Accrual)** — lihat penjelasan di bawah |

### 🔍 Detail & Drilldown
| Fitur | Keterangan |
|-------|-----------|
| 🔍 **Drilldown Order** | Klik kartu manapun untuk lihat detail sampai level per-order |
| 📦 **Drilldown HPP per SKU** | Lihat qty terhitung, HPP total, packing total per produk |
| 💳 **Drilldown Dana Tertahan** | List order yang belum cair + estimasi kapan cair + umur order |

### ⚙️ Fitur Operasional
| Fitur | Keterangan |
|-------|-----------|
| 📡 **Telegram Bot** | Ringkasan keuangan otomatis dikirim ke Telegram setiap pagi |
| 👥 **3 Level Akses** | Owner (full data), Tim (tanpa profit/HPP), TV Kantor (display mode) |
| 📁 **Folder Monitor** | Monitor folder download otomatis — file baru langsung diproses |
| 🔄 **Upload Aman** | Upload ulang file yang sama tidak akan duplikasi data |

---

## 🚀 Cara Memulai (Untuk Pengguna Baru)

### Prasyarat

Pastikan kamu sudah menginstal:
- **Node.js versi 18 ke atas** → [Download gratis di nodejs.org](https://nodejs.org) *(pilih versi LTS)*
- **Git** *(opsional, hanya jika mau clone)* → [Download git-scm.com](https://git-scm.com)

> 💡 **Cara cek:** Buka Command Prompt / Terminal, ketik `node --version`. Kalau muncul angka seperti `v20.x.x`, berarti sudah terinstal.

---

### Langkah 1: Download Project

**Opsi A — Pakai Git (Disarankan):**
```bash
git clone https://github.com/Rzkyjlnsyh/dashboard-keuangan-tiktok.git
cd dashboard-keuangan-tiktok
```

**Opsi B — Download ZIP:**
Klik tombol hijau **"Code"** di halaman GitHub → pilih **"Download ZIP"** → ekstrak ke folder mana saja.

---

### Langkah 2: Install Library yang Dibutuhkan

Buka Command Prompt / Terminal di dalam folder project, lalu jalankan:
```bash
npm install
```

> ⏳ Tunggu hingga selesai (sekitar 30 detik–1 menit tergantung koneksi internet).

---

### Langkah 3: Konfigurasi (Opsional untuk Lokal)

Salin file contoh konfigurasi:
```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Buka file `.env` dengan Notepad dan sesuaikan jika perlu:
```env
# Port server (opsional, default: 3001 atau 9876)
PORT=9876

# Telegram Bot (opsional)
TELEGRAM_BOT_TOKEN=isi_token_bot_telegram_kamu
TELEGRAM_CHAT_ID=isi_chat_id_kamu

# Database Production (opsional, default: SQLite lokal)
# TURSO_URL=libsql://nama-db.turso.io
# TURSO_TOKEN=token_turso_kamu
```

> ✅ **Kalau hanya pakai lokal:** Tidak perlu mengubah apapun. SQLite database akan dibuat otomatis di folder `data/`.

---

### Langkah 4: Jalankan Dashboard

**Cara 1 — Double-click (Windows, termudah):**
Klik dua kali file **`start-dashboard.bat`** → server + Cloudflare Tunnel akan langsung jalan.

**Cara 2 — Terminal:**
```bash
node server.js
```

**Cara 3 — npm:**
```bash
npm start
```

---

### Langkah 5: Buka di Browser

Ketik di browser:
```
http://localhost:9876
```

> 🎉 **Selesai!** Dashboard siap digunakan. Database SQLite dibuat otomatis di folder `data/`.

---

## 📤 Cara Upload Data

Dashboard membaca **3 jenis file Excel** yang diunduh dari TikTok Seller Center:

### 📋 File 1: Data Pesanan (Order)

**Dari mana:** Seller Center TikTok → menu **Pesanan** → **Ekspor Pesanan**

**Isi file:** Nomor order, SKU, nama produk, variasi, jumlah (qty), harga jual, status paket, tanggal

**Contoh nama file:** `Semua pesanan-custombase-Juli.xlsx`

---

### 💳 File 2: Income Statement / Pencairan Dana

**Dari mana:** Seller Center TikTok → menu **Keuangan** → **Income Statement (Laporan Pendapatan)**

**Isi file:** Konfirmasi uang yang sudah cair ke rekening, termasuk potongan fee platform dan iklan

**Contoh nama file:** `cair juli custombase.xlsx`

---

### 💲 File 3: Data HPP (Harga Pokok Produksi)

**Format:** Excel sesuai template — berisi kode SKU, HPP per unit (Rp), biaya packing per unit (Rp)

**Cara termudah:** Kelola langsung dari menu **Detail SKU** di dalam dashboard (tidak perlu upload manual).

---

### Cara Upload Step by Step

1. Buka dashboard di browser → klik menu **Upload & Otomatis** (ikon cloud atas)
2. Pilih **nama toko** (misal: `custombase`, `ventura`, `memora`)
3. Pilih **jenis file** (Pesanan / Income / SKU)
4. Klik **Pilih File** → arahkan ke file Excel dari TikTok
5. Klik **Upload**
6. Dashboard otomatis refresh dengan data terbaru ✅

> 💡 **Aman untuk upload ulang:** File yang sama bisa di-upload berkali-kali tanpa takut data ganda. Sistem otomatis mendeteksi dan memperbarui data yang sudah ada.

---

## 📊 Memahami Kartu-Kartu di Dashboard

### ⚡ Mode Tampilan — Penting Dipahami!

Dashboard punya **2 mode** yang bisa kamu pilih dengan tombol di bagian atas:

| Mode | Nama | Penjelasan |
|------|------|-----------|
| 💰 **Kas Nyata** | Settlement Mode *(default)* | Hanya order yang uangnya **sudah benar-benar cair** ke rekening kamu |
| 📦 **Proyeksi** | Accrual Mode | Termasuk order yang **masih dikirim** (uang belum cair, tapi kemungkinan besar akan cair) |

> **Rekomendasi:**
> - Gunakan **Kas Nyata** → untuk evaluasi profit dan keputusan bisnis (gas iklan, tambah stok, dll.)
> - Gunakan **Proyeksi** → untuk estimasi di bulan yang masih berjalan

---

### 📋 Penjelasan Setiap Kartu

| Kartu | Formula | Keterangan Mudah |
|-------|---------|-----------------|
| **Order Selesai** | COUNT status Selesai | Berapa paket yang berhasil diterima pembeli |
| **Omzet Kotor** | SUM harga jual × qty | Total nilai penjualan sebelum potongan apapun |
| **Diskon Seller** | SUM diskon yang kamu tanggung | Potongan voucher / diskon yang kamu bayar sendiri |
| **Omzet Net** | Omzet Kotor − Diskon Seller | Pendapatan setelah dikurangi diskon dari kantong kamu |
| **Settlement Cair** | Dari file Income Statement | Uang yang sudah nyata masuk rekening dari TikTok ✅ |
| **Dana Tertahan** | Order belum ada data pencairan | Uang yang akan datang tapi belum cair — klik untuk lihat detail |
| **Potongan Platform** | Fee TikTok dari Income | Biaya jasa TikTok yang otomatis dipotong dari transaksi |
| **Paket Retur/Cancel** | COUNT retur + cancel | Jumlah paket yang dikembalikan pembeli atau dibatalkan |
| **HPP + Packing** | SUM(qty × HPP) + packing cost | Total biaya produksi + ongkos kirim kamu — klik untuk lihat per SKU |
| **Profit Marketplace** | Settlement − Platform − HPP − Packing − Iklan | **Profit bersih** setelah semua biaya ✅ |

---

## 🔍 Fitur Drilldown (Detail)

Klik kartu mana saja untuk melihat detailnya lebih dalam:

| Kartu yang Diklik | Yang Akan Muncul |
|------------------|-----------------|
| **Dana Tertahan** | Daftar order yang belum cair, umur order (hari), estimasi kapan cair |
| **HPP + Packing** | Rincian per SKU: qty terhitung (non-cancel), HPP total, packing total, status HPP |
| **Settlement Cair** | Detail transaksi pencairan dari income statement |
| **Order Selesai** | Daftar order level dengan status dan nilai |

---

## 🏪 Multi-Toko

### Toko yang Sudah Didukung
`ventura` · `custombase` · `giftyours` · `cetakin` · `memora` · `piksera` · `tempelin`

### Tambah Toko Baru
1. Buka menu **Upload & Otomatis** → bagian **Daftar Toko**
2. Ketik nama toko baru → klik **Tambah**
3. Upload data awal untuk toko tersebut

### Lihat Semua Toko Sekaligus
Pilih filter **"Semua Toko"** di dropdown toko untuk melihat agregat semua toko.

---

## 👥 Level Akses

Gunakan URL yang berbeda untuk level akses berbeda:

| URL | Nama Akses | Yang Bisa Dilihat | Cocok untuk |
|-----|-----------|-------------------|-------------|
| `http://localhost:9876/` | **Owner** | Semua data termasuk profit dan HPP | Pemilik bisnis |
| `http://localhost:9876/team` | **Tim** | Operasional tanpa profit & HPP rahasia | Admin, CS, gudang |
| `http://localhost:9876/tv` | **TV Kantor** | Tampilan besar untuk monitor/TV | Layar kantor/gudang |

> 🔐 **Keamanan:** Halaman Owner meminta PIN. Atur PIN dari menu Pengaturan di dashboard.

---

## 📡 Telegram Bot (Opsional)

Terima ringkasan keuangan otomatis setiap pagi langsung ke Telegram:

### Cara Setup:
1. Buka Telegram → cari **@BotFather** → ketik `/newbot` → ikuti instruksi → salin **Bot Token**
2. Mulai chat dengan bot kamu → dapatkan **Chat ID** (bisa pakai **@userinfobot**)
3. Buka dashboard → menu **Upload & Otomatis** → tab **Telegram**
4. Isi Bot Token & Chat ID → klik **Simpan**
5. Klik **Test Telegram** untuk coba kirim ringkasan sekarang

---

## 🌐 Akses Dashboard dari Mana Saja (Cloudflare Tunnel)

Jika kamu ingin mengakses dashboard dari HP atau komputer lain tanpa server VPS, gunakan **Cloudflare Tunnel** secara gratis:

### Prasyarat
- Install Cloudflare Tunnel: [download cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)

### Jalankan Tunnel
```bash
cloudflared tunnel --url http://localhost:9876
```
Nanti akan muncul URL publik seperti `https://random-name.trycloudflare.com` yang bisa diakses dari mana saja.

### Tunnel Permanen (dengan domain sendiri)
Gunakan file `start-dashboard.bat` yang sudah dikonfigurasi dengan Cloudflare Tunnel permanen ke domain kamu.

---

## 🗄️ Database & Penyimpanan

Dashboard mendukung **3 mode database**:

| Mode | Kapan Dipakai | Cara Setup |
|------|--------------|-----------|
| **SQLite Lokal** | Development / penggunaan lokal | Otomatis, tidak perlu konfigurasi |
| **Turso** (Disarankan untuk cloud) | Server VPS / akses online | Isi `TURSO_URL` + `TURSO_TOKEN` di `.env` |
| **PostgreSQL** (Supabase) | Legacy / tim besar | Isi `DATABASE_URL` di `.env` |

> 💡 Untuk penggunaan **lokal di komputer sendiri**, SQLite sudah cukup dan tidak perlu konfigurasi apapun.

### Backup Data

Database tersimpan di `data/finance.db`. Backup cukup copy file ini:

```bash
# Windows
copy data\finance.db data\finance-backup-2026-09-09.db

# Mac / Linux
cp data/finance.db data/finance-backup-2026-09-09.db
```

---

## 📁 Struktur Folder (Untuk Developer)

```
dashboard-keuangan-tiktok/
│
├── 📂 api/                          # API endpoints (Vercel-style handlers)
│   ├── summary.js                   # Kalkulasi utama: omzet, profit, dana tertahan
│   ├── upload.js                    # Upload file order / income / SKU
│   ├── skus.js                      # CRUD data HPP per SKU
│   ├── accounting.js                # Laporan akuntansi detail
│   ├── ad-spend.js                  # Data biaya iklan
│   ├── stores.js                    # Manajemen multi-toko
│   ├── split-data.js                # Split & re-import data
│   ├── telegram-daily.js            # Kirim ringkasan ke Telegram
│   ├── health.js                    # Status server & DB
│   ├── product-profitability.js     # Profitabilitas per produk
│   └── ...                          # Lainnya
│
├── 📂 lib/
│   ├── finance-cloud.js             # 🧠 Engine kalkulasi utama (core logic, 3000+ baris)
│   └── pg-connector.js              # Abstraksi database (SQLite / Turso / PostgreSQL)
│
├── 📂 static/
│   ├── index.html                   # Halaman dashboard utama
│   ├── app.js                       # Frontend logic (filter, render, drilldown)
│   └── styles.css                   # Desain & tampilan dashboard
│
├── 📂 scripts/                      # Utility scripts untuk import & maintenance
│   ├── ultimate-import.js           # Import massal otomatis
│   ├── import-ads.js                # Import data iklan
│   ├── rebuild-import.js            # Rebuild semua data dari awal
│   ├── corrected-import.js          # Import dengan koreksi data
│   ├── packing-reconcile.js         # Rekonsiliasi biaya packing
│   ├── analisa-custombase-juli.js   # Analisa khusus toko custombase
│   └── ...                          # Lainnya (~40 scripts)
│
├── 📂 tests/                        # Test suite & verifikasi
│   ├── finance-regression.test.js   # Regression test kalkulasi keuangan
│   ├── acceptance-suite.js          # Full acceptance test
│   ├── final-acceptance.js          # Final acceptance sebelum production
│   ├── comprehensive-report.js      # Laporan lengkap
│   └── ...                          # Lainnya (~24 test files)
│
├── 📂 data/                         # Database (otomatis dibuat, di-gitignore)
│   └── finance.db                   # SQLite database
│
├── server.js                        # HTTP server utama (Node.js native)
├── package.json                     # Dependency & npm scripts
├── .env.example                     # Template konfigurasi
├── .env                             # Konfigurasi lokal (jangan di-commit!)
├── vercel.json                      # Konfigurasi deploy ke Vercel
├── start-dashboard.bat              # 🖱️ Double-click untuk jalankan dashboard (Windows)
├── start-server.bat                 # Start server saja
└── start-tunnel.bat                 # Start Cloudflare Tunnel saja
```

---

## 🧪 Menjalankan Tests

```bash
# Regression test kalkulasi keuangan
node tests/finance-regression.test.js

# Full acceptance test
node tests/acceptance-suite.js

# Laporan final
node tests/final-acceptance.js

# Atau jalankan semua via npm
npm test
```

---

## 🛠️ Scripts Utility

Scripts di folder `scripts/` digunakan untuk maintenance dan import manual:

```bash
# Import semua data dari file Excel secara massal
node scripts/ultimate-import.js

# Import data iklan
node scripts/import-ads.js

# Import data iklan bulan Juli
node scripts/import-ads-juli.js

# Rebuild seluruh data dari awal (hati-hati: hapus & import ulang)
node scripts/rebuild-import.js

# Rekonsiliasi biaya packing
node scripts/packing-reconcile.js

# Analisa data toko custombase
node scripts/analisa-custombase-juli.js

# Cek konfigurasi database
node scripts/debug-config.js

# Upload data cetakin
node scripts/upload-cetakin.js

# Scan file Excel di folder
node scripts/scan-files.js
```

---

## ⚙️ Konfigurasi Lengkap (.env)

```env
# ═══════════════════════════════════════
# PORT SERVER
# ═══════════════════════════════════════
PORT=9876

# ═══════════════════════════════════════
# DATABASE (pilih salah satu)
# ═══════════════════════════════════════

# Opsi 1: SQLite Lokal (default, tidak perlu isi apapun)
# Otomatis buat data/finance.db

# Opsi 2: Turso (Disarankan untuk production — gratis)
# Daftar di https://turso.tech
TURSO_URL=libsql://nama-database-orgmu.turso.io
TURSO_TOKEN=token_auth_turso_kamu

# Opsi 3: PostgreSQL / Supabase (legacy)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# ═══════════════════════════════════════
# TELEGRAM BOT (opsional)
# ═══════════════════════════════════════
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGhijklMNOpqrstUVWXyz
TELEGRAM_CHAT_ID=-1001234567890

# ═══════════════════════════════════════
# FOLDER MONITOR (opsional)
# ═══════════════════════════════════════
# FOLDER_MONITOR_PATH=C:\Users\Kamu\Downloads\TikTok
```

---

## 🛠️ Tech Stack

| Komponen | Teknologi | Keterangan |
|----------|-----------|-----------|
| **Runtime** | Node.js 18+ | Server & kalkulasi |
| **Server** | Node.js HTTP native | Tanpa framework (ringan, zero dependency) |
| **Database Lokal** | SQLite via better-sqlite3 | Zero config, file tunggal |
| **Database Cloud** | Turso (libSQL) | Compatible dengan SQLite, bisa online |
| **Database Legacy** | PostgreSQL (Supabase) | Untuk tim yang butuh concurrent access |
| **Frontend** | Vanilla HTML/CSS/JavaScript | Tanpa framework, cepat & ringan |
| **File Parser** | xlsx library | Baca file Excel (.xlsx) dari TikTok |
| **Tunnel** | Cloudflare Tunnel | Akses online tanpa server publik |
| **Notifikasi** | Telegram Bot API | Kirim ringkasan harian otomatis |

---

## ❓ FAQ — Pertanyaan yang Sering Ditanyakan

**Q: Apakah data saya aman? Apakah dikirim ke internet?**
> A: Semua data tersimpan **lokal di komputer kamu** dalam file `data/finance.db`. Tidak ada data yang dikirim ke server eksternal kecuali kamu sendiri mengkonfigurasi Turso/Supabase atau Telegram.

**Q: Kenapa "Dana Tertahan" di filter ALL lebih kecil dari filter satu bulan?**
> A: Ini sudah diperbaiki dan sekarang bersifat additive. Jika masih berbeda, lakukan hard-refresh di browser (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**Q: Kenapa HPP tidak terhitung untuk beberapa order?**
> A: Hanya order **non-cancel** yang masuk perhitungan HPP. Order yang dibatalkan tidak dibebankan HPP karena barang kembali ke tangan kamu. Kolom "Qty Terhitung" di drilldown menunjukkan berapa unit yang dihitung.

**Q: Apa bedanya mode Kas Nyata vs Proyeksi?**
> A: **Kas Nyata (Settlement)** = hanya order yang uangnya sudah cair ke rekening dari TikTok. **Proyeksi (Accrual)** = termasuk order yang masih dalam pengiriman. Gunakan Kas Nyata untuk keputusan bisnis.

**Q: Bisakah upload data tanpa internet?**
> A: Ya! Semua data tersimpan di SQLite lokal. Internet hanya dibutuhkan saat setup awal (`npm install`) dan jika menggunakan Telegram / Turso.

**Q: Bagaimana cara reset atau hapus semua data?**
> A: Hapus file `data/finance.db`. Server akan membuat database kosong baru saat dijalankan ulang.

**Q: Bisa diakses dari HP atau komputer lain di jaringan yang sama?**
> A: Ya! Akses via IP komputer kamu di jaringan lokal: `http://192.168.x.x:9876`. Atau gunakan Cloudflare Tunnel untuk akses dari mana saja via internet.

**Q: Biaya iklan GMV Max vs Top-up bedanya apa?**
> A: **Iklan GMV Max** = potongan otomatis oleh TikTok dari setiap transaksi (muncul di Income Statement). **Iklan Top-up** = kamu transfer manual ke saldo iklan TikTok. Keduanya dilacak secara terpisah di dashboard.

**Q: Bagaimana cara menambah toko baru?**
> A: Masuk ke **Upload & Otomatis** → tab **Daftar Toko** → ketik nama toko → klik Tambah. Lalu upload data awal untuk toko tersebut.

---

## 🔄 Update & Maintenance

### Update ke Versi Terbaru
```bash
git pull origin main
npm install
```

### Cek Status Database
```bash
node scripts/debug-config.js
```

### Rebuild Data dari Awal
```bash
# ⚠️ Hati-hati: ini akan menghapus dan import ulang semua data
node scripts/rebuild-import.js
```

---

## 🤝 Kontribusi & Pengembangan

Project ini dikembangkan untuk **kebutuhan internal Sukses Digital Media**. Jika ingin berkontribusi:

1. Fork repository
2. Buat branch baru: `git checkout -b fitur/nama-fitur`
3. Commit perubahan: `git commit -m 'feat: tambah fitur X'`
4. Push ke branch: `git push origin fitur/nama-fitur`
5. Buat Pull Request

### Roadmap Pengembangan
Lihat file [`ROADMAP_PENGEMBANGAN.md`](ROADMAP_PENGEMBANGAN.md) untuk rencana fitur ke depan.

---

## 📝 Catatan Penting

- **File `.env`** tidak pernah di-push ke GitHub (sudah ada di `.gitignore`) — jaga rahasia konfigurasi kamu!
- **File Excel / database** tidak di-push ke GitHub — data bisnis kamu tetap privat
- **Backup rutin** file `data/finance.db` sangat disarankan

---

## 📄 Lisensi

Hak Cipta © 2026 **Sukses Digital Media**. Seluruh hak cipta dilindungi.

Proyek ini merupakan **kepemilikan eksklusif Sukses Digital Media** dan dikembangkan untuk kebutuhan internal. Dilarang mendistribusikan, memodifikasi, atau menggunakan ulang tanpa izin tertulis dari pemilik.

---

*Dibuat dengan ❤️ oleh Tim Sukses Digital Media untuk seller TikTok Shop Indonesia*

*Last updated: September 2026*
