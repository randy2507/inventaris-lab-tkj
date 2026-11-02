# Checklist Pengujian — Inventaris Lab TKJ

Lakukan pengujian pada URL GitHub Pages (bukan hanya di komputer sendiri). Siapkan **tiga akun uji** di menu Pengguna: satu Admin, satu Petugas Laboratorium, satu Viewer. Gunakan `seedDemoData()` hanya pada spreadsheet uji, bukan data produksi.

Tandai setiap baris: ✅ lulus, ❌ gagal (catat pesan dan isi Executions di Apps Script).

## A. Persiapan dan login

| # | Langkah | Hasil yang diharapkan | ☐ |
|---|---|---|---|
| A1 | Buka URL aplikasi | Layar boot "▶ PLAY", lalu kartu login (username dan password). Tertulis "Backend terhubung". | |
| A2 | Masuk sebagai admin dengan password sementara | Langsung muncul dialog "Ganti Password Sementara". Menutup dialog tanpa mengganti = keluar ke layar login. | |
| A3 | Ganti password (coba dulu yang pendek atau tanpa angka) | Ditolak dengan pesan jelas; password valid diterima, dashboard tampil, semua 10 menu terlihat. | |
| A4 | Masuk dengan password salah | Pesan "Username atau password salah." (sama untuk username yang tidak ada). | |
| A5 | Salah 5 kali berturut-turut pada satu username | Berikutnya ditolak "Terlalu banyak percobaan gagal" walau password benar. Setelah 15 menit, atau setelah Reset password oleh admin, bisa masuk lagi. | |
| A6 | Admin menambah pengguna Petugas dan Viewer (dengan password sementara) | Pengguna baru wajib mengganti password saat masuk pertama. | |
| A7 | Nonaktifkan satu pengguna yang sedang masuk di browser lain | Permintaan berikutnya dari pengguna itu ditolak ("Akun Anda tidak aktif") dan ia dikembalikan ke layar login. | |
| A8 | Klik Keluar lalu muat ulang | Kembali ke layar login; tidak ada data tampil. Tombol Back browser tidak menampilkan data. | |
| A9 | Buka sheet `Pengguna` | Kolom `password_hash` berisi teks heksadesimal panjang, **tidak ada password asli**. Script Properties tidak lagi berisi `ADMIN_PASSWORD_AWAL`. | |

## B. Empat belas skenario inti

| # | Skenario | Langkah | Hasil yang diharapkan | ☐ |
|---|---|---|---|---|
| 1 | Menambah barang | Data Barang → Tambah barang, isi semua kolom wajib, simpan. | Toast berhasil, barang muncul di tabel, ada transaksi "Barang Masuk" stok awal, dashboard bertambah. Kode kosong → dibuat otomatis (`INV-0001`, dst.). | |
| 2 | Mengedit barang | Ubah jumlah dan lokasi satu barang, simpan. | Data berubah; di Detail → Riwayat muncul transaksi koreksi jumlah dan pemindahan lokasi. | |
| 3 | Menghapus barang | Hapus barang yang tidak dipinjam; konfirmasi. | Dialog konfirmasi muncul; barang hilang dari tabel; sheet `Barang` berstatus `Dihapus`, bukan terhapus fisik. Barang yang sedang dipinjam **ditolak** dengan pesan jelas. | |
| 4 | Mencari dan memfilter | Cari nama dan kode; gabungkan filter kategori, kondisi, lokasi; urutkan kolom; ubah baris per halaman; pencarian global di header. | Hasil tepat, jumlah "dari N jenis" benar, paginasi benar, "Atur ulang" mengembalikan semua data. Tidak ada hasil → pesan "TIDAK DITEMUKAN". | |
| 5 | Barang masuk | Barang Masuk/Keluar → Catat transaksi → "Barang Masuk", jumlah 5. | Jumlah total barang +5; transaksi tercatat dengan nama petugas dari akun login. | |
| 6 | Barang keluar | Catat "Barang Keluar" sebesar sisa yang tersedia. | Total berkurang. Ulangi dengan jumlah **melebihi** stok → ditolak ("melebihi stok yang tersedia"), stok tidak berubah. | |
| 7 | Meminjam barang | Peminjaman → Peminjaman baru, pilih barang, jumlah, rencana kembali. | Muncul di tab Aktif; kolom "dipinjam" di Data Barang naik; "tersedia" turun. | |
| 8 | Mengembalikan barang | Aksi "Proses pengembalian" kondisi Baik. | Status Dikembalikan, tersedia pulih. Ulangi dengan kondisi **Rusak Berat** untuk sebagian unit → unit rusak dipisah menjadi kode `-S01` dengan kondisi Rusak Berat. | |
| 9 | Menolak pinjam melebihi stok | Pinjam lebih dari "tersedia". | Ditolak oleh formulir dan oleh server (coba juga lewat dua tab); stok tetap. Barang berkondisi Rusak Berat tidak muncul di daftar pilihan pinjam. | |
| 10 | Mencatat perbaikan | Pemeliharaan → Laporkan kerusakan; ubah status ke Sedang Diperbaiki, lalu Selesai (isi tanggal selesai dan biaya). | Sedang Diperbaiki → kondisi barang "Dalam Perbaikan" dan tercantum di ringkasan; Selesai → kondisi kembali "Baik". Laporan Selesai tidak bisa diubah lagi. | |
| 11 | Membuat laporan | Laporan: coba kesembilan jenis, filter periode dan kategori, Ekspor CSV, Cetak. | Angka sesuai data; CSV terbuka benar di Excel; pratinjau cetak bersih (tanpa sidebar, tombol, efek VHS). Sel CSV yang berawalan `=` diawali tanda petik. | |
| 12 | Backend tidak tersedia | Ubah sementara `BACKEND_URL` ke alamat salah (atau matikan internet) lalu coba simpan. | Pesan kesalahan jelas, **tidak** ada toast berhasil, dashboard tidak menampilkan angka palsu. | |
| 13 | Permintaan tanpa hak akses | Masuk sebagai Viewer: periksa menu; lalu coba aksi terlarang lewat konsol: `apiRequest('addBarang', {nama_barang:'x'})`. Ulangi dengan Petugas untuk `getPengguna`. | Menu Transaksi/Peminjaman/Pemeliharaan/Pengguna tidak tampil bagi Viewer. Aksi lewat konsol ditolak **server** ("tidak memiliki hak akses"), dan tercatat di log sebagai "Akses Ditolak". | |
| 14 | Transaksi bersamaan | Buka dua tab (dua akun atau dua browser) pada barang berstok 5. Di kedua tab siapkan "Barang Keluar" jumlah 4, lalu klik Simpan hampir bersamaan. | Hanya satu berhasil; yang lain ditolak karena stok tidak cukup atau "server sedang memproses". Stok akhir tidak pernah negatif. | |

## C. Pemeriksaan tambahan

| # | Langkah | Hasil yang diharapkan | ☐ |
|---|---|---|---|
| C1 | Isi formulir barang dengan jumlah `-1` atau harga negatif | Ditolak di formulir; dengan konsol, ditolak server. | |
| C2 | Kosongkan kolom wajib | Pesan "wajib diisi" di bawah kolom. | |
| C3 | Isi nama barang `=1+1` lalu ekspor CSV | Di CSV tertulis `'=1+1`, tidak dihitung sebagai formula. | |
| C4 | Edit barang yang sama di dua tab, simpan keduanya | Tab kedua ditolak dengan pesan data telah diubah pengguna lain. | |
| C5 | Tambah kategori dan lokasi baru (Admin), lalu nonaktifkan | Muncul di pilihan form; setelah nonaktif tidak muncul untuk barang baru, barang lama tetap tampil. | |
| C6 | Nonaktifkan atau turunkan peran **satu-satunya** Admin | Ditolak ("Minimal harus ada satu Admin aktif"). | |
| C6b | Admin menekan Reset password pada satu pengguna | Pengguna itu bisa masuk dengan password sementara dan diminta menggantinya. Pengguna lain tidak terpengaruh. | |
| C7 | Dashboard saat database kosong | Pesan "BELUM ADA DATA INVENTARIS", bukan angka dummy. | |
| C8 | Peminjaman lewat tanggal rencana kembali | Muncul di tab Terlambat dengan jumlah hari; dashboard "perlu ditindaklanjuti" bertambah. | |
| C9 | Tampilan ponsel (lebar ±390 px) | Sidebar dibuka lewat tombol menu; tabel dapat digeser horizontal; modal muat di layar. | |
| C10 | Pengaturan → Efek VHS: Penuh, Ringan, Mati; coba "kurangi gerakan" di sistem | Efek berubah sesuai pilihan; animasi mati otomatis saat "kurangi gerakan". | |
| C11 | Muat ulang spreadsheet setelah semua uji | Header sheet utuh, tidak ada baris kosong atau data bergeser; `LogAktivitas` mencatat tiap perubahan. | |
| C12 | Pastikan spreadsheet **tidak** dibagikan publik | Pengaturan berbagi: hanya pemilik. Aplikasi tetap berfungsi. | |

## D. Sebelum dipakai sungguhan

- [ ] Hapus data demo (hapus baris di sheet, jangan hapus header).
- [ ] Daftarkan semua pengguna sebenarnya dan nonaktifkan akun uji.
- [ ] Pastikan spreadsheet **tidak dibagikan ke publik** (di dalamnya ada hash password).
- [ ] Tidak ada rahasia di repository (hanya URL backend).
- [ ] Salinan cadangan spreadsheet sudah dibuat.
