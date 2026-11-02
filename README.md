# Sistem Informasi Inventaris Laboratorium TKJ

Aplikasi web pendataan dan monitoring peralatan Laboratorium Teknik Komputer dan Jaringan, bertema retro VHS.

- **Frontend:** HTML, CSS, JavaScript murni di GitHub Pages
- **Backend:** Google Apps Script (Web App)
- **Database:** Google Sheets (privat)
- **Login:** username + password. Tidak memakai Google OAuth dan tidak butuh Client ID.

## 1. Isi repository

| File | Fungsi |
|---|---|
| `index.html`, `style.css` | kerangka halaman dan tema VHS |
| `script.js` | konfigurasi, komunikasi API, login, router, komponen bersama |
| `modul-*.js` (7 file) | modul layar: dashboard, barang, transaksi, peminjaman, pemeliharaan, laporan, admin |
| `backend/Code.gs`, `backend/appsscript.json` | backend, **ditempel ke Apps Script**. Boleh disimpan di repo sebagai arsip (tidak berisi rahasia). |

Kolom tambahan di luar rancangan awal (dibuat otomatis oleh `setupDatabase()`): `status_aktif` (Barang), `jumlah_unit` (Pemeliharaan), dan `password_hash`, `password_salt`, `must_change` (Pengguna).

## 2. Siapkan Google Sheets

1. Buka <https://sheets.google.com> dengan akun yang akan menjadi pemilik sistem, lalu buat spreadsheet kosong.
2. Salin **ID spreadsheet** dari URL: `https://docs.google.com/spreadsheets/d/`**`ID_ADA_DI_SINI`**`/edit`.
3. **Jangan bagikan spreadsheet ke publik.** Hash password tersimpan di sheet `Pengguna`, jadi spreadsheet cukup dibuka oleh pemilik (dan admin tepercaya saja).
4. Delapan sheet dibuat otomatis pada langkah 3.5.

## 3. Pasang backend di Google Apps Script

1. Buka <https://script.google.com> dengan akun pemilik spreadsheet → **New project**.
2. Ganti isi `Code.gs` dengan isi `backend/Code.gs` dari repository ini.
3. **Project Settings → centang "Show appsscript.json manifest file in editor"**, lalu ganti isi `appsscript.json` dengan `backend/appsscript.json`.
4. **Project Settings → Script Properties → Add script property:**

| Properti | Nilai |
|---|---|
| `SPREADSHEET_ID` | ID dari bagian 2 |
| `ADMIN_EMAIL_AWAL` | username admin pertama, mis. `admin` (huruf kecil, angka, titik, garis bawah) |
| `ADMIN_PASSWORD_AWAL` | password sementara admin: minimal 8 karakter, huruf **dan** angka |

5. Di editor pilih fungsi **`setupDatabase`** → **Run**, lalu berikan otorisasi. Jika muncul "Google hasn't verified this app", pilih **Advanced → Go to (nama project) (unsafe)**; ini wajar untuk skrip Anda sendiri.
   - Fungsi ini membuat 8 sheet dan header, mengisi kategori dan lokasi awal, lalu membuat akun admin.
   - **`ADMIN_PASSWORD_AWAL` otomatis dihapus dari Script Properties** setelah di-hash. Password tidak disimpan di mana pun dalam bentuk asli.
6. Jalankan **`cekKonfigurasi`** dan periksa Execution log: `SPREADSHEET_ID` dan `ADMIN_EMAIL_AWAL` "terisi", setiap sheet "OK".
7. (Opsional, hanya uji coba) jalankan **`seedDemoData`**. Fungsi ini menolak jalan bila sheet `Barang` sudah berisi data.
8. **Deploy → New deployment → ikon roda gigi → Web app:** *Execute as:* **Me**, *Who has access:* **Anyone** → **Deploy**. Salin URL berakhiran `/exec`.
9. Uji URL di browser. Hasil benar: JSON `{"success":true,"message":"Layanan Inventaris Lab TKJ aktif.",...}`.

**Lupa password admin / terkunci?** Isi lagi `ADMIN_PASSWORD_AWAL` di Script Properties, lalu jalankan **`resetPasswordAdmin`**. Admin wajib menggantinya saat masuk.

**Memperbarui backend:** **Deploy → Manage deployments → ikon pensil → Version: New version → Deploy**. URL tidak berubah.

## 4. Pasang frontend di GitHub Pages

1. Di `script.js`, pastikan `CONFIG.BACKEND_URL` berisi URL `/exec` dari langkah 3.8. Tidak ada nilai lain yang perlu diisi.
2. Unggah `index.html`, `style.css`, `script.js`, dan semua `modul-*.js` ke cabang `main`.
3. **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.**
4. Buka `https://NAMA-GITHUB-ANDA.github.io/inventaris-lab-tkj/`. Layar login menampilkan "Backend terhubung".
5. **Masuk pertama:** username `ADMIN_EMAIL_AWAL`, password sementara. Aplikasi langsung meminta password baru.
6. Buat akun petugas dan viewer di menu **Pengguna** (admin menentukan password sementara; pengguna wajib menggantinya saat masuk pertama).

**Memperbarui aplikasi:** ubah file di repository, commit, tunggu Pages selesai, lalu **Ctrl+Shift+R**.

## 5. Peran dan hak akses

| Peran | Dapat melakukan |
|---|---|
| **Admin** | semua, termasuk pengguna, reset password, kategori, lokasi, log aktivitas |
| **Petugas Laboratorium** | barang (tambah, ubah, hapus), transaksi, peminjaman, pemeliharaan, semua laporan, melihat kategori dan lokasi |
| **Viewer** | dashboard, data barang (lihat), laporan inventaris, kategori, kondisi, lokasi |

Kebijakan ada di tabel `ACTIONS` pada `Code.gs` dan diperiksa di server pada setiap permintaan.

## 6. Cara kerja login

1. Browser mengirim username dan password lewat HTTPS ke Apps Script.
2. Server menghitung hash bergaram dan membandingkannya dengan sheet `Pengguna`. Jika cocok, server menerbitkan **token sesi acak** (disimpan di cache server, berlaku hingga 6 jam tanpa aktivitas dan maksimal 12 jam).
3. Setiap permintaan berikutnya membawa token itu. Server memeriksa token, status akun, dan peran, bukan data dari browser.
4. Akun dinonaktifkan oleh admin → sesinya langsung tidak berlaku.
5. 5 kali gagal berturut-turut pada satu username → dikunci 15 menit. Ada juga batas total percobaan gagal untuk semua akun.

## 7. Aturan stok

- **Total:** unit fisik tercatat. **Dipinjam:** naik saat peminjaman, turun saat kembali atau batal.
- **Tersedia** = total − dipinjam, hanya jika kondisi **Baik** atau **Rusak Ringan**; selain itu 0.
- Barang keluar, pengurangan, penghapusan aset, dan pemindahan hanya boleh sebesar (total − dipinjam).
- Jika sebagian unit dikembalikan rusak, dipindah, atau diperbaiki, baris dipecah otomatis dengan kode berakhiran `-S01`, `-S02`, dan seterusnya (tercatat di `LogAktivitas`).
- Peminjaman terlambat dihitung dari rencana tanggal kembali. Hapus barang bersifat lunak (`status_aktif = Dihapus`) dan ditolak bila masih dipinjam atau ada perbaikan berjalan.

## 8. Ekspor dan cetak

CSV di menu Laporan (sel berawalan `= + - @` diberi tanda petik agar tidak menjadi formula). Excel `.xlsx` tidak disediakan; CSV bisa dibuka di Excel. Tombol Cetak memakai CSS print.

## 9. Troubleshooting

| Gejala | Penyebab dan solusi |
|---|---|
| "Backend tidak dapat dihubungi" di layar login | URL `BACKEND_URL` salah (harus berakhiran `/exec`), akses Web App belum **Anyone**, atau belum di-deploy. Buka URL langsung di browser. |
| "Respons backend tidak valid" / error CORS | Google mengembalikan halaman HTML (akses bukan **Anyone**, atau error skrip). Deploy ulang dengan **New version**; cek **Executions** di Apps Script. Jangan ubah `Content-Type` fetch di `script.js` dari `text/plain`. |
| "Username atau password salah" padahal benar | Pastikan username huruf kecil. Setelah `setupDatabase`, password admin = nilai `ADMIN_PASSWORD_AWAL` saat fungsi dijalankan. Jalankan `resetPasswordAdmin` bila ragu. |
| "Terlalu banyak percobaan gagal" | Tunggu 15 menit, atau admin menjalankan Reset password untuk akun itu. |
| "Konfigurasi ... belum diatur" / "Spreadsheet tidak dapat dibuka" | Script Properties belum lengkap atau `SPREADSHEET_ID` salah. |
| "Sheet ... tidak ditemukan" / "Kolom ... tidak ada" | Jalankan `setupDatabase()` lagi (aman, tidak menghapus data). Jangan ubah nama sheet atau header. |
| "Sesi login berakhir" | Masuk kembali. Sesi tersimpan di cache server dan bisa hilang sewaktu-waktu. |
| "Server sedang memproses permintaan lain" | Pengguna lain sedang menyimpan; ulangi beberapa detik kemudian. |
| Perubahan `Code.gs` tidak berpengaruh | Belum membuat **New version** pada deployment. |
| Halaman lama tetap tampil | Muat ulang paksa (Ctrl+Shift+R). |

## 10. Keamanan dan keterbatasan (baca ini)

- Login username + password **lebih lemah dari Google Sign-In**: tidak ada verifikasi dua langkah, dan keamanan bergantung pada kekuatan password pengguna. Wajibkan password yang tidak mudah ditebak dan jangan dipakai ulang.
- Endpoint Web App terbuka (akses **Anyone**). Perlindungan ada di server: token sesi acak, daftar pengguna, peran per aksi, penguncian akun, dan batas laju sederhana. Apps Script tidak melihat alamat IP penyerang, sehingga penguncian berlaku **per username**. Konsekuensinya, orang iseng dapat mengunci akun tertentu sementara (15 menit) dengan sengaja salah memasukkan password.
- Password dihash bergaram (SHA-256 berulang), bukan algoritma khusus seperti bcrypt, karena keterbatasan Apps Script. Karena itu **spreadsheet harus tetap privat**: siapa pun yang bisa membuka sheet `Pengguna` dapat mencoba memecahkan hash secara offline.
- Token sesi disimpan di `sessionStorage` browser dan di cache server. Cache server tidak dijamin permanen; jika hilang, pengguna cukup masuk lagi.
- Google Sheets bukan database transaksional. `LockService` mencegah dua penyimpanan bersamaan, tetapi kegagalan di tengah operasi bisa menyisakan data tidak konsisten; periksa `LogAktivitas`.
- Cocok untuk lingkungan sekolah dengan pengguna terdaftar, **bukan** untuk data yang sangat sensitif. Untuk kebutuhan lebih tinggi, pakai Apps Script dalam domain Google Workspace sekolah atau backend khusus.
- Backup: salin spreadsheet berkala (File → Make a copy).

## 11. Efek VHS

**Pengaturan → Efek tampilan VHS**: Penuh, Ringan, Mati. Animasi otomatis mati jika sistem memakai "kurangi gerakan".
