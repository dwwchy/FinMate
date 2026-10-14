# 💰 FinMate — Tracker Keuangan Bersama

> **Aplikasi Pencatat & Pengelola Keuangan Bersama Modern, Pastel Blue Edition, Offline-First PWA, Terhubung ke Google Drive & Google Cloud Console.**

FinMate dirancang khusus untuk mempermudah pencatatan kas bersama, iuran kontrakan, kos-kosan, keluarga, komunitas, maupun proyek tim secara transparan, rapi, dan otomatis.

---

## 🌟 Fitur Utama

- 📱 **Progressive Web App (PWA) Siap Pasang**: Tombol install langsung di pojok atas header untuk dipasang di HP (Android/iOS) dan Laptop (Windows/Mac).
- ☁️ **Login Resmi Google & Pencadangan Google Drive**:
  - Pop-up Google otentik langsung mendeteksi akun di perangkat.
  - Sinkronisasi otomatis ke folder **`Finance Tracker Bersama`** di Google Drive pengguna.
  - Kompatibel dengan **Google Cloud Console OAuth 2.0 Client ID**.
- 👥 **Sistem Kas Bersama (Multi-User & Multi-Rekening)**:
  - Kelola banyak rekening / dompet kas (BCA, Mandiri, BRI, GoPay, OVO, Kas Tunai, dll.).
  - Pisahkan transaksi berdasarkan iuran masuk (*income*) dan pengeluaran kas bersama (*expense*).
- 🧾 **Unggah Bukti Nota / Struk**:
  - Kompresi canvas cerdas agar bukti transaksi ringan dan hemat kuota/penyimpanan.
  - Pratinjau nota transaksi langsung di aplikasi.
- 🤖 **FinMate AI — Evaluasi Kas Akhir Bulan**:
  - Skor kesehatan kas otomatis (0 - 100).
  - Breakdown pos pengeluaran dominan.
  - Rekomendasi taktis AI & tombol salin ringkasan ke format chat WhatsApp.
- 🎨 **Desain Pastel Blue Modern**:
  - Tema Gelap (*Dark Mode*) & Tema Terang (*Light Mode*) dengan transisi halus.
  - Format angka ribuan dengan titik real-time (contoh: `Rp 50.000`).

---

## 🚀 Menjalankan Secara Lokal

1. **Jalankan via Batch File**:
   Klik dua kali `JALANKAN_APLIKASI_LOCALHOST.bat`

2. **Atau jalankan via Node.js**:
   ```bash
   node server.js
   ```
   Aplikasi akan terbuka di: `http://localhost:5600`

---

## 🌐 Publikasi ke GitHub Pages

Proyek ini telah dikonfigurasi 100% menggunakan tautan relatif dan Service Worker mandiri, sehingga siap dipublikasikan di **GitHub Pages**:

1. Buat repositori baru di GitHub (misal: `finmate` atau `tracker-keuangan-bersama`).
2. Unggah seluruh berkas di repositori tersebut.
3. Buka **Settings** -> **Pages**.
4. Di bagian **Build and deployment / Branch**, pilih branch `main` dan folder `/(root)`, lalu klik **Save**.
5. Aplikasi akan aktif di URL:
   `https://<username>.github.io/<nama-repo>/`
