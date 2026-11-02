/**
 * =====================================================================
 * SISTEM INFORMASI INVENTARIS LABORATORIUM TKJ — BACKEND
 * Google Apps Script (REST API) + Google Sheets
 * =====================================================================
 * Ringkasan:
 * - Semua aksi bertoken dikirim lewat doPost (body JSON, text/plain).
 * - doGet hanya untuk cek kesehatan layanan (tanpa data).
 * - Setiap permintaan WAJIB membawa ID token Google yang diverifikasi
 *   di server, lalu dicocokkan dengan sheet "Pengguna" (email + role).
 * - Operasi yang mengubah data berjalan di dalam LockService.
 *
 * Script Properties yang dibutuhkan (Project Settings > Script Properties):
 *   SPREADSHEET_ID     : ID spreadsheet database (wajib)
 *   GOOGLE_CLIENT_ID   : OAuth Client ID (Web) dari Google Cloud (wajib)
 *   ADMIN_EMAIL_AWAL   : email admin pertama, dipakai saat setupDatabase() (wajib saat setup)
 *   ALLOWED_DOMAIN     : opsional, mis. "smkn1contoh.sch.id" (pisahkan koma jika lebih dari satu)
 *
 * Fungsi yang dijalankan manual dari editor Apps Script:
 *   setupDatabase()  : membuat/memeriksa sheet & header (tidak menghapus data)
 *   cekKonfigurasi() : memeriksa konfigurasi dan struktur sheet
 *   seedDemoData()   : mengisi data contoh (hanya bila sheet Barang kosong)
 * =====================================================================
 */

// ======================= KONSTANTA =======================

const APP_VERSION = '1.0.0';
const MAX_BODY_CHARS = 100000;
const RATE_LIMIT_PER_MIN = 120;
const TOKENINFO_BUDGET_PER_MIN = 60;
const LOCK_WAIT_MS = 20000;
const TZ = Session.getScriptTimeZone();

const ROLE = { ADMIN: 'Admin', PETUGAS: 'Petugas Laboratorium', VIEWER: 'Viewer' };
const ROLE_LIST = [ROLE.ADMIN, ROLE.PETUGAS, ROLE.VIEWER];

const KONDISI = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Dalam Perbaikan', 'Tidak Diketahui'];
const KONDISI_DAPAT_DIPAKAI = ['Baik', 'Rusak Ringan'];
const KONDISI_KEMBALI = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Tidak Diketahui'];

const JT = {
  MASUK: 'Barang Masuk',
  KELUAR: 'Barang Keluar',
  TAMBAH: 'Penambahan Stok',
  KURANG: 'Pengurangan Stok',
  PINDAH: 'Pemindahan Lokasi',
  HAPUS: 'Penghapusan Aset'
};
const JT_LIST = Object.keys(JT).map(function (k) { return JT[k]; });
const JT_MASUK = [JT.MASUK, JT.TAMBAH];
const JT_KELUAR = [JT.KELUAR, JT.KURANG, JT.HAPUS];

const STATUS_PINJAM = { DIPINJAM: 'Dipinjam', KEMBALI: 'Dikembalikan', TERLAMBAT: 'Terlambat', BATAL: 'Dibatalkan' };
const STATUS_MNT = ['Dilaporkan', 'Menunggu Perbaikan', 'Sedang Diperbaiki', 'Selesai', 'Tidak Dapat Diperbaiki'];
const STATUS_MNT_AKHIR = ['Selesai', 'Tidak Dapat Diperbaiki'];
const STATUS_MNT_AWAL = ['Dilaporkan', 'Menunggu Perbaikan', 'Sedang Diperbaiki'];
const STATUS_AKTIF_LIST = ['Aktif', 'Nonaktif'];

const LAPORAN_JENIS = ['inventaris', 'kategori', 'kondisi', 'lokasi', 'transaksi', 'peminjaman', 'keterlambatan', 'pemeliharaan', 'nilai'];
const LAPORAN_VIEWER = ['inventaris', 'kategori', 'kondisi', 'lokasi'];

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const KATEGORI_DEFAULT = [
  'Komputer dan PC', 'Laptop', 'Monitor', 'Router', 'Switch', 'Access Point', 'Modem', 'Server',
  'Kabel Jaringan', 'Tang Crimping', 'LAN Tester', 'RJ45 dan Konektor', 'Fiber Optik',
  'Peralatan Jaringan Lainnya', 'Peralatan Listrik', 'Perkakas Laboratorium', 'Perlengkapan Lainnya'
];
const LOKASI_DEFAULT = ['Lab TKJ 1', 'Lab TKJ 2', 'Gudang Lab', 'Ruang Server', 'Ruang Guru TKJ'];

// Skema sheet. Kolom "status_aktif" (Barang) dan "jumlah_unit" (Pemeliharaan)
// adalah tambahan di luar brief awal (lihat penjelasan di Tahap 1 / README).
const SCHEMA = {
  Barang: ['id_barang', 'kode_barang', 'nama_barang', 'kategori', 'merek', 'model', 'nomor_seri', 'jumlah_total',
    'jumlah_dipinjam', 'satuan', 'kondisi', 'lokasi', 'tanggal_pengadaan', 'sumber_pengadaan', 'harga_satuan',
    'penanggung_jawab', 'keterangan', 'foto_url', 'created_at', 'updated_at', 'status_aktif'],
  Transaksi: ['id_transaksi', 'tanggal', 'jenis_transaksi', 'id_barang', 'nama_barang', 'jumlah', 'lokasi_asal',
    'lokasi_tujuan', 'petugas', 'keterangan'],
  Peminjaman: ['id_peminjaman', 'tanggal_pinjam', 'id_barang', 'nama_barang', 'nama_peminjam', 'identitas_peminjam',
    'kelas_bagian', 'jumlah_pinjam', 'rencana_kembali', 'tanggal_kembali', 'kondisi_pinjam', 'kondisi_kembali',
    'status', 'petugas', 'keterangan'],
  Pemeliharaan: ['id_pemeliharaan', 'id_barang', 'nama_barang', 'tanggal_laporan', 'deskripsi_kerusakan', 'pelapor',
    'tindakan_perbaikan', 'biaya', 'teknisi', 'status', 'tanggal_selesai', 'catatan', 'jumlah_unit'],
  Kategori: ['id_kategori', 'nama_kategori', 'deskripsi', 'status'],
  Lokasi: ['id_lokasi', 'nama_lokasi', 'keterangan', 'status'],
  Pengguna: ['id_pengguna', 'nama', 'email', 'role', 'status', 'created_at'],
  LogAktivitas: ['id_log', 'timestamp', 'email_pengguna', 'aksi', 'modul', 'id_referensi', 'deskripsi']
};
const INT_COLS = { Barang: ['jumlah_total', 'jumlah_dipinjam'], Transaksi: ['jumlah'], Peminjaman: ['jumlah_pinjam'], Pemeliharaan: ['jumlah_unit'] };
const MONEY_COLS = { Barang: ['harga_satuan'], Pemeliharaan: ['biaya'] };
const DATE_ONLY_COLS = ['tanggal', 'tanggal_pengadaan', 'tanggal_pinjam', 'rencana_kembali', 'tanggal_kembali', 'tanggal_laporan', 'tanggal_selesai'];

// ======================= ROUTER & HAK AKSES =======================

const SEMUA = ROLE_LIST;
const OPERATOR = [ROLE.ADMIN, ROLE.PETUGAS];
const HANYA_ADMIN = [ROLE.ADMIN];

// Tabel hak akses di sisi server. Ubah di sini jika kebijakan berubah.
const ACTIONS = {
  getMe:            { roles: SEMUA,       mutate: false, fn: actGetMe_ },
  getDashboard:     { roles: SEMUA,       mutate: false, fn: actGetDashboard_ },
  getBarang:        { roles: SEMUA,       mutate: false, fn: actGetBarang_ },
  getBarangById:    { roles: SEMUA,       mutate: false, fn: actGetBarangById_ },
  addBarang:        { roles: OPERATOR,    mutate: true,  fn: actAddBarang_ },
  updateBarang:     { roles: OPERATOR,    mutate: true,  fn: actUpdateBarang_ },
  deleteBarang:     { roles: OPERATOR,    mutate: true,  fn: actDeleteBarang_ },
  getTransaksi:     { roles: OPERATOR,    mutate: false, fn: actGetTransaksi_ },
  addTransaksi:     { roles: OPERATOR,    mutate: true,  fn: actAddTransaksi_ },
  getPeminjaman:    { roles: OPERATOR,    mutate: false, fn: actGetPeminjaman_ },
  addPeminjaman:    { roles: OPERATOR,    mutate: true,  fn: actAddPeminjaman_ },
  returnBarang:     { roles: OPERATOR,    mutate: true,  fn: actReturnBarang_ },
  cancelPeminjaman: { roles: OPERATOR,    mutate: true,  fn: actCancelPeminjaman_ },
  getPemeliharaan:  { roles: OPERATOR,    mutate: false, fn: actGetPemeliharaan_ },
  addPemeliharaan:  { roles: OPERATOR,    mutate: true,  fn: actAddPemeliharaan_ },
  updatePemeliharaan: { roles: OPERATOR,  mutate: true,  fn: actUpdatePemeliharaan_ },
  getKategori:      { roles: SEMUA,       mutate: false, fn: actGetKategori_ },
  addKategori:      { roles: HANYA_ADMIN, mutate: true,  fn: actAddKategori_ },
  updateKategori:   { roles: HANYA_ADMIN, mutate: true,  fn: actUpdateKategori_ },
  getLokasi:        { roles: SEMUA,       mutate: false, fn: actGetLokasi_ },
  addLokasi:        { roles: HANYA_ADMIN, mutate: true,  fn: actAddLokasi_ },
  updateLokasi:     { roles: HANYA_ADMIN, mutate: true,  fn: actUpdateLokasi_ },
  getPengguna:      { roles: HANYA_ADMIN, mutate: false, fn: actGetPengguna_ },
  addPengguna:      { roles: HANYA_ADMIN, mutate: true,  fn: actAddPengguna_ },
  updatePengguna:   { roles: HANYA_ADMIN, mutate: true,  fn: actUpdatePengguna_ },
  getLaporan:       { roles: SEMUA,       mutate: false, fn: actGetLaporan_ },
  getLogAktivitas:  { roles: HANYA_ADMIN, mutate: false, fn: actGetLogAktivitas_ }
};

function doGet(e) {
  return jsonOut_({ success: true, message: 'Layanan Inventaris Lab TKJ aktif.', data: { versi: APP_VERSION } });
}

function doPost(e) {
  try {
    const req = parseRequest_(e);
    const result = handleRequest_(req);
    return jsonOut_({ success: true, message: result.message || '', data: result.data === undefined ? null : result.data });
  } catch (err) {
    if (err && err.isApp) {
      return jsonOut_({ success: false, message: err.message, code: err.code || 'ERROR' });
    }
    console.error('Kesalahan tak terduga: ' + (err && err.stack ? err.stack : err));
    return jsonOut_({ success: false, message: 'Terjadi kesalahan pada server. Silakan coba lagi atau hubungi admin.', code: 'SERVER_ERROR' });
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) throw appError_('Permintaan kosong.', 'BAD_REQUEST');
  const raw = e.postData.contents;
  if (raw.length > MAX_BODY_CHARS) throw appError_('Permintaan terlalu besar.', 'BAD_REQUEST');
  let req;
  try { req = JSON.parse(raw); } catch (x) { throw appError_('Format permintaan bukan JSON yang valid.', 'BAD_REQUEST'); }
  if (!req || typeof req !== 'object') throw appError_('Format permintaan tidak valid.', 'BAD_REQUEST');
  return req;
}

function handleRequest_(req) {
  const action = String(req.action || '');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) throw appError_('Aksi tidak dikenal.', 'BAD_REQUEST');
  const def = ACTIONS[action];
  const user = authenticate_(req.token);
  checkRateLimit_(user.email);
  if (def.roles.indexOf(user.role) === -1) {
    logActivity_(user.email, 'Akses Ditolak', 'Auth', action, 'Role ' + user.role + ' mencoba aksi ' + action);
    throw appError_('Anda tidak memiliki hak akses untuk aksi ini.', 'FORBIDDEN');
  }
  const payload = (req.payload && typeof req.payload === 'object') ? req.payload : {};
  if (def.mutate) {
    return runWithLock_(function () { return def.fn(payload, user); });
  }
  return def.fn(payload, user);
}

function runWithLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw appError_('Server sedang memproses permintaan lain. Silakan coba lagi sebentar lagi.', 'BUSY');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function appError_(message, code) {
  const e = new Error(message);
  e.isApp = true;
  e.code = code || 'VALIDATION';
  return e;
}

function notFound_(what) {
  return appError_(what + ' tidak ditemukan.', 'NOT_FOUND');
}

// ======================= AUTENTIKASI =======================

function authenticate_(token) {
  const salah = function () { return appError_('Sesi login tidak valid atau telah berakhir. Silakan masuk kembali.', 'UNAUTHENTICATED'); };
  if (typeof token !== 'string' || token.length < 100 || token.length > 4096) throw salah();
  const parts = token.split('.');
  if (parts.length !== 3) throw salah();

  let claims;
  try {
    claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
  } catch (x) { throw salah(); }

  const clientId = prop_('GOOGLE_CLIENT_ID', true);
  const now = Math.floor(Date.now() / 1000);
  // Pemeriksaan awal lokal agar token sampah tidak menghabiskan kuota UrlFetch.
  if (!claims || claims.aud !== clientId || Number(claims.exp) <= now) throw salah();

  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  let ident = null;
  const hit = cache.get(key);
  if (hit) {
    ident = JSON.parse(hit);
    if (ident.bad) throw salah();
  } else {
    ident = verifyWithGoogle_(token, clientId, now, cache, key);
  }

  const email = String(ident.email || '').toLowerCase();
  const domains = prop_('ALLOWED_DOMAIN', false);
  if (domains) {
    const allowed = domains.split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean);
    const dom = email.split('@')[1] || '';
    if (allowed.length && allowed.indexOf(dom) === -1) throw appError_('Domain email Anda tidak diizinkan menggunakan aplikasi ini.', 'FORBIDDEN');
  }

  const user = loadUsers_().filter(function (u) { return u.email === email && u.status === 'Aktif'; })[0];
  if (!user || ROLE_LIST.indexOf(user.role) === -1) {
    throw appError_('Akun Anda belum terdaftar atau tidak aktif. Hubungi admin laboratorium.', 'FORBIDDEN');
  }
  return { email: email, nama: user.nama || ident.name || email, role: user.role, id_pengguna: user.id_pengguna };
}

function verifyWithGoogle_(token, clientId, now, cache, key) {
  const salah = function () { return appError_('Sesi login tidak valid atau telah berakhir. Silakan masuk kembali.', 'UNAUTHENTICATED'); };
  const budgetKey = 'tokbudget';
  const used = Number(cache.get(budgetKey) || 0) + 1;
  cache.put(budgetKey, String(used), 60);
  if (used > TOKENINFO_BUDGET_PER_MIN) throw appError_('Layanan login sedang sibuk. Coba lagi dalam satu menit.', 'BUSY');

  let res;
  try {
    res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  } catch (x) {
    throw appError_('Tidak dapat memverifikasi login ke Google. Coba lagi.', 'AUTH_UNAVAILABLE');
  }
  let info = null;
  if (res.getResponseCode() === 200) {
    try { info = JSON.parse(res.getContentText()); } catch (x) { info = null; }
  }
  const valid = info &&
    info.aud === clientId &&
    (info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com') &&
    String(info.email_verified) === 'true' &&
    Number(info.exp) > now &&
    info.email;
  if (!valid) {
    cache.put(key, JSON.stringify({ bad: 1 }), 60);
    throw salah();
  }
  const ident = { email: info.email, name: info.name || '', exp: Number(info.exp) };
  cache.put(key, JSON.stringify(ident), Math.max(1, Math.min(300, ident.exp - now)));
  return ident;
}

function checkRateLimit_(email) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email));
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 60);
  if (n > RATE_LIMIT_PER_MIN) throw appError_('Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 'RATE_LIMIT');
}

function loadUsers_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('users');
  if (hit) return JSON.parse(hit);
  const users = getTable_('Pengguna').rows.map(function (r) {
    return { id_pengguna: r.id_pengguna, nama: r.nama, email: String(r.email).toLowerCase(), role: r.role, status: r.status };
  });
  cache.put('users', JSON.stringify(users), 60);
  return users;
}

function clearUsersCache_() {
  CacheService.getScriptCache().remove('users');
}

// ======================= UTILITAS UMUM =======================

function prop_(key, required) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !v) throw appError_('Konfigurasi "' + key + '" belum diatur di Script Properties.', 'CONFIG');
  return v || '';
}

let _ss = null;
function getSS_() {
  if (!_ss) {
    const id = prop_('SPREADSHEET_ID', true);
    try {
      _ss = SpreadsheetApp.openById(id);
    } catch (x) {
      throw appError_('Spreadsheet tidak dapat dibuka. Periksa SPREADSHEET_ID dan izin akses.', 'CONFIG');
    }
  }
  return _ss;
}

function nowIso_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function pad_(n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; }
function round2_(n) { return Math.round(n * 100) / 100; }
function newId_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase(); }

function dateParts_(s) { return [Number(s.substr(0, 4)), Number(s.substr(5, 2)), Number(s.substr(8, 2))]; }
function daysBetween_(a, b) {
  const pa = dateParts_(a), pb = dateParts_(b);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function addDays_(s, n) {
  const p = dateParts_(s);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000).toISOString().substr(0, 10);
}

// Mencegah formula injection: teks yang diawali = + - @ diberi tanda petik.
function safeText_(v) {
  let s = (v === null || v === undefined) ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function vStr_(v, label, opt) {
  opt = opt || {};
  const s = safeText_(v);
  if (opt.required && s === '') throw appError_(label + ' wajib diisi.');
  const max = opt.max || 200;
  if (s.length > max) throw appError_(label + ' maksimal ' + max + ' karakter.');
  return s;
}

function vNum_(v, label, opt) {
  opt = opt || {};
  if (v === '' || v === null || v === undefined) {
    if (opt.required) throw appError_(label + ' wajib diisi.');
    return opt.def === undefined ? 0 : opt.def;
  }
  const n = (typeof v === 'number') ? v : Number(String(v).trim());
  if (!isFinite(n)) throw appError_(label + ' harus berupa angka.');
  if (opt.integer && Math.floor(n) !== n) throw appError_(label + ' harus berupa bilangan bulat.');
  if (opt.min !== undefined && n < opt.min) throw appError_(label + ' tidak boleh kurang dari ' + opt.min + '.');
  if (n > (opt.max || 1e12)) throw appError_(label + ' terlalu besar.');
  return opt.integer ? n : round2_(n);
}

function vEnum_(v, label, list, def) {
  const s = safeText_(v);
  if (s === '' && def !== undefined) return def;
  if (list.indexOf(s) === -1) throw appError_(label + ' tidak valid.');
  return s;
}

function vDate_(v, label, opt) {
  opt = opt || {};
  const s = safeText_(v);
  if (s === '') {
    if (opt.required) throw appError_(label + ' wajib diisi.');
    return opt.def === undefined ? '' : opt.def;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw appError_(label + ' harus berformat YYYY-MM-DD.');
  const p = dateParts_(s);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2] || p[0] < 1990 || p[0] > 2100) {
    throw appError_(label + ' bukan tanggal yang valid.');
  }
  return s;
}

function vEmail_(v, label) {
  const s = vStr_(v, label, { required: true, max: 150 }).toLowerCase();
  if (!/^[^\s@']+@[^\s@]+\.[^\s@]+$/.test(s)) throw appError_(label + ' tidak valid.');
  return s;
}

function vUrl_(v, label) {
  const s = vStr_(v, label, { max: 500 });
  if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw appError_(label + ' harus diawali http:// atau https://');
  return s;
}

function clean_(o) {
  const c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; });
  return c;
}

function findById_(table, field, id) {
  const s = String(id);
  for (let i = 0; i < table.rows.length; i++) if (String(table.rows[i][field]) === s) return table.rows[i];
  return null;
}

function sortDesc_(rows, field) {
  return rows.slice().sort(function (a, b) {
    if (a[field] < b[field]) return 1;
    if (a[field] > b[field]) return -1;
    return b._row - a._row;
  });
}

// ======================= AKSES SHEET =======================

function colFormat_(sheetName, header) {
  if ((MONEY_COLS[sheetName] || []).indexOf(header) > -1) return '#,##0.00';
  if ((INT_COLS[sheetName] || []).indexOf(header) > -1) return '0';
  return '@';
}

function normCell_(v, header) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, TZ, DATE_ONLY_COLS.indexOf(header) > -1 ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (v === null || v === undefined) return '';
  return v;
}

function getTable_(name) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw appError_('Sheet "' + name + '" tidak ditemukan. Jalankan setupDatabase() di Apps Script.', 'DB_STRUCTURE');
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) throw appError_('Sheet "' + name + '" belum memiliki header. Jalankan setupDatabase().', 'DB_STRUCTURE');
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  SCHEMA[name].forEach(function (h) {
    if (headers.indexOf(h) === -1) throw appError_('Kolom "' + h + '" tidak ada di sheet "' + name + '". Jalankan setupDatabase().', 'DB_STRUCTURE');
  });
  const ints = INT_COLS[name] || [], money = MONEY_COLS[name] || [];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    let kosong = true;
    for (let c = 0; c < r.length; c++) if (r[c] !== '' && r[c] !== null) { kosong = false; break; }
    if (kosong) continue;
    const o = { _row: i + 1 };
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c];
      let v = normCell_(r[c], h);
      if (ints.indexOf(h) > -1 || money.indexOf(h) > -1) v = (v === '' ? 0 : (Number(v) || 0));
      o[h] = v;
    }
    rows.push(o);
  }
  return { name: name, sheet: sheet, headers: headers, rows: rows };
}

function updateRow_(table, obj) {
  const arr = table.headers.map(function (h) { return (obj[h] === undefined || obj[h] === null) ? '' : obj[h]; });
  table.sheet.getRange(obj._row, 1, 1, table.headers.length).setValues([arr]);
}

function appendRowFast_(name, obj) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw appError_('Sheet "' + name + '" tidak ditemukan. Jalankan setupDatabase().', 'DB_STRUCTURE');
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw appError_('Sheet "' + name + '" belum memiliki header. Jalankan setupDatabase().', 'DB_STRUCTURE');
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  SCHEMA[name].forEach(function (h) {
    if (headers.indexOf(h) === -1) throw appError_('Kolom "' + h + '" tidak ada di sheet "' + name + '". Jalankan setupDatabase().', 'DB_STRUCTURE');
  });
  const rowNum = sheet.getLastRow() + 1;
  if (rowNum > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
  const range = sheet.getRange(rowNum, 1, 1, headers.length);
  range.setNumberFormats([headers.map(function (h) { return colFormat_(name, h); })]);
  range.setValues([headers.map(function (h) { return (obj[h] === undefined || obj[h] === null) ? '' : obj[h]; })]);
  return rowNum;
}

function appendRow_(table, obj) {
  obj._row = appendRowFast_(table.name, obj);
  table.rows.push(obj);
  return obj;
}

function readLastRows_(name, n) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw appError_('Sheet "' + name + '" tidak ditemukan. Jalankan setupDatabase().', 'DB_STRUCTURE');
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const start = Math.max(2, lastRow - n + 1);
  const vals = sheet.getRange(start, 1, lastRow - start + 1, lastCol).getValues();
  return vals.map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = normCell_(r[i], h); });
    return o;
  }).reverse();
}

function logActivity_(email, aksi, modul, idRef, deskripsi) {
  try {
    appendRowFast_('LogAktivitas', {
      id_log: newId_('LOG'),
      timestamp: nowIso_(),
      email_pengguna: email,
      aksi: aksi,
      modul: modul,
      id_referensi: idRef || '',
      deskripsi: safeText_(deskripsi).substring(0, 500)
    });
  } catch (x) {
    console.error('Gagal mencatat log aktivitas: ' + x);
  }
}

function appendTransaksi_(o) {
  appendRowFast_('Transaksi', {
    id_transaksi: newId_('TRX'),
    tanggal: o.tanggal || todayStr_(),
    jenis_transaksi: o.jenis,
    id_barang: o.barang.id_barang,
    nama_barang: o.barang.nama_barang,
    jumlah: o.jumlah,
    lokasi_asal: o.asal || '',
    lokasi_tujuan: o.tujuan || '',
    petugas: o.petugas,
    keterangan: safeText_(o.ket || '').substring(0, 500)
  });
}

// ======================= INISIALISASI DATABASE =======================

function setupDatabase() {
  const ss = getSS_();
  Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name); });
  SpreadsheetApp.flush();
  seedReferensi_();
  seedAdminAwal_();
  clearUsersCache_();
  Logger.log('setupDatabase selesai. Sheet: ' + Object.keys(SCHEMA).join(', '));
}

function ensureSheet_(ss, name) {
  const headers = SCHEMA[name];
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const lastCol = sheet.getLastColumn();
  let existing = [];
  if (lastCol > 0 && sheet.getLastRow() > 0) {
    existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  }
  while (existing.length && existing[existing.length - 1] === '') existing.pop();

  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    existing = headers.slice();
  } else {
    const missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      existing = existing.concat(missing);
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, existing.length).setFontWeight('bold').setBackground('#0a0e27').setFontColor('#00e5ff');

  const maxRows = sheet.getMaxRows();
  const formatRow = existing.map(function (h) { return colFormat_(name, h); });
  const formats = [];
  for (let r = 0; r < maxRows; r++) formats.push(formatRow);
  sheet.getRange(1, 1, maxRows, existing.length).setNumberFormats(formats);
}

function seedReferensi_() {
  const now = nowIso_();
  const kat = getTable_('Kategori');
  if (kat.rows.length === 0) {
    KATEGORI_DEFAULT.forEach(function (n) {
      appendRow_(kat, { id_kategori: newId_('KAT'), nama_kategori: n, deskripsi: '', status: 'Aktif' });
    });
  }
  const lok = getTable_('Lokasi');
  if (lok.rows.length === 0) {
    LOKASI_DEFAULT.forEach(function (n) {
      appendRow_(lok, { id_lokasi: newId_('LOK'), nama_lokasi: n, keterangan: '', status: 'Aktif' });
    });
  }
}

function seedAdminAwal_() {
  const t = getTable_('Pengguna');
  const adaAdmin = t.rows.some(function (r) { return r.role === ROLE.ADMIN && r.status === 'Aktif'; });
  if (adaAdmin) return;
  const email = prop_('ADMIN_EMAIL_AWAL', false).toLowerCase();
  if (!email) {
    throw appError_('Belum ada Admin aktif. Isi Script Property ADMIN_EMAIL_AWAL dengan email Google admin pertama, lalu jalankan setupDatabase() lagi.', 'CONFIG');
  }
  appendRow_(t, { id_pengguna: newId_('USR'), nama: 'Administrator', email: email, role: ROLE.ADMIN, status: 'Aktif', created_at: nowIso_() });
}

function cekKonfigurasi() {
  const hasil = [];
  ['SPREADSHEET_ID', 'GOOGLE_CLIENT_ID', 'ADMIN_EMAIL_AWAL', 'ALLOWED_DOMAIN'].forEach(function (k) {
    const v = PropertiesService.getScriptProperties().getProperty(k);
    hasil.push(k + ': ' + (v ? 'terisi' : (k === 'ALLOWED_DOMAIN' ? 'kosong (opsional)' : 'BELUM DIISI')));
  });
  try {
    Object.keys(SCHEMA).forEach(function (n) { const t = getTable_(n); hasil.push('Sheet ' + n + ': OK (' + t.rows.length + ' baris data)'); });
  } catch (e) {
    hasil.push('Struktur sheet: ' + e.message);
  }
  hasil.push('Zona waktu skrip: ' + TZ);
  Logger.log(hasil.join('\n'));
  return hasil.join('\n');
}

// ======================= PERHITUNGAN BARANG =======================

// tersedia = total - dipinjam (hanya jika kondisi Baik / Rusak Ringan, selain itu 0)
function hitungTersedia_(b) {
  if (KONDISI_DAPAT_DIPAKAI.indexOf(b.kondisi) === -1) return 0;
  return Math.max(0, b.jumlah_total - b.jumlah_dipinjam);
}

function withComputed_(b) {
  const o = clean_(b);
  o.tersedia = hitungTersedia_(b);
  o.total_nilai = round2_(b.jumlah_total * b.harga_satuan);
  return o;
}

function loadRefs_() {
  const k = {}, l = {};
  getTable_('Kategori').rows.forEach(function (r) { if (r.status === 'Aktif') k[r.nama_kategori] = true; });
  getTable_('Lokasi').rows.forEach(function (r) { if (r.status === 'Aktif') l[r.nama_lokasi] = true; });
  return { kategori: k, lokasi: l };
}

function kodeExists_(tb, kode, exceptId) {
  const low = String(kode).toLowerCase();
  return tb.rows.some(function (r) { return String(r.kode_barang).toLowerCase() === low && r.id_barang !== exceptId; });
}

function generateKode_(tb) {
  let n = tb.rows.length + 1, kode;
  do { kode = 'INV-' + pad_(n, 4); n++; } while (kodeExists_(tb, kode, null));
  return kode;
}

// Memecah sebagian unit menjadi baris barang baru (kondisi/lokasi berbeda).
function splitBarang_(tb, b, qty, overrides, alasan) {
  const now = nowIso_();
  const root = String(b.kode_barang).replace(/-S\d{2}$/, '');
  let i = 1, kode;
  do { kode = root + '-S' + pad_(i, 2); i++; } while (kodeExists_(tb, kode, null));
  const nb = Object.assign({}, b, {
    id_barang: newId_('BRG'), kode_barang: kode, jumlah_total: qty, jumlah_dipinjam: 0,
    created_at: now, updated_at: now, status_aktif: 'Aktif'
  }, overrides);
  nb.keterangan = ('Dipisah dari ' + b.kode_barang + ' (' + alasan + '). ' + (b.keterangan || '')).trim().substring(0, 1000);
  delete nb._row;
  b.jumlah_total -= qty;
  b.updated_at = now;
  appendRow_(tb, nb);
  return nb;
}

// Mengubah kondisi sejumlah unit. Jika sebagian, baris dipecah. Selalu menulis baris b.
function applyKondisiToUnits_(tb, b, qty, kondisi, alasan) {
  if (b.kondisi === kondisi) {
    updateRow_(tb, b);
    return { barang: b, split: false };
  }
  if (qty >= b.jumlah_total) {
    b.kondisi = kondisi;
    b.updated_at = nowIso_();
    updateRow_(tb, b);
    return { barang: b, split: false };
  }
  const nb = splitBarang_(tb, b, qty, { kondisi: kondisi }, alasan);
  updateRow_(tb, b);
  return { barang: nb, split: true };
}

// ======================= AKSI: PROFIL & META =======================

function actGetMe_(p, user) {
  const refs = loadRefs_();
  return {
    data: {
      user: { nama: user.nama, email: user.email, role: user.role },
      izin: Object.keys(ACTIONS).filter(function (a) { return ACTIONS[a].roles.indexOf(user.role) > -1; }),
      enum: {
        kondisi: KONDISI, kondisi_kembali: KONDISI_KEMBALI, jenis_transaksi: JT_LIST,
        status_peminjaman: Object.keys(STATUS_PINJAM).map(function (k) { return STATUS_PINJAM[k]; }),
        status_pemeliharaan: STATUS_MNT, role: ROLE_LIST,
        jenis_laporan: user.role === ROLE.VIEWER ? LAPORAN_VIEWER : LAPORAN_JENIS
      },
      kategori: Object.keys(refs.kategori).sort(),
      lokasi: Object.keys(refs.lokasi).sort(),
      versi: APP_VERSION
    }
  };
}

// ======================= AKSI: BARANG =======================

function parseBarangInput_(p, refs, cur) {
  const kategori = vStr_(p.kategori, 'Kategori', { required: true, max: 100 });
  if (!refs.kategori[kategori] && !(cur && cur.kategori === kategori)) throw appError_('Kategori "' + kategori + '" tidak ditemukan atau tidak aktif.');
  const lokasi = vStr_(p.lokasi, 'Lokasi penyimpanan', { required: true, max: 100 });
  if (!refs.lokasi[lokasi] && !(cur && cur.lokasi === lokasi)) throw appError_('Lokasi "' + lokasi + '" tidak ditemukan atau tidak aktif.');
  return {
    kode_barang: vStr_(p.kode_barang, 'Kode inventaris', { max: 50 }),
    nama_barang: vStr_(p.nama_barang, 'Nama barang', { required: true, max: 150 }),
    kategori: kategori,
    merek: vStr_(p.merek, 'Merek', { max: 100 }),
    model: vStr_(p.model, 'Model/tipe', { max: 100 }),
    nomor_seri: vStr_(p.nomor_seri, 'Nomor seri', { max: 100 }),
    jumlah_total: vNum_(p.jumlah_total, 'Jumlah unit', { required: true, integer: true, min: cur ? 0 : 1, max: 1000000 }),
    satuan: vStr_(p.satuan, 'Satuan', { required: true, max: 30 }),
    kondisi: vEnum_(p.kondisi, 'Kondisi barang', KONDISI),
    lokasi: lokasi,
    tanggal_pengadaan: vDate_(p.tanggal_pengadaan, 'Tanggal pengadaan', {}),
    sumber_pengadaan: vStr_(p.sumber_pengadaan, 'Sumber pengadaan', { max: 150 }),
    harga_satuan: vNum_(p.harga_satuan, 'Harga satuan', { min: 0, def: 0 }),
    penanggung_jawab: vStr_(p.penanggung_jawab, 'Penanggung jawab', { max: 100 }),
    keterangan: vStr_(p.keterangan, 'Keterangan', { max: 1000 }),
    foto_url: vUrl_(p.foto_url, 'URL foto')
  };
}

function actGetBarang_(p, user) {
  const tb = getTable_('Barang');
  let status = 'Aktif';
  if (user.role === ROLE.ADMIN && (p.status === 'Dihapus' || p.status === 'Semua')) status = p.status;
  const list = tb.rows.filter(function (b) { return status === 'Semua' || b.status_aktif === status; });
  return { data: list.map(withComputed_) };
}

function actGetBarangById_(p, user) {
  const id = vStr_(p.id_barang, 'ID barang', { required: true, max: 40 });
  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', id);
  if (!b || (b.status_aktif !== 'Aktif' && user.role !== ROLE.ADMIN)) throw notFound_('Barang');
  const out = { barang: withComputed_(b) };
  if (user.role !== ROLE.VIEWER) {
    out.riwayat_transaksi = sortDesc_(getTable_('Transaksi').rows.filter(function (r) { return r.id_barang === id; }), 'tanggal').slice(0, 100).map(clean_);
    const today = todayStr_();
    out.riwayat_peminjaman = sortDesc_(getTable_('Peminjaman').rows.filter(function (r) { return r.id_barang === id; }), 'tanggal_pinjam').slice(0, 100)
      .map(function (r) { return Object.assign(clean_(r), peminjamanEfektif_(r, today)); });
    out.riwayat_pemeliharaan = sortDesc_(getTable_('Pemeliharaan').rows.filter(function (r) { return r.id_barang === id; }), 'tanggal_laporan').slice(0, 100).map(clean_);
  }
  return { data: out };
}

function actAddBarang_(p, user) {
  const tb = getTable_('Barang');
  const d = parseBarangInput_(p, loadRefs_(), null);
  let kode = d.kode_barang;
  if (!kode) kode = generateKode_(tb);
  else if (kodeExists_(tb, kode, null)) throw appError_('Kode inventaris "' + kode + '" sudah digunakan.');
  const now = nowIso_();
  const b = Object.assign({}, d, {
    id_barang: newId_('BRG'), kode_barang: kode, jumlah_dipinjam: 0,
    created_at: now, updated_at: now, status_aktif: 'Aktif'
  });
  appendRow_(tb, b);
  appendTransaksi_({ jenis: JT.MASUK, barang: b, jumlah: b.jumlah_total, tujuan: b.lokasi, petugas: user.nama, ket: 'Stok awal saat pendaftaran barang' });
  logActivity_(user.email, 'Tambah Barang', 'Barang', b.id_barang, 'Menambah barang ' + b.nama_barang + ' (' + b.kode_barang + '), ' + b.jumlah_total + ' ' + b.satuan);
  return { message: 'Barang berhasil ditambahkan.', data: withComputed_(b) };
}

function actUpdateBarang_(p, user) {
  const id = vStr_(p.id_barang, 'ID barang', { required: true, max: 40 });
  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', id);
  if (!b || b.status_aktif !== 'Aktif') throw notFound_('Barang');
  if (p.updated_at && String(p.updated_at) !== String(b.updated_at)) {
    throw appError_('Data telah diubah oleh pengguna lain. Muat ulang data lalu coba lagi.', 'CONFLICT');
  }
  const d = parseBarangInput_(p, loadRefs_(), b);
  if (d.kode_barang && d.kode_barang.toLowerCase() !== String(b.kode_barang).toLowerCase() && kodeExists_(tb, d.kode_barang, b.id_barang)) {
    throw appError_('Kode inventaris "' + d.kode_barang + '" sudah digunakan.');
  }
  if (d.jumlah_total < b.jumlah_dipinjam) {
    throw appError_('Jumlah unit tidak boleh lebih kecil dari jumlah yang sedang dipinjam (' + b.jumlah_dipinjam + ').', 'STOCK');
  }
  const selisih = d.jumlah_total - b.jumlah_total;
  const lokasiLama = b.lokasi, kondisiLama = b.kondisi;
  Object.keys(d).forEach(function (k) {
    if (k === 'kode_barang' && !d.kode_barang) return;
    b[k] = d[k];
  });
  b.updated_at = nowIso_();
  updateRow_(tb, b);

  if (selisih !== 0) {
    appendTransaksi_({
      jenis: selisih > 0 ? JT.TAMBAH : JT.KURANG, barang: b, jumlah: Math.abs(selisih),
      asal: selisih < 0 ? b.lokasi : '', tujuan: selisih > 0 ? b.lokasi : '',
      petugas: user.nama, ket: 'Koreksi jumlah melalui perubahan data barang'
    });
  }
  if (lokasiLama !== b.lokasi) {
    appendTransaksi_({ jenis: JT.PINDAH, barang: b, jumlah: b.jumlah_total, asal: lokasiLama, tujuan: b.lokasi, petugas: user.nama, ket: 'Perubahan lokasi melalui perubahan data barang' });
  }
  let rincian = '';
  if (kondisiLama !== b.kondisi) rincian += ' Kondisi: ' + kondisiLama + ' → ' + b.kondisi + '.';
  if (selisih !== 0) rincian += ' Jumlah ' + (selisih > 0 ? '+' : '') + selisih + '.';
  logActivity_(user.email, 'Ubah Barang', 'Barang', b.id_barang, 'Memperbarui barang ' + b.nama_barang + ' (' + b.kode_barang + ').' + rincian);
  return { message: 'Barang berhasil diperbarui.', data: withComputed_(b) };
}

function actDeleteBarang_(p, user) {
  const id = vStr_(p.id_barang, 'ID barang', { required: true, max: 40 });
  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', id);
  if (!b || b.status_aktif !== 'Aktif') throw notFound_('Barang');
  if (b.jumlah_dipinjam > 0) throw appError_('Barang tidak dapat dihapus karena masih ada unit yang dipinjam (' + b.jumlah_dipinjam + ').', 'STOCK');
  const pinjamAktif = getTable_('Peminjaman').rows.some(function (r) { return r.id_barang === id && r.status === STATUS_PINJAM.DIPINJAM; });
  if (pinjamAktif) throw appError_('Barang tidak dapat dihapus karena masih memiliki peminjaman aktif.', 'STOCK');
  const mntAktif = getTable_('Pemeliharaan').rows.some(function (r) { return r.id_barang === id && STATUS_MNT_AKHIR.indexOf(r.status) === -1; });
  if (mntAktif) throw appError_('Barang tidak dapat dihapus karena masih memiliki laporan pemeliharaan yang belum selesai.', 'STOCK');

  const jumlah = b.jumlah_total;
  if (jumlah > 0) {
    appendTransaksi_({ jenis: JT.HAPUS, barang: b, jumlah: jumlah, asal: b.lokasi, petugas: user.nama, ket: 'Penghapusan data barang dari inventaris' });
  }
  b.jumlah_total = 0;
  b.status_aktif = 'Dihapus';
  b.updated_at = nowIso_();
  updateRow_(tb, b);
  logActivity_(user.email, 'Hapus Barang', 'Barang', b.id_barang, 'Menghapus barang ' + b.nama_barang + ' (' + b.kode_barang + ') dari inventaris');
  return { message: 'Barang berhasil dihapus dari inventaris.', data: { id_barang: id } };
}

// ======================= AKSI: TRANSAKSI =======================

function actGetTransaksi_(p, user) {
  const dari = vDate_(p.dari, 'Tanggal awal', {});
  const sampai = vDate_(p.sampai, 'Tanggal akhir', {});
  const jenis = p.jenis_transaksi ? vEnum_(p.jenis_transaksi, 'Jenis transaksi', JT_LIST) : '';
  const idb = p.id_barang ? vStr_(p.id_barang, 'ID barang', { max: 40 }) : '';
  const limit = Math.min(Math.max(Number(p.limit) || 1000, 1), 5000);
  const rows = getTable_('Transaksi').rows.filter(function (r) {
    return (!dari || r.tanggal >= dari) && (!sampai || r.tanggal <= sampai) && (!jenis || r.jenis_transaksi === jenis) && (!idb || r.id_barang === idb);
  });
  return { data: sortDesc_(rows, 'tanggal').slice(0, limit).map(clean_) };
}

function actAddTransaksi_(p, user) {
  const jenis = vEnum_(p.jenis_transaksi, 'Jenis transaksi', JT_LIST);
  const id = vStr_(p.id_barang, 'ID barang', { required: true, max: 40 });
  const jumlah = vNum_(p.jumlah, 'Jumlah', { required: true, integer: true, min: 1, max: 1000000 });
  const tanggal = vDate_(p.tanggal, 'Tanggal transaksi', { def: todayStr_() });
  let ket = vStr_(p.keterangan, 'Keterangan', { max: 500 });

  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', id);
  if (!b || b.status_aktif !== 'Aktif') throw notFound_('Barang');

  const fisik = b.jumlah_total - b.jumlah_dipinjam;
  let asal = '', tujuan = '';
  let pesan = 'Transaksi berhasil dicatat.';

  if (JT_MASUK.indexOf(jenis) > -1) {
    b.jumlah_total += jumlah;
    tujuan = b.lokasi;
  } else if (JT_KELUAR.indexOf(jenis) > -1) {
    if (jumlah > fisik) {
      throw appError_('Jumlah melebihi stok yang tersedia di laboratorium (' + fisik + ' ' + b.satuan + ').', 'STOCK');
    }
    b.jumlah_total -= jumlah;
    asal = b.lokasi;
    if (jenis === JT.HAPUS && b.jumlah_total === 0) b.status_aktif = 'Dihapus';
  } else if (jenis === JT.PINDAH) {
    const tujuanBaru = vStr_(p.lokasi_tujuan, 'Lokasi tujuan', { required: true, max: 100 });
    if (!loadRefs_().lokasi[tujuanBaru]) throw appError_('Lokasi tujuan tidak ditemukan atau tidak aktif.');
    if (tujuanBaru === b.lokasi) throw appError_('Lokasi tujuan sama dengan lokasi saat ini.');
    if (jumlah > fisik) throw appError_('Jumlah melebihi unit yang dapat dipindahkan (' + fisik + ' ' + b.satuan + ').', 'STOCK');
    asal = b.lokasi;
    tujuan = tujuanBaru;
    if (jumlah === b.jumlah_total) {
      b.lokasi = tujuanBaru;
    } else {
      const nb = splitBarang_(tb, b, jumlah, { lokasi: tujuanBaru }, 'pemindahan lokasi');
      ket = (ket + ' [Unit dipindahkan menjadi baris baru: ' + nb.kode_barang + ']').trim();
      logActivity_(user.email, 'Pisah Barang', 'Barang', nb.id_barang, jumlah + ' unit dipisah dari ' + b.kode_barang + ' menjadi ' + nb.kode_barang + ' (pindah ke ' + tujuanBaru + ')');
      pesan = 'Transaksi berhasil. Sebagian unit dipisah menjadi kode ' + nb.kode_barang + '.';
    }
  }
  b.updated_at = nowIso_();
  updateRow_(tb, b);
  appendTransaksi_({ tanggal: tanggal, jenis: jenis, barang: b, jumlah: jumlah, asal: asal, tujuan: tujuan, petugas: user.nama, ket: ket });
  logActivity_(user.email, jenis, 'Transaksi', b.id_barang, jenis + ': ' + jumlah + ' ' + b.satuan + ' ' + b.nama_barang + ' (' + b.kode_barang + ')');
  return { message: pesan, data: withComputed_(b) };
}

// ======================= AKSI: PEMINJAMAN =======================

function peminjamanEfektif_(r, today) {
  let status = r.status, hari = 0;
  if (r.status === STATUS_PINJAM.DIPINJAM && r.rencana_kembali && r.rencana_kembali < today) {
    status = STATUS_PINJAM.TERLAMBAT;
    hari = daysBetween_(r.rencana_kembali, today);
  } else if (r.status === STATUS_PINJAM.KEMBALI && r.tanggal_kembali && r.rencana_kembali && r.tanggal_kembali > r.rencana_kembali) {
    hari = daysBetween_(r.rencana_kembali, r.tanggal_kembali);
  }
  return { status_efektif: status, hari_terlambat: hari };
}

function actGetPeminjaman_(p, user) {
  const today = todayStr_();
  const filter = p.filter ? String(p.filter) : 'semua';
  const idb = p.id_barang ? vStr_(p.id_barang, 'ID barang', { max: 40 }) : '';
  const all = getTable_('Peminjaman').rows.map(function (r) { return Object.assign(clean_(r), peminjamanEfektif_(r, today), { _row: r._row }); });
  const ringkasan = { aktif: 0, terlambat: 0, riwayat: 0 };
  all.forEach(function (r) {
    if (r.status === STATUS_PINJAM.DIPINJAM) { ringkasan.aktif++; if (r.status_efektif === STATUS_PINJAM.TERLAMBAT) ringkasan.terlambat++; }
    else ringkasan.riwayat++;
  });
  const rows = all.filter(function (r) {
    if (idb && r.id_barang !== idb) return false;
    if (filter === 'aktif') return r.status === STATUS_PINJAM.DIPINJAM;
    if (filter === 'terlambat') return r.status_efektif === STATUS_PINJAM.TERLAMBAT;
    if (filter === 'riwayat') return r.status !== STATUS_PINJAM.DIPINJAM;
    return true;
  });
  return { data: { ringkasan: ringkasan, daftar: sortDesc_(rows, 'tanggal_pinjam').map(clean_) } };
}

function actAddPeminjaman_(p, user) {
  const id = vStr_(p.id_barang, 'Barang', { required: true, max: 40 });
  const nama = vStr_(p.nama_peminjam, 'Nama peminjam', { required: true, max: 100 });
  const identitas = vStr_(p.identitas_peminjam, 'NIS/NIP/identitas', { max: 50 });
  const kelas = vStr_(p.kelas_bagian, 'Kelas/bagian', { max: 50 });
  const jumlah = vNum_(p.jumlah_pinjam, 'Jumlah pinjam', { required: true, integer: true, min: 1, max: 1000000 });
  const tglPinjam = vDate_(p.tanggal_pinjam, 'Tanggal pinjam', { def: todayStr_() });
  const rencana = vDate_(p.rencana_kembali, 'Rencana tanggal kembali', { required: true });
  if (rencana < tglPinjam) throw appError_('Rencana tanggal kembali tidak boleh sebelum tanggal pinjam.');
  const ket = vStr_(p.keterangan, 'Catatan', { max: 500 });

  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', id);
  if (!b || b.status_aktif !== 'Aktif') throw notFound_('Barang');
  const tersedia = hitungTersedia_(b);
  if (jumlah > tersedia) {
    throw appError_('Jumlah pinjam melebihi stok tersedia (' + tersedia + ' ' + b.satuan + '). Barang berkondisi "' + b.kondisi + '".', 'STOCK');
  }
  const kondisiPinjam = vEnum_(p.kondisi_pinjam, 'Kondisi saat dipinjam', KONDISI, b.kondisi);

  b.jumlah_dipinjam += jumlah;
  b.updated_at = nowIso_();
  updateRow_(tb, b);

  const row = {
    id_peminjaman: newId_('PJM'), tanggal_pinjam: tglPinjam, id_barang: b.id_barang, nama_barang: b.nama_barang,
    nama_peminjam: nama, identitas_peminjam: identitas, kelas_bagian: kelas, jumlah_pinjam: jumlah,
    rencana_kembali: rencana, tanggal_kembali: '', kondisi_pinjam: kondisiPinjam, kondisi_kembali: '',
    status: STATUS_PINJAM.DIPINJAM, petugas: user.nama, keterangan: ket
  };
  appendRowFast_('Peminjaman', row);
  logActivity_(user.email, 'Pinjam Barang', 'Peminjaman', row.id_peminjaman, 'Peminjaman ' + jumlah + ' ' + b.satuan + ' ' + b.nama_barang + ' (' + b.kode_barang + ')');
  return { message: 'Peminjaman berhasil dicatat.', data: Object.assign(row, peminjamanEfektif_(row, todayStr_())) };
}

function actReturnBarang_(p, user) {
  const id = vStr_(p.id_peminjaman, 'ID peminjaman', { required: true, max: 40 });
  const kondisiKembali = vEnum_(p.kondisi_kembali, 'Kondisi saat dikembalikan', KONDISI_KEMBALI, 'Baik');
  const catatan = vStr_(p.catatan, 'Catatan pengembalian', { max: 300 });

  const tp = getTable_('Peminjaman');
  const r = findById_(tp, 'id_peminjaman', id);
  if (!r) throw notFound_('Data peminjaman');
  if (r.status !== STATUS_PINJAM.DIPINJAM) throw appError_('Peminjaman ini sudah berstatus "' + r.status + '".', 'CONFLICT');
  const tglKembali = vDate_(p.tanggal_kembali, 'Tanggal pengembalian', { def: todayStr_() });
  if (tglKembali < r.tanggal_pinjam) throw appError_('Tanggal pengembalian tidak boleh sebelum tanggal pinjam.');

  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', r.id_barang);
  if (!b) throw notFound_('Barang yang dipinjam');

  b.jumlah_dipinjam = Math.max(0, b.jumlah_dipinjam - r.jumlah_pinjam);
  b.updated_at = nowIso_();
  let pesan = 'Pengembalian berhasil dicatat.';
  if (kondisiKembali !== 'Baik' && kondisiKembali !== b.kondisi) {
    const hasil = applyKondisiToUnits_(tb, b, r.jumlah_pinjam, kondisiKembali, 'dikembalikan ' + kondisiKembali.toLowerCase());
    if (hasil.split) {
      pesan = 'Pengembalian dicatat. Unit yang rusak dipisah menjadi kode ' + hasil.barang.kode_barang + '.';
      logActivity_(user.email, 'Pisah Barang', 'Barang', hasil.barang.id_barang, r.jumlah_pinjam + ' unit dikembalikan ' + kondisiKembali + ', dipisah dari ' + b.kode_barang + ' menjadi ' + hasil.barang.kode_barang);
    } else {
      pesan = 'Pengembalian dicatat. Kondisi barang diperbarui menjadi "' + kondisiKembali + '".';
    }
  } else {
    updateRow_(tb, b);
  }

  r.tanggal_kembali = tglKembali;
  r.kondisi_kembali = kondisiKembali;
  r.status = STATUS_PINJAM.KEMBALI;
  if (catatan) r.keterangan = ((r.keterangan ? r.keterangan + ' | ' : '') + 'Catatan kembali: ' + catatan).substring(0, 1000);
  updateRow_(tp, r);
  logActivity_(user.email, 'Kembali Barang', 'Peminjaman', r.id_peminjaman, 'Pengembalian ' + r.jumlah_pinjam + ' ' + b.satuan + ' ' + r.nama_barang + ', kondisi ' + kondisiKembali);
  return { message: pesan, data: Object.assign(clean_(r), peminjamanEfektif_(r, todayStr_())) };
}

function actCancelPeminjaman_(p, user) {
  const id = vStr_(p.id_peminjaman, 'ID peminjaman', { required: true, max: 40 });
  const alasan = vStr_(p.catatan, 'Alasan pembatalan', { max: 300 });
  const tp = getTable_('Peminjaman');
  const r = findById_(tp, 'id_peminjaman', id);
  if (!r) throw notFound_('Data peminjaman');
  if (r.status !== STATUS_PINJAM.DIPINJAM) throw appError_('Hanya peminjaman berstatus "Dipinjam" yang dapat dibatalkan.', 'CONFLICT');
  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', r.id_barang);
  if (b) {
    b.jumlah_dipinjam = Math.max(0, b.jumlah_dipinjam - r.jumlah_pinjam);
    b.updated_at = nowIso_();
    updateRow_(tb, b);
  }
  r.status = STATUS_PINJAM.BATAL;
  if (alasan) r.keterangan = ((r.keterangan ? r.keterangan + ' | ' : '') + 'Dibatalkan: ' + alasan).substring(0, 1000);
  updateRow_(tp, r);
  logActivity_(user.email, 'Batal Pinjam', 'Peminjaman', r.id_peminjaman, 'Membatalkan peminjaman ' + r.jumlah_pinjam + ' ' + r.nama_barang);
  return { message: 'Peminjaman dibatalkan dan stok dikembalikan.', data: clean_(r) };
}

// ======================= AKSI: PEMELIHARAAN =======================

function actGetPemeliharaan_(p, user) {
  const status = p.status ? vEnum_(p.status, 'Status', STATUS_MNT) : '';
  const idb = p.id_barang ? vStr_(p.id_barang, 'ID barang', { max: 40 }) : '';
  const all = getTable_('Pemeliharaan').rows;
  const ringkasan = { total: all.length, aktif: 0, sedang_diperbaiki: 0, total_biaya: 0 };
  all.forEach(function (r) {
    if (STATUS_MNT_AKHIR.indexOf(r.status) === -1) ringkasan.aktif++;
    if (r.status === 'Sedang Diperbaiki') ringkasan.sedang_diperbaiki++;
    ringkasan.total_biaya += r.biaya;
  });
  ringkasan.total_biaya = round2_(ringkasan.total_biaya);
  const rows = all.filter(function (r) { return (!status || r.status === status) && (!idb || r.id_barang === idb); });
  return { data: { ringkasan: ringkasan, daftar: sortDesc_(rows, 'tanggal_laporan').map(clean_) } };
}

// Menerapkan efek status pemeliharaan terhadap kondisi barang.
function applyMaintenanceStatus_(tb, rec, status) {
  const target = { 'Sedang Diperbaiki': 'Dalam Perbaikan', 'Tidak Dapat Diperbaiki': 'Rusak Berat', 'Selesai': 'Baik' }[status];
  if (!target) return null;
  const b = findById_(tb, 'id_barang', rec.id_barang);
  if (!b) throw notFound_('Barang pada laporan pemeliharaan');
  const qty = Math.min(rec.jumlah_unit || 1, b.jumlah_total);
  if (b.kondisi !== target) {
    if (qty >= b.jumlah_total && b.jumlah_dipinjam > 0) {
      throw appError_('Barang masih dipinjam (' + b.jumlah_dipinjam + ' unit). Selesaikan pengembalian dulu.', 'STOCK');
    }
    if (qty < b.jumlah_total && (b.jumlah_total - b.jumlah_dipinjam) < qty) {
      throw appError_('Unit yang tidak sedang dipinjam tidak cukup untuk tindakan ini.', 'STOCK');
    }
  }
  const hasil = applyKondisiToUnits_(tb, b, qty, target, 'pemeliharaan ' + rec.id_pemeliharaan);
  if (hasil.split) rec.id_barang = hasil.barang.id_barang;
  rec.nama_barang = hasil.barang.nama_barang;
  return hasil;
}

function actAddPemeliharaan_(p, user) {
  const id = vStr_(p.id_barang, 'Barang', { required: true, max: 40 });
  const tb = getTable_('Barang');
  const b = findById_(tb, 'id_barang', id);
  if (!b || b.status_aktif !== 'Aktif') throw notFound_('Barang');
  const jumlahUnit = vNum_(p.jumlah_unit, 'Jumlah unit bermasalah', { integer: true, min: 1, max: 1000000, def: 1 });
  if (jumlahUnit > b.jumlah_total) throw appError_('Jumlah unit bermasalah melebihi jumlah barang (' + b.jumlah_total + ').', 'STOCK');
  const tglLapor = vDate_(p.tanggal_laporan, 'Tanggal laporan', { def: todayStr_() });
  const status = vEnum_(p.status, 'Status pemeliharaan', STATUS_MNT_AWAL, 'Dilaporkan');
  const rec = {
    id_pemeliharaan: newId_('MNT'), id_barang: b.id_barang, nama_barang: b.nama_barang, tanggal_laporan: tglLapor,
    deskripsi_kerusakan: vStr_(p.deskripsi_kerusakan, 'Deskripsi kerusakan', { required: true, max: 1000 }),
    pelapor: vStr_(p.pelapor, 'Nama pelapor', { max: 100 }) || user.nama,
    tindakan_perbaikan: vStr_(p.tindakan_perbaikan, 'Tindakan perbaikan', { max: 1000 }),
    biaya: vNum_(p.biaya, 'Biaya perbaikan', { min: 0, def: 0 }),
    teknisi: vStr_(p.teknisi, 'Teknisi/petugas', { max: 100 }),
    status: status, tanggal_selesai: '', catatan: vStr_(p.catatan, 'Catatan', { max: 1000 }), jumlah_unit: jumlahUnit
  };
  applyMaintenanceStatus_(tb, rec, status);
  appendRowFast_('Pemeliharaan', rec);
  logActivity_(user.email, 'Lapor Kerusakan', 'Pemeliharaan', rec.id_pemeliharaan, 'Laporan ' + b.nama_barang + ' (' + jumlahUnit + ' unit), status ' + status);
  return { message: 'Laporan pemeliharaan berhasil dicatat.', data: rec };
}

function actUpdatePemeliharaan_(p, user) {
  const id = vStr_(p.id_pemeliharaan, 'ID pemeliharaan', { required: true, max: 40 });
  const tm = getTable_('Pemeliharaan');
  const rec = findById_(tm, 'id_pemeliharaan', id);
  if (!rec) throw notFound_('Laporan pemeliharaan');
  if (STATUS_MNT_AKHIR.indexOf(rec.status) > -1) throw appError_('Laporan ini sudah berstatus "' + rec.status + '" dan tidak dapat diubah.', 'CONFLICT');

  const statusBaru = vEnum_(p.status, 'Status pemeliharaan', STATUS_MNT, rec.status);
  const final = STATUS_MNT_AKHIR.indexOf(statusBaru) > -1;
  const tglSelesai = final ? vDate_(p.tanggal_selesai, 'Tanggal selesai', { def: todayStr_() }) : '';
  if (final && tglSelesai < rec.tanggal_laporan) throw appError_('Tanggal selesai tidak boleh sebelum tanggal laporan.');

  rec.tindakan_perbaikan = vStr_(p.tindakan_perbaikan === undefined ? rec.tindakan_perbaikan : p.tindakan_perbaikan, 'Tindakan perbaikan', { max: 1000 });
  rec.biaya = vNum_(p.biaya === undefined ? rec.biaya : p.biaya, 'Biaya perbaikan', { min: 0, def: 0 });
  rec.teknisi = vStr_(p.teknisi === undefined ? rec.teknisi : p.teknisi, 'Teknisi/petugas', { max: 100 });
  rec.catatan = vStr_(p.catatan === undefined ? rec.catatan : p.catatan, 'Catatan', { max: 1000 });
  rec.tanggal_selesai = tglSelesai;

  const statusLama = rec.status;
  if (statusBaru !== statusLama) {
    applyMaintenanceStatus_(getTable_('Barang'), rec, statusBaru);
    rec.status = statusBaru;
  }
  updateRow_(tm, rec);
  logActivity_(user.email, 'Ubah Pemeliharaan', 'Pemeliharaan', rec.id_pemeliharaan, rec.nama_barang + ': ' + statusLama + ' → ' + statusBaru);
  return { message: 'Data pemeliharaan berhasil diperbarui.', data: clean_(rec) };
}

// ======================= AKSI: KATEGORI & LOKASI =======================

function actGetKategori_(p, user) {
  const semua = user.role === ROLE.ADMIN && p.semua;
  const rows = getTable_('Kategori').rows.filter(function (r) { return semua || r.status === 'Aktif'; });
  return { data: rows.map(clean_).sort(function (a, b) { return a.nama_kategori.localeCompare(b.nama_kategori); }) };
}

function actAddKategori_(p, user) {
  const tk = getTable_('Kategori');
  const nama = vStr_(p.nama_kategori, 'Nama kategori', { required: true, max: 100 });
  if (tk.rows.some(function (r) { return String(r.nama_kategori).toLowerCase() === nama.toLowerCase(); })) throw appError_('Kategori "' + nama + '" sudah ada.');
  const row = appendRow_(tk, { id_kategori: newId_('KAT'), nama_kategori: nama, deskripsi: vStr_(p.deskripsi, 'Deskripsi', { max: 300 }), status: 'Aktif' });
  logActivity_(user.email, 'Tambah Kategori', 'Kategori', row.id_kategori, 'Menambah kategori ' + nama);
  return { message: 'Kategori berhasil ditambahkan.', data: clean_(row) };
}

// Nama kategori tidak dapat diubah karena dipakai sebagai nilai di sheet Barang.
function actUpdateKategori_(p, user) {
  const tk = getTable_('Kategori');
  const r = findById_(tk, 'id_kategori', vStr_(p.id_kategori, 'ID kategori', { required: true, max: 40 }));
  if (!r) throw notFound_('Kategori');
  r.deskripsi = vStr_(p.deskripsi === undefined ? r.deskripsi : p.deskripsi, 'Deskripsi', { max: 300 });
  r.status = vEnum_(p.status, 'Status', STATUS_AKTIF_LIST, r.status);
  updateRow_(tk, r);
  logActivity_(user.email, 'Ubah Kategori', 'Kategori', r.id_kategori, 'Memperbarui kategori ' + r.nama_kategori + ' (' + r.status + ')');
  return { message: 'Kategori berhasil diperbarui.', data: clean_(r) };
}

function actGetLokasi_(p, user) {
  const semua = user.role === ROLE.ADMIN && p.semua;
  const rows = getTable_('Lokasi').rows.filter(function (r) { return semua || r.status === 'Aktif'; });
  return { data: rows.map(clean_).sort(function (a, b) { return a.nama_lokasi.localeCompare(b.nama_lokasi); }) };
}

function actAddLokasi_(p, user) {
  const tl = getTable_('Lokasi');
  const nama = vStr_(p.nama_lokasi, 'Nama lokasi', { required: true, max: 100 });
  if (tl.rows.some(function (r) { return String(r.nama_lokasi).toLowerCase() === nama.toLowerCase(); })) throw appError_('Lokasi "' + nama + '" sudah ada.');
  const row = appendRow_(tl, { id_lokasi: newId_('LOK'), nama_lokasi: nama, keterangan: vStr_(p.keterangan, 'Keterangan', { max: 300 }), status: 'Aktif' });
  logActivity_(user.email, 'Tambah Lokasi', 'Lokasi', row.id_lokasi, 'Menambah lokasi ' + nama);
  return { message: 'Lokasi berhasil ditambahkan.', data: clean_(row) };
}

function actUpdateLokasi_(p, user) {
  const tl = getTable_('Lokasi');
  const r = findById_(tl, 'id_lokasi', vStr_(p.id_lokasi, 'ID lokasi', { required: true, max: 40 }));
  if (!r) throw notFound_('Lokasi');
  r.keterangan = vStr_(p.keterangan === undefined ? r.keterangan : p.keterangan, 'Keterangan', { max: 300 });
  r.status = vEnum_(p.status, 'Status', STATUS_AKTIF_LIST, r.status);
  updateRow_(tl, r);
  logActivity_(user.email, 'Ubah Lokasi', 'Lokasi', r.id_lokasi, 'Memperbarui lokasi ' + r.nama_lokasi + ' (' + r.status + ')');
  return { message: 'Lokasi berhasil diperbarui.', data: clean_(r) };
}

// ======================= AKSI: PENGGUNA & LOG =======================

function actGetPengguna_(p, user) {
  return { data: getTable_('Pengguna').rows.map(clean_) };
}

function cekDomain_(email) {
  const domains = prop_('ALLOWED_DOMAIN', false);
  if (!domains) return;
  const allowed = domains.split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean);
  if (allowed.length && allowed.indexOf(email.split('@')[1] || '') === -1) throw appError_('Domain email tidak diizinkan (' + allowed.join(', ') + ').');
}

function actAddPengguna_(p, user) {
  const tp = getTable_('Pengguna');
  const email = vEmail_(p.email, 'Email');
  cekDomain_(email);
  if (tp.rows.some(function (r) { return String(r.email).toLowerCase() === email; })) throw appError_('Email ini sudah terdaftar.');
  const row = appendRow_(tp, {
    id_pengguna: newId_('USR'), nama: vStr_(p.nama, 'Nama', { required: true, max: 100 }), email: email,
    role: vEnum_(p.role, 'Role', ROLE_LIST), status: vEnum_(p.status, 'Status', STATUS_AKTIF_LIST, 'Aktif'), created_at: nowIso_()
  });
  clearUsersCache_();
  logActivity_(user.email, 'Tambah Pengguna', 'Pengguna', row.id_pengguna, 'Menambah pengguna ' + email + ' sebagai ' + row.role);
  return { message: 'Pengguna berhasil ditambahkan.', data: clean_(row) };
}

function actUpdatePengguna_(p, user) {
  const tp = getTable_('Pengguna');
  const r = findById_(tp, 'id_pengguna', vStr_(p.id_pengguna, 'ID pengguna', { required: true, max: 40 }));
  if (!r) throw notFound_('Pengguna');
  const nama = vStr_(p.nama === undefined ? r.nama : p.nama, 'Nama', { required: true, max: 100 });
  const role = vEnum_(p.role, 'Role', ROLE_LIST, r.role);
  const status = vEnum_(p.status, 'Status', STATUS_AKTIF_LIST, r.status);
  const adminLain = tp.rows.filter(function (x) { return x !== r && x.role === ROLE.ADMIN && x.status === 'Aktif'; }).length;
  if (adminLain === 0 && !(role === ROLE.ADMIN && status === 'Aktif')) {
    throw appError_('Minimal harus ada satu Admin aktif. Perubahan dibatalkan.', 'CONFLICT');
  }
  r.nama = nama; r.role = role; r.status = status;
  updateRow_(tp, r);
  clearUsersCache_();
  logActivity_(user.email, 'Ubah Pengguna', 'Pengguna', r.id_pengguna, 'Memperbarui pengguna ' + r.email + ': ' + role + ', ' + status);
  return { message: 'Pengguna berhasil diperbarui.', data: clean_(r) };
}

function actGetLogAktivitas_(p, user) {
  const limit = Math.min(Math.max(Number(p.limit) || 200, 1), 1000);
  return { data: readLastRows_('LogAktivitas', limit) };
}

// ======================= AKSI: DASHBOARD =======================

function actGetDashboard_(p, user) {
  const barang = getTable_('Barang').rows.filter(function (b) { return b.status_aktif === 'Aktif'; });
  const trx = getTable_('Transaksi').rows;
  const pinjam = getTable_('Peminjaman').rows;
  const mnt = getTable_('Pemeliharaan').rows;
  const today = todayStr_();

  const kartu = {
    total_jenis: barang.length, total_unit: 0, baik: 0, rusak_ringan: 0, rusak_berat: 0,
    dalam_perbaikan: 0, tidak_diketahui: 0, dipinjam: 0, diperbaiki: 0, perlu_tindak_lanjut: 0
  };
  const perKategori = {}, perLokasi = {}, perKondisi = {};
  KONDISI.forEach(function (k) { perKondisi[k] = 0; });
  const perluTindak = {};

  barang.forEach(function (b) {
    kartu.total_unit += b.jumlah_total;
    kartu.dipinjam += b.jumlah_dipinjam;
    perKondisi[b.kondisi] = (perKondisi[b.kondisi] || 0) + b.jumlah_total;
    perKategori[b.kategori] = (perKategori[b.kategori] || 0) + b.jumlah_total;
    perLokasi[b.lokasi] = (perLokasi[b.lokasi] || 0) + b.jumlah_total;
    if (b.kondisi === 'Rusak Berat' || b.kondisi === 'Tidak Diketahui') perluTindak[b.id_barang] = true;
  });
  kartu.baik = perKondisi['Baik'];
  kartu.rusak_ringan = perKondisi['Rusak Ringan'];
  kartu.rusak_berat = perKondisi['Rusak Berat'];
  kartu.dalam_perbaikan = perKondisi['Dalam Perbaikan'];
  kartu.tidak_diketahui = perKondisi['Tidak Diketahui'];
  kartu.diperbaiki = perKondisi['Dalam Perbaikan'];

  pinjam.forEach(function (r) {
    if (r.status === STATUS_PINJAM.DIPINJAM && r.rencana_kembali && r.rencana_kembali < today) perluTindak[r.id_barang] = true;
  });
  mnt.forEach(function (r) {
    if (r.status === 'Dilaporkan' || r.status === 'Menunggu Perbaikan') perluTindak[r.id_barang] = true;
  });
  const aktifIds = {};
  barang.forEach(function (b) { aktifIds[b.id_barang] = true; });
  kartu.perlu_tindak_lanjut = Object.keys(perluTindak).filter(function (k) { return aktifIds[k]; }).length;

  const toList = function (map) {
    return Object.keys(map).map(function (k) { return { label: k, nilai: map[k] }; }).sort(function (a, b) { return b.nilai - a.nilai; });
  };

  // Barang masuk & keluar 12 bulan terakhir
  const bulan = [], idx = {};
  let y = Number(today.substr(0, 4)), m = Number(today.substr(5, 2));
  for (let i = 0; i < 12; i++) {
    const key = y + '-' + pad_(m, 2);
    bulan.unshift({ bulan: key, label: BULAN[m - 1] + ' ' + y, masuk: 0, keluar: 0 });
    m--; if (m === 0) { m = 12; y--; }
  }
  bulan.forEach(function (b, i) { idx[b.bulan] = i; });
  trx.forEach(function (t) {
    const i = idx[String(t.tanggal).substr(0, 7)];
    if (i === undefined) return;
    if (JT_MASUK.indexOf(t.jenis_transaksi) > -1) bulan[i].masuk += t.jumlah;
    else if (JT_KELUAR.indexOf(t.jenis_transaksi) > -1) bulan[i].keluar += t.jumlah;
  });

  let logs = readLastRows_('LogAktivitas', 100);
  if (user.role === ROLE.VIEWER) logs = logs.filter(function (l) { return l.modul === 'Barang'; });
  const aktivitas = logs.slice(0, 10).map(function (l) {
    return {
      timestamp: l.timestamp, aksi: l.aksi, modul: l.modul, id_referensi: l.id_referensi, deskripsi: l.deskripsi,
      pengguna: user.role === ROLE.ADMIN ? l.email_pengguna : ''
    };
  });

  return {
    data: {
      kartu: kartu,
      grafik: { per_kategori: toList(perKategori), per_kondisi: toList(perKondisi), per_lokasi: toList(perLokasi), transaksi_bulanan: bulan },
      aktivitas_terbaru: aktivitas,
      dibuat: nowIso_()
    }
  };
}

// ======================= AKSI: LAPORAN =======================

function groupBarang_(list, key) {
  const map = {};
  list.forEach(function (b) {
    const k = b[key] || '(Tidak diisi)';
    if (!map[k]) map[k] = { nama: k, jenis: 0, unit: 0, nilai: 0 };
    map[k].jenis += 1;
    map[k].unit += b.jumlah_total;
    map[k].nilai += b.jumlah_total * b.harga_satuan;
  });
  return Object.keys(map).map(function (k) { map[k].nilai = round2_(map[k].nilai); return map[k]; })
    .sort(function (a, b) { return b.unit - a.unit; });
}

function actGetLaporan_(p, user) {
  const jenis = vEnum_(p.jenis, 'Jenis laporan', LAPORAN_JENIS);
  if (user.role === ROLE.VIEWER && LAPORAN_VIEWER.indexOf(jenis) === -1) {
    throw appError_('Anda tidak memiliki hak akses untuk laporan ini.', 'FORBIDDEN');
  }
  const dari = vDate_(p.dari, 'Tanggal awal', {});
  const sampai = vDate_(p.sampai, 'Tanggal akhir', {});
  if (dari && sampai && dari > sampai) throw appError_('Tanggal awal tidak boleh setelah tanggal akhir.');
  const kategori = vStr_(p.kategori, 'Kategori', { max: 100 });
  const today = todayStr_();
  const inRange = function (d) { return (!dari || (d && d >= dari)) && (!sampai || (d && d <= sampai)); };

  const semuaBarang = getTable_('Barang').rows;
  const mapBarang = {};
  semuaBarang.forEach(function (b) { mapBarang[b.id_barang] = b; });
  const kategoriOk = function (idb) { return !kategori || (mapBarang[idb] && mapBarang[idb].kategori === kategori); };
  const stok = semuaBarang.filter(function (b) {
    return b.status_aktif === 'Aktif' && (!kategori || b.kategori === kategori) && inRange(b.tanggal_pengadaan);
  });

  const out = { jenis: jenis, periode: { dari: dari, sampai: sampai }, kategori: kategori, dibuat: nowIso_(), judul: '', kolom: [], baris: [], ringkasan: [] };
  const K = function (key, label, tipe) { return { key: key, label: label, tipe: tipe || 'teks' }; };
  const ringkasStok = function (rows) {
    let unit = 0, nilai = 0;
    rows.forEach(function (b) { unit += b.jumlah_total; nilai += b.jumlah_total * b.harga_satuan; });
    return [
      { label: 'Jenis barang', nilai: rows.length, tipe: 'angka' },
      { label: 'Total unit', nilai: unit, tipe: 'angka' },
      { label: 'Total nilai', nilai: round2_(nilai), tipe: 'rupiah' }
    ];
  };

  if (jenis === 'inventaris') {
    out.judul = 'Laporan Inventaris Keseluruhan';
    out.kolom = [K('kode_barang', 'Kode'), K('nama_barang', 'Nama Barang'), K('kategori', 'Kategori'), K('jumlah_total', 'Jumlah', 'angka'),
      K('jumlah_dipinjam', 'Dipinjam', 'angka'), K('tersedia', 'Tersedia', 'angka'), K('kondisi', 'Kondisi'), K('lokasi', 'Lokasi'),
      K('harga_satuan', 'Harga Satuan', 'rupiah'), K('total_nilai', 'Total Nilai', 'rupiah')];
    out.baris = stok.map(function (b) {
      const c = withComputed_(b);
      return { kode_barang: c.kode_barang, nama_barang: c.nama_barang, kategori: c.kategori, jumlah_total: c.jumlah_total,
        jumlah_dipinjam: c.jumlah_dipinjam, tersedia: c.tersedia, kondisi: c.kondisi, lokasi: c.lokasi,
        harga_satuan: c.harga_satuan, total_nilai: c.total_nilai };
    });
    out.ringkasan = ringkasStok(stok);
  } else if (jenis === 'kategori' || jenis === 'kondisi' || jenis === 'lokasi') {
    const judul = { kategori: 'Laporan Barang Berdasarkan Kategori', kondisi: 'Laporan Kondisi Barang', lokasi: 'Laporan Barang Berdasarkan Lokasi' };
    out.judul = judul[jenis];
    out.kolom = [K('nama', jenis.charAt(0).toUpperCase() + jenis.slice(1)), K('jenis', 'Jenis Barang', 'angka'), K('unit', 'Total Unit', 'angka'), K('nilai', 'Total Nilai', 'rupiah')];
    out.baris = groupBarang_(stok, jenis);
    out.ringkasan = ringkasStok(stok);
  } else if (jenis === 'nilai') {
    out.judul = 'Laporan Nilai Inventaris';
    const g = groupBarang_(stok, 'kategori');
    const totalNilai = g.reduce(function (s, x) { return s + x.nilai; }, 0);
    out.kolom = [K('nama', 'Kategori'), K('jenis', 'Jenis Barang', 'angka'), K('unit', 'Total Unit', 'angka'), K('nilai', 'Total Nilai', 'rupiah'), K('persen', 'Persentase (%)', 'angka')];
    out.baris = g.sort(function (a, b) { return b.nilai - a.nilai; }).map(function (x) {
      x.persen = totalNilai > 0 ? round2_(x.nilai / totalNilai * 100) : 0;
      return x;
    });
    out.ringkasan = ringkasStok(stok);
  } else if (jenis === 'transaksi') {
    out.judul = 'Laporan Transaksi Barang Masuk dan Keluar';
    const rows = getTable_('Transaksi').rows.filter(function (r) { return inRange(r.tanggal) && kategoriOk(r.id_barang); });
    out.kolom = [K('tanggal', 'Tanggal', 'tanggal'), K('jenis_transaksi', 'Jenis'), K('nama_barang', 'Nama Barang'), K('jumlah', 'Jumlah', 'angka'),
      K('lokasi_asal', 'Asal'), K('lokasi_tujuan', 'Tujuan'), K('petugas', 'Petugas'), K('keterangan', 'Keterangan')];
    out.baris = sortDesc_(rows, 'tanggal').map(clean_);
    let masuk = 0, keluar = 0;
    rows.forEach(function (r) {
      if (JT_MASUK.indexOf(r.jenis_transaksi) > -1) masuk += r.jumlah;
      else if (JT_KELUAR.indexOf(r.jenis_transaksi) > -1) keluar += r.jumlah;
    });
    out.ringkasan = [{ label: 'Jumlah transaksi', nilai: rows.length, tipe: 'angka' }, { label: 'Total unit masuk', nilai: masuk, tipe: 'angka' }, { label: 'Total unit keluar', nilai: keluar, tipe: 'angka' }];
  } else if (jenis === 'peminjaman' || jenis === 'keterlambatan') {
    const rows = getTable_('Peminjaman').rows.filter(function (r) { return inRange(r.tanggal_pinjam) && kategoriOk(r.id_barang); })
      .map(function (r) { return Object.assign(clean_(r), peminjamanEfektif_(r, today), { _row: r._row }); });
    out.kolom = [K('tanggal_pinjam', 'Tgl Pinjam', 'tanggal'), K('nama_barang', 'Nama Barang'), K('nama_peminjam', 'Peminjam'), K('kelas_bagian', 'Kelas/Bagian'),
      K('jumlah_pinjam', 'Jumlah', 'angka'), K('rencana_kembali', 'Rencana Kembali', 'tanggal'), K('tanggal_kembali', 'Tgl Kembali', 'tanggal'),
      K('status_efektif', 'Status'), K('hari_terlambat', 'Hari Terlambat', 'angka')];
    if (jenis === 'peminjaman') {
      out.judul = 'Laporan Peminjaman Barang';
      out.baris = sortDesc_(rows, 'tanggal_pinjam').map(clean_);
      out.ringkasan = [
        { label: 'Total peminjaman', nilai: rows.length, tipe: 'angka' },
        { label: 'Sedang dipinjam', nilai: rows.filter(function (r) { return r.status === STATUS_PINJAM.DIPINJAM; }).length, tipe: 'angka' },
        { label: 'Dikembalikan', nilai: rows.filter(function (r) { return r.status === STATUS_PINJAM.KEMBALI; }).length, tipe: 'angka' }
      ];
    } else {
      out.judul = 'Laporan Keterlambatan Pengembalian';
      const telat = rows.filter(function (r) { return r.hari_terlambat > 0; });
      out.baris = telat.sort(function (a, b) { return b.hari_terlambat - a.hari_terlambat; }).map(clean_);
      out.ringkasan = [
        { label: 'Total keterlambatan', nilai: telat.length, tipe: 'angka' },
        { label: 'Belum dikembalikan', nilai: telat.filter(function (r) { return r.status === STATUS_PINJAM.DIPINJAM; }).length, tipe: 'angka' }
      ];
    }
  } else if (jenis === 'pemeliharaan') {
    out.judul = 'Laporan Pemeliharaan dan Perbaikan';
    const rows = getTable_('Pemeliharaan').rows.filter(function (r) { return inRange(r.tanggal_laporan) && kategoriOk(r.id_barang); });
    out.kolom = [K('tanggal_laporan', 'Tgl Laporan', 'tanggal'), K('nama_barang', 'Nama Barang'), K('jumlah_unit', 'Unit', 'angka'),
      K('deskripsi_kerusakan', 'Kerusakan'), K('tindakan_perbaikan', 'Tindakan'), K('teknisi', 'Teknisi'), K('status', 'Status'),
      K('biaya', 'Biaya', 'rupiah'), K('tanggal_selesai', 'Tgl Selesai', 'tanggal')];
    out.baris = sortDesc_(rows, 'tanggal_laporan').map(clean_);
    const biaya = rows.reduce(function (s, r) { return s + r.biaya; }, 0);
    out.ringkasan = [
      { label: 'Jumlah laporan', nilai: rows.length, tipe: 'angka' },
      { label: 'Belum selesai', nilai: rows.filter(function (r) { return STATUS_MNT_AKHIR.indexOf(r.status) === -1; }).length, tipe: 'angka' },
      { label: 'Total biaya', nilai: round2_(biaya), tipe: 'rupiah' }
    ];
  }
  return { data: out };
}

// ======================= DATA DEMO (dipanggil manual) =======================

function seedDemoData() {
  setupDatabase();
  runWithLock_(function () {
    if (getTable_('Barang').rows.length > 0) {
      throw appError_('Sheet Barang sudah berisi data. seedDemoData() hanya untuk database kosong.', 'CONFLICT');
    }
    const u = { email: 'seed@sistem.local', nama: 'Seed Demo', role: ROLE.ADMIN };
    const contoh = [
      ['Komputer PC Core i5', 'Komputer dan PC', 'Lenovo', 'ThinkCentre M70s', 20, 'unit', 'Baik', 'Lab TKJ 1', 7500000],
      ['Monitor LED 22 inci', 'Monitor', 'Dell', 'E2220H', 18, 'unit', 'Baik', 'Lab TKJ 1', 1450000],
      ['Monitor LED 22 inci (rusak)', 'Monitor', 'Dell', 'E2220H', 2, 'unit', 'Rusak Berat', 'Gudang Lab', 1450000],
      ['Router MikroTik', 'Router', 'MikroTik', 'RB951Ui-2HnD', 6, 'unit', 'Baik', 'Lab TKJ 2', 650000],
      ['Switch 24 Port', 'Switch', 'TP-Link', 'TL-SG1024D', 4, 'unit', 'Baik', 'Lab TKJ 2', 1100000],
      ['Access Point', 'Access Point', 'Ubiquiti', 'UniFi AP AC Lite', 5, 'unit', 'Baik', 'Ruang Server', 1250000],
      ['Kabel UTP Cat6', 'Kabel Jaringan', 'Belden', 'Cat6 305 m', 8, 'roll', 'Baik', 'Gudang Lab', 1800000],
      ['LAN Tester', 'LAN Tester', 'Krisbow', 'RJ45/RJ11', 10, 'unit', 'Baik', 'Lab TKJ 1', 85000],
      ['Tang Crimping', 'Tang Crimping', 'Krisbow', 'RJ45', 10, 'unit', 'Baik', 'Lab TKJ 1', 120000]
    ];
    const dibuat = {};
    contoh.forEach(function (c) {
      const r = actAddBarang_({
        nama_barang: c[0], kategori: c[1], merek: c[2], model: c[3], jumlah_total: c[4], satuan: c[5], kondisi: c[6],
        lokasi: c[7], harga_satuan: c[8], sumber_pengadaan: 'Data demo', penanggung_jawab: 'Kepala Lab TKJ',
        keterangan: 'Data demo untuk pengujian', tanggal_pengadaan: addDays_(todayStr_(), -400)
      }, u);
      dibuat[c[0]] = r.data;
    });
    const today = todayStr_();
    actAddPeminjaman_({
      id_barang: dibuat['LAN Tester'].id_barang, nama_peminjam: 'Contoh Peminjam (Demo)', identitas_peminjam: 'DEMO-001',
      kelas_bagian: 'XI TKJ 1', jumlah_pinjam: 3, tanggal_pinjam: addDays_(today, -14), rencana_kembali: addDays_(today, -7),
      keterangan: 'Data demo (terlambat)'
    }, u);
    actAddPemeliharaan_({
      id_barang: dibuat['Router MikroTik'].id_barang, jumlah_unit: 1, deskripsi_kerusakan: 'Port LAN 3 tidak mendeteksi kabel (data demo)',
      pelapor: 'Contoh Pelapor', status: 'Dilaporkan'
    }, u);
    logActivity_(u.email, 'Seed Demo', 'Sistem', '', 'Data demo dimasukkan melalui seedDemoData()');
  });
  Logger.log('seedDemoData selesai.');
}
