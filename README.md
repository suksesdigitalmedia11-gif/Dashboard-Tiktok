# 📊 Dashboard Keuangan TikTok

> **Sistem monitoring keuangan real-time untuk seller TikTok Shop** — Pantau omzet, profit, HPP, dana tertahan, dan iklan dari semua toko dalam satu dashboard.

![Dashboard Preview](static/preview.png)

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|-------|-----------|
| 💰 **Omzet & Profit Real** | Lihat omzet kotor, diskon seller, omzet net, dan profit bersih |
| 📦 **HPP + Packing per SKU** | Biaya produksi dan packing dihitung otomatis per produk, hanya untuk order yang berhasil (bukan cancel) |
| 🔒 **Dana Tertahan** | Lihat order mana yang sudah Selesai/Dikirim tapi uangnya belum cair, beserta estimasi kapan cair |
| 📈 **Iklan TikTok** | Lacak biaya iklan GMV (dipotong TikTok) dan iklan top-up (transfer manual) |
| 🏪 **Multi-Toko** | Dukung banyak toko sekaligus, bisa filter per toko atau lihat semua |
| 🕐 **Multi-Periode** | Filter All, 7 Hari, 14 Hari, Bulan Ini, Pilih Bulan, atau Range Custom |
| 📡 **Telegram Bot** | Terima ringkasan keuangan otomatis setiap pagi via Telegram |
| 🔍 **Drilldown Detail** | Klik kartu manapun untuk melihat detail order-level |
| 👥 **Multi-Role** | Owner (full access), Tim (tanpa data rahasia), TV Kantor (display mode) |

---

## 🚀 Cara Menjalankan (Pertama Kali)

### Prasyarat
- **Node.js** versi 18 ke atas → [Download di nodejs.org](https://nodejs.org)
- Git (opsional, untuk clone)

### Langkah-langkah

**1. Clone atau download project**
```bash
git clone https://github.com/Rzkyjlnsyh/dashboard-keuangan-tiktok.git
cd dashboard-keuangan-tiktok
```

**2. Install dependencies**
```bash
npm install
```

**3. Jalankan server**
```bash
node server.js
```

**4. Buka browser, ketik:**
```
http://localhost:9876
```

> ✅ Dashboard siap digunakan! Database SQLite dibuat otomatis di folder `data/`.

---

## 📁 Struktur Folder

```
dashboard-keuangan-tiktok/
├── api/                  # Endpoint API (upload, summary, skus, dll)
│   ├── summary.js        # Kalkulasi utama: omzet, profit, dana tertahan
│   ├── upload.js         # Proses upload file order/income/SKU
│   ├── skus.js           # CRUD data HPP per SKU
│   └── ...
├── lib/
│   ├── finance-cloud.js  # Engine kalkulasi keuangan (core logic)
│   └── pg-connector.js   # Koneksi database (SQLite lokal)
├── static/
│   ├── index.html        # Halaman utama dashboard
│   ├── app.js            # Frontend logic (filter, render, drilldown)
│   └── styles.css        # Styling dashboard
├── data/
│   └── finance.db        # Database SQLite (dibuat otomatis)
├── server.js             # HTTP server utama
└── .env                  # Konfigurasi (API key, port, dll)
```

---

## 📤 Cara Upload Data

Dashboard membaca 3 jenis file dari TikTok Shop:

### 1. 📋 File Pesanan (Order)
- Sumber: Unduh dari **Seller Center TikTok → Pesanan → Ekspor**
- Format: Excel (`.xlsx`)
- Berisi: nomor order, SKU, qty, harga, status, tanggal

### 2. 💳 File Income / Pencairan
- Sumber: Unduh dari **Seller Center TikTok → Keuangan → Income Statement**
- Format: Excel (`.xlsx`) atau CSV
- Berisi: konfirmasi uang yang sudah cair ke rekening

### 3. 💲 File HPP (Harga Pokok Produksi)
- Format: Excel sesuai template
- Berisi: kode SKU, HPP per unit, biaya packing per unit
- Bisa dikelola langsung dari menu **Detail SKU** di dashboard

**Cara upload:**
1. Klik menu **Upload & Otomatis**
2. Pilih toko (misal: `custombase`, `ventura`)
3. Pilih file → klik **Upload**
4. Dashboard otomatis refresh dengan data terbaru

> 💡 Upload ulang file yang sama aman — data akan diperbarui, bukan digandakan.

---

## 📊 Penjelasan Kartu-Kartu Dashboard

### Mode Tampilan (Penting Dipahami!)

Dashboard punya 2 mode tampilan yang bisa dipilih:

| Mode | Tombol | Arti |
|------|--------|------|
| **💰 Kas Nyata** | *(default)* | Hanya order yang uangnya sudah **benar-benar cair** ke rekening |
| **📦 Proyeksi** | *(opsional)* | Termasuk order yang masih dalam pengiriman (belum cair, tapi kemungkinan besar akan cair) |

> **Rekomendasi:** Gunakan mode **Kas Nyata** untuk keputusan bisnis (mau gas iklan, evaluasi profit, dll). Gunakan **Proyeksi** hanya untuk estimasi di bulan yang masih berjalan.

---

### Penjelasan Setiap Kartu

| Kartu | Rumus / Sumber Data | Keterangan |
|-------|-------------------|------------|
| **Order Selesai** | COUNT order status Selesai | Jumlah paket yang sudah diterima pembeli |
| **Omzet Kotor** | SUM harga jual × qty | Total penjualan sebelum potongan apapun |
| **Diskon Seller** | SUM diskon yang kamu tanggung | Potongan voucher/diskon yang kamu bayar |
| **Omzet Net** | Omzet Kotor − Diskon Seller | Pendapatan bersih setelah diskon seller |
| **Settlement Cair** | Dari file Income Statement | Uang yang sudah nyata masuk rekening dari TikTok |
| **Dana Tertahan** | Order belum ada data pencairan | Uang yang akan datang tapi belum cair (klik untuk lihat detail order) |
| **Potongan Platform** | Platform fee dari Income | Biaya jasa TikTok yang dipotong dari transaksi |
| **Paket Retur/Cancel** | COUNT paket retur + cancel | Jumlah paket yang dikembalikan/dibatalkan |
| **HPP + Packing** | SUM(qty × HPP/unit) + packing | Total biaya produksi + ongkos kirim dalam (klik untuk lihat per SKU) |
| **Profit Marketplace** | Settlement − Platform − HPP − Packing − Iklan | Profit bersih setelah semua potongan |

---

## 🔍 Fitur Drilldown

Klik kartu manapun untuk melihat detail lebih dalam:

- **Dana Tertahan** → Daftar order yang belum cair, lengkap dengan umur order, estimasi kapan cair, dan link tracking
- **HPP + Packing** → Rincian biaya per SKU: berapa qty terhitung (non-cancel), HPP total, packing total, dan status HPP (sudah lengkap/belum)
- **Settlement** → Detail transaksi pencairan dari income statement
- **Order Selesai** → Daftar order level

---

## 🏪 Multi-Toko

Daftarkan toko baru dari **Upload & Otomatis → Daftar Toko**. Setelah toko terdaftar:
- Upload data per toko (pilih nama toko saat upload)
- Filter dashboard per toko atau lihat semua sekaligus
- Perbandingan performa antar toko tersedia di tab **Per Toko**

---

## 👥 Mode Akses

| URL | Akses | Cocok untuk |
|-----|-------|-------------|
| `http://localhost:9876/` | **Owner** — semua data, termasuk profit dan HPP | Pemilik bisnis |
| `http://localhost:9876/team` | **Tim** — tanpa profit dan HPP rahasia | Admin, CS, gudang |
| `http://localhost:9876/tv` | **TV Kantor** — tampilan monitor, data operasional | Layar kantor/gudang |

---

## 📡 Telegram Bot (Opsional)

Dapatkan ringkasan keuangan otomatis setiap pagi di Telegram:

1. Buka Telegram → cari **@BotFather** → buat bot baru → salin **Bot Token**
2. Mulai chat dengan bot kamu → dapatkan **Chat ID** (bisa pakai `@userinfobot`)
3. Di dashboard → **Upload & Otomatis** → isi Bot Token & Chat ID → Simpan
4. Klik **Test Telegram** untuk coba kirim ringkasan sekarang

---

## ⚙️ Konfigurasi (File .env)

Buat file `.env` di root folder jika ingin konfigurasi kustom:

```env
# Port server (default: 9876)
PORT=9876

# Telegram Bot (opsional)
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx

# Folder monitor otomatis (opsional)
FOLDER_MONITOR_PATH=/path/ke/folder/download
```

---

## 🗄️ Cara Backup Data

Database tersimpan di `data/finance.db` (format SQLite). Backup cukup copy file ini.

```bash
# Backup manual
copy data\finance.db data\finance-backup-20260820.db
```

---

## ❓ FAQ — Pertanyaan Umum

**Q: Kenapa "Dana Tertahan" di filter ALL lebih kecil dari filter satu bulan?**
> A: Ini sudah diperbaiki dan sekarang additive. ALL = penjumlahan semua bulan yang ada datanya. Jika masih berbeda, pastikan browser sudah hard-refresh (`Ctrl+Shift+R`).

**Q: Kenapa HPP tidak terhitung untuk beberapa order?**
> A: Hanya order non-cancel yang masuk HPP. Kolom "Qty Terhitung" menampilkan berapa unit yang dihitung (non-cancel). Order cancel tidak dibebankan HPP karena produk dikembalikan.

**Q: Apa bedanya mode Kas Nyata vs Proyeksi?**
> A: **Kas Nyata (Settlement)** = hanya order yang uangnya sudah cair dari TikTok. **Proyeksi (Accrual)** = termasuk order masih Dikirim, cocok untuk estimasi di bulan yang sedang berjalan.

**Q: Bisakah saya upload data tanpa internet?**
> A: Ya! Semua data tersimpan di SQLite lokal (`data/finance.db`). Tidak butuh koneksi internet sama sekali.

**Q: Bagaimana cara reset/hapus data?**
> A: Hapus file `data/finance.db`. Server akan membuat database baru saat dijalankan ulang.

---

## 🛠️ Tech Stack

| Komponen | Teknologi |
|----------|----------|
| Runtime | Node.js 18+ |
| Database | SQLite (via better-sqlite3) |
| Frontend | Vanilla HTML/CSS/JavaScript |
| Server | Node.js HTTP (tanpa framework) |
| Tunnel | Cloudflare Tunnel (untuk akses online) |

---

## 📝 Lisensi

Proyek ini untuk penggunaan internal bisnis. Tidak untuk disebarluaskan tanpa izin.

---

*Dibuat dengan ❤️ untuk seller TikTok Indonesia*
