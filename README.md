# Sistem Informasi Inventaris Laboratorium TKJ

Aplikasi web pendataan dan monitoring peralatan Laboratorium Teknik Komputer dan Jaringan, bertema retro VHS.

- **Frontend:** HTML, CSS, JavaScript murni di GitHub Pages
- **Backend:** Google Apps Script (Web App)
- **Database:** Google Sheets (privat)
- **Login:** Google Sign-In, token diverifikasi di server

## 1. Isi repository

| File | Fungsi |
|---|---|
| `index.html`, `style.css` | kerangka halaman dan tema VHS |
| `script.js` | konfigurasi, komunikasi API, login, router, komponen bersama |
| `modul-dashboard.js`, `modul-barang.js`, `modul-transaksi.js`, `modul-peminjaman.js`, `modul-pemeliharaan.js`, `modul-laporan.js`, `modul-admin.js` | modul layar (urutan pemuatan diatur di `index.html`) |
| `Code.gs`, `appsscript.json` | backend, **ditempel ke Apps Script, bukan diunggah ke GitHub** (boleh disimpan di repo sebagai arsip, tanpa data rahasia) |

Ada dua kolom di luar rancangan awal yang dibuat otomatis oleh `setupDatabase()`: `status_aktif` (sheet `Barang`) dan `jumlah_unit` (sheet `Pemeliharaan`).

## 2. Siapkan Google Sheets

1. Buka <https://sheets.google.com> dengan **akun yang akan menjadi pemilik sistem**, lalu buat spreadsheet kosong, misalnya "Database Inventaris Lab TKJ".
2. Salin **ID spreadsheet** dari URL: `https://docs.google.com/spreadsheets/d/`**`ID_ADA_DI_SINI`**`/edit`.
3. Jangan bagikan spreadsheet ke publik. Backend berjalan atas nama pemilik, sehingga spreadsheet tetap privat.
4. Delapan sheet (`Barang`, `Transaksi`, `Peminjaman`, `Pemeliharaan`, `Kategori`, `Lokasi`, `Pengguna`, `LogAktivitas`) dibuat otomatis pada langkah 4. Sheet bawaan "Sheet1" boleh Anda hapus manual; sistem tidak menghapus apa pun.

## 3. Buat Google OAuth Client ID

Client ID dipakai agar browser bisa meminta token login Google. **Client ID bukan rahasia.** Jangan membuat atau menyimpan "client secret" di aplikasi ini.

1. Buka <https://console.cloud.google.com>, buat project baru (mis. "Inventaris Lab TKJ").
2. **APIs & Services → OAuth consent screen.**
   - Akun Google Workspace sekolah: pilih **Internal** (hanya akun domain sekolah yang bisa masuk).
   - Akun Gmail biasa: pilih **External**. Selama status "Testing", hanya email yang didaftarkan di **Test users** yang bisa masuk. Tambahkan semua email pengguna di sana, atau ubah ke "In production".
   - Isi nama aplikasi dan email dukungan, lalu simpan.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. Pada **Authorized JavaScript origins** tambahkan:
   - `https://NAMA-GITHUB-ANDA.github.io` (hanya domain, **tanpa** path repository dan tanpa garis miring di akhir)
   - `http://localhost:8000` jika ingin menguji di komputer sendiri
5. Biarkan "Authorized redirect URIs" kosong, lalu **Create**. Salin **Client ID** (berakhiran `.apps.googleusercontent.com`).

## 4. Pasang backend di Google Apps Script

1. Buka <https://script.google.com> dengan akun pemilik spreadsheet → **New project**. Beri nama, mis. "Backend Inventaris TKJ".
2. Ganti isi `Code.gs` dengan isi file `Code.gs` dari repository ini.
3. **Project Settings (ikon roda gigi) → centang "Show appsscript.json manifest file in editor"**, kembali ke Editor, buka `appsscript.json`, lalu ganti isinya dengan file `appsscript.json` dari repository ini. Manifest ini mengatur zona waktu `Asia/Makassar` dan izin minimum.
4. **Project Settings → Script Properties → Add script property:**

| Properti | Nilai | Wajib |
|---|---|---|
| `SPREADSHEET_ID` | ID dari langkah 2 | ya |
| `GOOGLE_CLIENT_ID` | Client ID dari langkah 3 | ya |
| `ADMIN_EMAIL_AWAL` | email Google admin pertama | ya (saat setup) |
| `ALLOWED_DOMAIN` | mis. `smkn1contoh.sch.id` (pisahkan koma jika lebih dari satu) | tidak |

   Script Properties hanya menyimpan konfigurasi. Itu **bukan** sistem autentikasi.
5. Di editor, pilih fungsi **`setupDatabase`** → **Run**. Berikan otorisasi saat diminta. Jika muncul peringatan "Google hasn't verified this app", pilih **Advanced → Go to (nama project) (unsafe)**; ini wajar karena skrip Anda sendiri.
6. Jalankan **`cekKonfigurasi`** dan lihat hasilnya di Execution log. Semua properti wajib harus "terisi" dan setiap sheet "OK".
7. (Opsional, hanya untuk uji coba) jalankan **`seedDemoData`** untuk mengisi data contoh. Fungsi ini menolak jalan bila sheet `Barang` sudah berisi data. Data demo tidak pernah masuk otomatis.
8. **Deploy → New deployment → ikon roda gigi → Web app:**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
9. Klik **Deploy**, lalu salin **Web app URL** yang berakhiran `/exec`.
10. Uji di browser: buka URL tersebut. Hasil yang benar berupa JSON `{"success":true,"message":"Layanan Inventaris Lab TKJ aktif.",...}`.

**Mengapa "Anyone"?** Browser di GitHub Pages tidak membawa sesi Google ke Apps Script, jadi endpoint harus bisa dijangkau. Artinya **siapa pun yang tahu URL bisa mengirim permintaan**. Keamanan datang dari server, bukan dari URL yang sulit ditebak: setiap aksi data wajib membawa token Google yang valid, emailnya harus terdaftar dan aktif di sheet `Pengguna`, dan hak akses per peran diperiksa di backend. Permintaan `GET` hanya mengembalikan status layanan.

**Memperbarui backend:** setelah mengubah `Code.gs`, pilih **Deploy → Manage deployments → ikon pensil → Version: New version → Deploy**. URL tidak berubah. Tanpa langkah ini, perubahan kode tidak aktif di Web App.

## 5. Pasang frontend di GitHub Pages

1. Buat repository GitHub (publik, agar Pages gratis), mis. `inventaris-lab-tkj`.
2. Buka `script.js`, ubah bagian `CONFIG`:
   ```js
   BACKEND_URL: 'https://script.google.com/macros/s/XXXX/exec',
   GOOGLE_CLIENT_ID: 'XXXX.apps.googleusercontent.com',
   ```
   Hanya dua nilai ini yang perlu diubah, dan keduanya memang publik. **Jangan** menaruh password, token, atau kunci lain di repository.
3. Unggah `index.html`, `style.css`, `script.js`, dan semua file `modul-*.js` ke cabang `main` (Add file → Upload files → Commit).
4. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.**
5. Tunggu 1 sampai 3 menit, lalu buka `https://NAMA-GITHUB-ANDA.github.io/inventaris-lab-tkj/`.
6. Pastikan origin `https://NAMA-GITHUB-ANDA.github.io` sudah terdaftar di langkah 3.4.
7. Layar login menampilkan status "Backend terhubung". Masuk dengan email admin, lalu jalankan skenario di `PENGUJIAN.md`.

**Memperbarui aplikasi:** ubah file di repository (ikon pensil atau unggah ulang), commit, tunggu Pages selesai, lalu muat ulang dengan **Ctrl+Shift+R** (di ponsel: hapus cache situs).

## 6. Peran dan hak akses

| Peran | Dapat melakukan |
|---|---|
| **Admin** | semua: barang, transaksi, peminjaman, pemeliharaan, kategori, lokasi, laporan, pengguna, log aktivitas |
| **Petugas Laboratorium** | barang (tambah, ubah, hapus), transaksi, peminjaman, pemeliharaan, semua laporan, melihat kategori dan lokasi |
| **Viewer** | dashboard, data barang (lihat), laporan inventaris, kategori, kondisi, lokasi |

Kebijakan ini ada di tabel `ACTIONS` pada `Code.gs`. Menu yang tidak diizinkan memang disembunyikan di frontend, tetapi penjagaan sebenarnya ada di backend.

## 7. Aturan stok

- **Jumlah total:** unit fisik yang tercatat sebagai aset (termasuk yang dipinjam atau rusak).
- **Dipinjam:** naik saat peminjaman, turun saat pengembalian atau pembatalan.
- **Tersedia** = total − dipinjam, hanya jika kondisi **Baik** atau **Rusak Ringan**. Kondisi Rusak Berat, Dalam Perbaikan, atau Tidak Diketahui membuat tersedia = 0.
- Barang keluar, pengurangan, penghapusan aset, dan pemindahan hanya boleh sebesar (total − dipinjam).
- **Kondisi bercampur:** kondisi disimpan per baris. Jika sebagian unit dikembalikan rusak, dipindah lokasi, atau diperbaiki, baris dipecah otomatis dengan kode berakhiran `-S01`, `-S02`, dan seterusnya. Pemisahan dicatat di `LogAktivitas`.
- **Peminjaman terlambat** dihitung dari rencana tanggal kembali, bukan disimpan sebagai status.
- Stok awal saat barang didaftarkan tercatat sebagai transaksi "Barang Masuk".
- **Hapus barang** adalah penghapusan lunak (`status_aktif = Dihapus`) dan ditolak jika masih ada unit dipinjam atau laporan perbaikan yang belum selesai.

## 8. Ekspor dan cetak

- **Ekspor CSV** tersedia di menu Laporan. Sel yang diawali `= + - @` diberi tanda petik agar tidak dijalankan sebagai formula di Excel atau Sheets. File memakai BOM UTF-8 agar terbaca benar di Excel.
- **Ekspor Excel (.xlsx) tidak disediakan.** CSV dapat dibuka langsung di Excel.
- **Cetak:** tombol Cetak memakai CSS print (tanpa sidebar, tombol, dan efek VHS).

## 9. Troubleshooting

| Gejala | Penyebab dan solusi |
|---|---|
| Layar login: "Backend tidak dapat dihubungi" | URL di `BACKEND_URL` salah atau bukan akhiran `/exec` (jangan pakai `/dev`). Akses Web App belum **Anyone**. Deployment belum dibuat. Buka URL langsung di browser untuk memastikan. |
| Konsol browser: error CORS atau "Failed to fetch" saat menyimpan | Biasanya URL salah atau akses bukan **Anyone** sehingga Google mengembalikan halaman login (HTML). Aplikasi memakai `POST text/plain` agar tidak memicu preflight, jadi pastikan `script.js` tidak diubah ke `application/json`. |
| "Respons backend tidak valid" | Backend mengembalikan HTML, bukan JSON. Cek akses **Anyone**, deploy ulang dengan **New version**, dan lihat Executions di Apps Script untuk kesalahan skrip. |
| Tombol login Google tidak muncul | `GOOGLE_CLIENT_ID` di `script.js` masih placeholder, atau pemblokir iklan memblokir `accounts.google.com`. |
| Konsol: "The given origin is not allowed for the given client ID" | Origin GitHub Pages belum ada di **Authorized JavaScript origins** (tanpa path, tanpa `/` akhir). Perubahan bisa butuh beberapa menit. |
| "Access blocked" atau "Error 403: access_denied" saat login | Aplikasi berstatus Testing dan email Anda belum menjadi **Test user**, atau domain bukan bagian dari tipe Internal. |
| "Akun Anda belum terdaftar atau tidak aktif" | Email belum ada di sheet `Pengguna` atau berstatus Nonaktif. Admin menambahkannya di menu Pengguna. |
| "Sesi login tidak valid atau telah berakhir" | Token Google berlaku sekitar 1 jam. Masuk kembali. Pastikan `GOOGLE_CLIENT_ID` di Script Properties **sama persis** dengan yang di `script.js`. |
| "Konfigurasi ... belum diatur" atau "Spreadsheet tidak dapat dibuka" | Script Properties belum lengkap, ID spreadsheet salah, atau pemilik skrip tidak punya akses ke spreadsheet itu. |
| "Sheet ... tidak ditemukan" atau "Kolom ... tidak ada" | Jalankan `setupDatabase()` lagi (aman, tidak menghapus data). Jangan mengubah nama sheet atau header. |
| "Server sedang memproses permintaan lain" | Pengguna lain sedang menyimpan. Ulangi beberapa detik kemudian. |
| Data gagal tersimpan tanpa pesan jelas | Buka Apps Script → **Executions** untuk melihat kesalahan. Periksa validasi (jumlah, kode ganda, kategori atau lokasi nonaktif). |
| Perubahan `Code.gs` tidak berpengaruh | Belum membuat **New version** pada deployment. |
| Tanggal bergeser satu hari | Pastikan `appsscript.json` berzona waktu `Asia/Makassar` (atau sesuaikan dengan lokasi sekolah). |
| Halaman lama tetap tampil setelah update | Muat ulang paksa (Ctrl+Shift+R). |

## 10. Keamanan dan keterbatasan

- Aplikasi aman untuk lingkungan sekolah dengan pengguna terdaftar, **bukan** untuk data yang sangat sensitif atau akses publik terbuka.
- Endpoint Web App terbuka secara teknis (akses **Anyone**). Perlindungan bergantung pada verifikasi token, daftar pengguna, dan pemeriksaan peran di server. Pembatasan laju yang tersedia sederhana (berbasis cache), dan kuota harian layanan Google tetap berlaku. Pihak luar dapat membuat permintaan sampah, tetapi tidak dapat membaca atau mengubah data tanpa akun terdaftar.
- ID token disimpan di `sessionStorage` browser selama sesi tab dan dihapus saat keluar.
- Google Sheets bukan database transaksional. `LockService` mencegah dua penyimpanan berjalan bersamaan, tetapi jika terjadi kegagalan di tengah operasi, data bisa tidak konsisten. Periksa `LogAktivitas` bila curiga.
- Untuk skala besar atau kebutuhan keamanan lebih tinggi, pertimbangkan Apps Script di dalam domain Google Workspace sekolah atau backend khusus. Itu di luar batasan arsitektur proyek ini.
- Backup: salin spreadsheet secara berkala (File → Make a copy) atau gunakan riwayat versi Google Sheets.

## 11. Efek VHS

Menu **Pengaturan → Efek tampilan VHS** menyediakan tiga tingkat: Penuh, Ringan, Mati. Pilihan disimpan di browser. Pengguna dengan pengaturan sistem "kurangi gerakan" otomatis tidak melihat animasi.
