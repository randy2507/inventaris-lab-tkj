/* =====================================================================
   SISTEM INFORMASI INVENTARIS LABORATORIUM TKJ — script.js (INTI)
   Bagian 3B. Modul layar (dashboard, barang, dst.) ada di file terpisah
   dan mendaftar lewat App.registerView(nama, { render, actions }).
   ===================================================================== */
'use strict';

/* ---------- KONFIGURASI (ubah di sini) ---------- */
const CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyJoSBroPUk2YNzBoXokoSzIxDvhaUE8P9uRwnDim6ok9U96BAuAtKVVDBI9s7KyHtyUw/exec',
  REQUEST_TIMEOUT_MS: 30000,
  BOOT_MS: 1800,
  PREFIX: 'invtkj_'
};

/* ---------- STATE ---------- */
const state = { token: '', me: null, izin: [], enums: {}, kategori: [], lokasi: [], pendingSearch: '', tapeStart: 0 };
const views = {};
let renderSeq = 0, loadingCount = 0, modalSeq = 0, uidSeq = 0, clockTimer = null;
const modalStack = [];

/* ---------- UTILITAS DASAR ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ESC_MAP[c]); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function uid() { return ++uidSeq; }
function refreshIcons() { if (window.lucide && lucide.createIcons) lucide.createIcons(); }
function storeGet(k) { try { return localStorage.getItem(CONFIG.PREFIX + k); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(CONFIG.PREFIX + k, v); } catch (e) { /* diabaikan */ } }
function sessGet(k) { try { return sessionStorage.getItem(CONFIG.PREFIX + k); } catch (e) { return null; } }
function sessSet(k, v) { try { if (v === null) sessionStorage.removeItem(CONFIG.PREFIX + k); else sessionStorage.setItem(CONFIG.PREFIX + k, v); } catch (e) { /* diabaikan */ } }
function can(action) { return state.izin.indexOf(action) > -1; }

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : '-';
}
function fmtDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}, ${m[4]}.${m[5]}` : fmtDate(s);
}
const rupiahFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('id-ID');
function fmtRupiah(n) { return rupiahFmt.format(Number(n) || 0); }
function fmtNum(n) { return numFmt.format(Number(n) || 0); }
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysLocal(s, n) {
  const p = s.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000).toISOString().substr(0, 10);
}
function barangOptions(list) {
  return list.slice().sort((a, b) => String(a.nama_barang).localeCompare(String(b.nama_barang), 'id'))
    .map(b => ({ value: b.id_barang, label: `${b.kode_barang} — ${b.nama_barang} (tersedia ${b.tersedia} ${b.satuan})` }));
}

const KONDISI_TONE = { 'Baik': 'ok', 'Rusak Ringan': 'warn', 'Rusak Berat': 'bad', 'Dalam Perbaikan': 'info', 'Tidak Diketahui': 'muted' };
const STATUS_TONE = {
  'Dipinjam': 'info', 'Terlambat': 'bad', 'Dikembalikan': 'ok', 'Dibatalkan': 'muted',
  'Dilaporkan': 'warn', 'Menunggu Perbaikan': 'warn', 'Sedang Diperbaiki': 'info', 'Selesai': 'ok', 'Tidak Dapat Diperbaiki': 'bad',
  'Aktif': 'ok', 'Nonaktif': 'muted'
};
function badge(text, tone) { return `<span class="badge badge-${tone || 'muted'}">${esc(text)}</span>`; }
function badgeKondisi(k) { return badge(k, KONDISI_TONE[k]); }
function badgeStatus(s) { return badge(s, STATUS_TONE[s]); }

/* ---------- TOAST & LOADING ---------- */
function showToast(message, type) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'ok');
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 7000 : 4200);
}
function showLoading(text) {
  loadingCount++;
  $('#loading-text').textContent = text || 'Memuat data';
  $('#loading').hidden = false;
}
function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) $('#loading').hidden = true;
}
function reportError(err, fallback) {
  const msg = (err && err.message) ? err.message : (fallback || 'Terjadi kesalahan.');
  showToast(msg, 'err');
}

/* ---------- API ---------- */
class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || 'ERROR'; }
}

// Semua permintaan memakai POST text/plain agar tidak memicu preflight CORS.
async function apiRequest(action, payload, opts) {
  opts = opts || {};
  if (!state.token && action !== 'login') throw new ApiError('Anda belum masuk.', 'UNAUTHENTICATED');
  if (!opts.silent) showLoading(opts.loadingText);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(CONFIG.BACKEND_URL, {
        method: 'POST', redirect: 'follow', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: state.token || '', payload: payload || {} })
      });
    } catch (e) {
      throw new ApiError(e.name === 'AbortError'
        ? 'Server terlalu lama merespons. Coba lagi.'
        : 'Backend tidak dapat dihubungi. Periksa koneksi internet dan URL deployment.', 'NETWORK');
    }
    let json;
    try { json = await res.json(); } catch (e) {
      throw new ApiError('Respons backend tidak valid. Pastikan Web App di-deploy dengan akses "Anyone" dan URL-nya benar.', 'BAD_RESPONSE');
    }
    if (!json || json.success !== true) {
      if (json && json.code === 'UNAUTHENTICATED') endSession(json.message, true);
      throw new ApiError((json && json.message) || 'Permintaan gagal.', (json && json.code) || 'ERROR');
    }
    return json;
  } finally {
    clearTimeout(timer);
    if (!opts.silent) hideLoading();
  }
}

// Pembungkus per fitur. Nama mengikuti kontrak aksi backend (Code.gs).
const getMe = () => apiRequest('getMe', {}, { silent: true });
const changePassword = d => apiRequest('changePassword', d, { loadingText: 'Menyimpan password' });
const resetPasswordPengguna = d => apiRequest('resetPasswordPengguna', d, { loadingText: 'Mengatur ulang password' });
const getDashboardData = () => apiRequest('getDashboard', {}, { loadingText: 'Memuat dashboard' }).then(r => r.data);
const getBarang = p => apiRequest('getBarang', p).then(r => r.data);
const getBarangById = id => apiRequest('getBarangById', { id_barang: id }).then(r => r.data);
const saveBarang = d => apiRequest(d.id_barang ? 'updateBarang' : 'addBarang', d, { loadingText: 'Menyimpan barang' });
const deleteBarang = id => apiRequest('deleteBarang', { id_barang: id }, { loadingText: 'Menghapus barang' });
const getTransaksi = p => apiRequest('getTransaksi', p).then(r => r.data);
const saveTransaksi = d => apiRequest('addTransaksi', d, { loadingText: 'Menyimpan transaksi' });
const getPeminjaman = p => apiRequest('getPeminjaman', p).then(r => r.data);
const savePeminjaman = d => apiRequest('addPeminjaman', d, { loadingText: 'Menyimpan peminjaman' });
const processReturn = d => apiRequest('returnBarang', d, { loadingText: 'Memproses pengembalian' });
const cancelPeminjaman = d => apiRequest('cancelPeminjaman', d, { loadingText: 'Membatalkan peminjaman' });
const getPemeliharaan = p => apiRequest('getPemeliharaan', p).then(r => r.data);
const savePemeliharaan = d => apiRequest(d.id_pemeliharaan ? 'updatePemeliharaan' : 'addPemeliharaan', d, { loadingText: 'Menyimpan data pemeliharaan' });
const getKategori = p => apiRequest('getKategori', p).then(r => r.data);
const saveKategori = d => apiRequest(d.id_kategori ? 'updateKategori' : 'addKategori', d, { loadingText: 'Menyimpan kategori' });
const getLokasi = p => apiRequest('getLokasi', p).then(r => r.data);
const saveLokasi = d => apiRequest(d.id_lokasi ? 'updateLokasi' : 'addLokasi', d, { loadingText: 'Menyimpan lokasi' });
const getPengguna = () => apiRequest('getPengguna').then(r => r.data);
const savePengguna = d => apiRequest(d.id_pengguna ? 'updatePengguna' : 'addPengguna', d, { loadingText: 'Menyimpan pengguna' });
const getLaporan = p => apiRequest('getLaporan', p, { loadingText: 'Menyusun laporan' }).then(r => r.data);
const getLogAktivitas = p => apiRequest('getLogAktivitas', p).then(r => r.data);

async function loadMeta() {
  const r = await getMe();
  const d = r.data;
  state.me = d.user; state.izin = d.izin; state.enums = d.enum; state.kategori = d.kategori; state.lokasi = d.lokasi;
  return d;
}

/* ---------- MODAL ---------- */
function openModal(opt) {
  const prev = document.activeElement;
  const id = 'm' + (++modalSeq);
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${opt.size === 'lg' ? 'modal-lg' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
    <div class="modal-header"><h2 id="${id}-t">${esc(opt.title)}</h2>
      <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Tutup"><i data-lucide="x"></i></button></div>
    <div class="modal-body"></div>${opt.footer ? '<div class="modal-footer"></div>' : ''}</div>`;
  const put = (target, content) => { if (typeof content === 'string') target.innerHTML = content; else target.appendChild(content); };
  const body = $('.modal-body', wrap);
  put(body, opt.body || '');
  const footerEl = $('.modal-footer', wrap);
  if (footerEl) put(footerEl, opt.footer);
  const api = {
    el: wrap, body: body, footer: footerEl,
    close(result) {
      const i = modalStack.indexOf(api);
      if (i > -1) modalStack.splice(i, 1);
      wrap.remove();
      if (prev && prev.focus) prev.focus();
      if (opt.onClose) opt.onClose(result);
    }
  };
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
  wrap.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', wrap);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('#modal-root').appendChild(wrap);
  modalStack.push(api);
  refreshIcons();
  const target = $('input:not([type=hidden]), select, textarea', body) || $('[data-close]', wrap);
  if (target) target.focus();
  return api;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
});

function confirmDialog(opt) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title: opt.title || 'Konfirmasi',
      body: `<p>${esc(opt.message || '')}</p>`,
      footer: `<button type="button" class="btn btn-ghost" data-no>${esc(opt.cancelText || 'Batal')}</button>
               <button type="button" class="btn ${opt.danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(opt.confirmText || 'Ya, lanjutkan')}</button>`,
      onClose: () => { if (!done) resolve(false); }
    });
    m.footer.addEventListener('click', e => {
      if (e.target.closest('[data-yes]')) { done = true; m.close(); resolve(true); }
      else if (e.target.closest('[data-no]')) m.close();
    });
    const no = $('[data-no]', m.footer);
    if (no) no.focus();
  });
}

/* ---------- FORMULIR ---------- */
// opt: { name, label, type, required, value, options, placeholder, full, attrs, help }
function field(opt) {
  const id = `f-${opt.name}-${uid()}`;
  const type = opt.type || 'text';
  const req = opt.required ? ' required' : '';
  const common = `id="${id}" name="${esc(opt.name)}" data-label="${esc(opt.label)}" aria-describedby="${id}-e"${req} ${opt.attrs || ''}`;
  const val = (opt.value === null || opt.value === undefined) ? '' : opt.value;
  let control;
  if (type === 'select') {
    const items = (opt.options || []).map(o => {
      const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(v)}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('');
    control = `<select class="select" ${common}>${opt.placeholder !== undefined ? `<option value="">${esc(opt.placeholder)}</option>` : ''}${items}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="textarea" ${common} placeholder="${esc(opt.placeholder || '')}">${esc(val)}</textarea>`;
  } else {
    control = `<input class="input" type="${esc(type)}" ${common} value="${esc(val)}" placeholder="${esc(opt.placeholder || '')}">`;
  }
  return `<div class="field${opt.full ? ' full' : ''}"><label class="field-label" for="${id}">${esc(opt.label)}${opt.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    ${control}${opt.help ? `<span class="sub">${esc(opt.help)}</span>` : ''}<p class="field-error" id="${id}-e" data-err="${esc(opt.name)}" aria-live="polite"></p></div>`;
}

function readForm(form) {
  const data = {};
  $$('[name]', form).forEach(c => { data[c.name] = c.type === 'checkbox' ? c.checked : String(c.value).trim(); });
  return data;
}

// Validasi sisi klien (backend tetap memvalidasi ulang).
function validateForm(form) {
  let ok = true, first = null;
  $$('[name]', form).forEach(c => {
    const err = $(`[data-err="${c.name}"]`, form);
    const v = String(c.value || '').trim();
    const label = c.dataset.label || c.name;
    let msg = '';
    if (c.required && v === '') msg = `${label} wajib diisi.`;
    else if (v !== '' && c.type === 'number') {
      const n = Number(v);
      if (!isFinite(n)) msg = `${label} harus berupa angka.`;
      else if (c.min !== '' && n < Number(c.min)) msg = `${label} tidak boleh kurang dari ${c.min}.`;
      else if (c.max !== '' && n > Number(c.max)) msg = `${label} tidak boleh lebih dari ${c.max}.`;
      else if (c.step === '1' && !Number.isInteger(n)) msg = `${label} harus berupa bilangan bulat.`;
    } else if (v !== '' && c.maxLength > 0 && v.length > c.maxLength) msg = `${label} maksimal ${c.maxLength} karakter.`;
    else if (v !== '' && c.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = `${label} tidak valid.`;
    if (err) err.textContent = msg;
    c.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) { ok = false; if (!first) first = c; }
  });
  if (first) first.focus();
  return { ok: ok, data: readForm(form) };
}

/* ---------- TABEL (sort, paginasi, aksi) ---------- */
function actionBtn(act, key, icon, label, cls) {
  return `<button type="button" class="btn btn-sm btn-icon ${cls || 'btn-ghost'}" data-act="${esc(act)}" data-key="${esc(key)}" aria-label="${esc(label)}" title="${esc(label)}"><i data-lucide="${esc(icon)}"></i></button>`;
}
function emptyState(title, text, actionHtml) {
  return `<div class="empty"><p class="vt">${esc(title)}</p><p>${esc(text || '')}</p>${actionHtml || ''}</div>`;
}

// opt: { container, columns:[{key,label,sortable,align,cls,render(row,no)}], rows, rowKey, pageSize, sortKey, sortDir, caption, empty:{title,text,actionHtml}, onAction(act,key,row) }
function createTable(opt) {
  const box = opt.container;
  const st = { rows: opt.rows || [], sortKey: opt.sortKey || null, sortDir: opt.sortDir || 'asc', page: 1, size: opt.pageSize || 10 };
  const keyOf = r => String(opt.rowKey ? opt.rowKey(r) : r.id);

  function sorted() {
    if (!st.sortKey) return st.rows.slice();
    const k = st.sortKey, dir = st.sortDir === 'asc' ? 1 : -1;
    return st.rows.slice().sort((a, b) => {
      const x = a[k], y = b[k];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x === undefined ? '' : x).localeCompare(String(y === undefined ? '' : y), 'id', { numeric: true, sensitivity: 'base' }) * dir;
    });
  }
  function pageButtons(pages) {
    let start = Math.max(1, st.page - 2), end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    let h = `<button type="button" class="btn btn-sm" data-page="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''} aria-label="Halaman sebelumnya">‹</button>`;
    for (let p = start; p <= end; p++) h += `<button type="button" class="btn btn-sm${p === st.page ? ' current' : ''}" data-page="${p}" ${p === st.page ? 'aria-current="page"' : ''}>${p}</button>`;
    return h + `<button type="button" class="btn btn-sm" data-page="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''} aria-label="Halaman berikutnya">›</button>`;
  }
  function render() {
    const all = sorted();
    if (!all.length) {
      const e = opt.empty || {};
      box.innerHTML = emptyState(e.title || 'TIDAK ADA DATA', e.text || 'Belum ada data yang bisa ditampilkan.', e.actionHtml);
      refreshIcons();
      return;
    }
    const pages = Math.max(1, Math.ceil(all.length / st.size));
    st.page = Math.min(Math.max(1, st.page), pages);
    const from = (st.page - 1) * st.size;
    const slice = all.slice(from, from + st.size);
    const head = opt.columns.map(c => {
      const sortable = c.sortable !== false && c.key && c.key !== '_aksi' && c.key !== '_no';
      const sortCls = sortable && st.sortKey === c.key ? (st.sortDir === 'asc' ? ' sort-asc' : ' sort-desc') : '';
      const aria = sortable ? ` aria-sort="${st.sortKey === c.key ? (st.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}" tabindex="0" data-sort="${esc(c.key)}"` : '';
      return `<th scope="col" class="${sortable ? 'sortable' : ''}${sortCls}${c.align === 'right' ? ' num' : ''}"${aria}>${esc(c.label)}</th>`;
    }).join('');
    const body = slice.map((r, i) => `<tr>${opt.columns.map(c => {
      const content = c.render ? c.render(r, from + i + 1) : esc(r[c.key] === undefined || r[c.key] === '' ? '-' : r[c.key]);
      return `<td class="${c.align === 'right' ? 'num' : ''} ${c.cls || ''}">${content}</td>`;
    }).join('')}</tr>`).join('');
    box.innerHTML = `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(opt.caption || 'Tabel data')}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="pagination"><span>Menampilkan ${from + 1}–${from + slice.length} dari ${fmtNum(all.length)} data</span>
      <label class="no-print">Baris per halaman <select class="select" data-size style="width:auto;display:inline-block;padding:4px 8px">${[10, 25, 50, 100].map(n => `<option${n === st.size ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <span class="pages">${pageButtons(pages)}</span></div>`;
    refreshIcons();
  }

  box.onclick = e => {
    const th = e.target.closest('[data-sort]');
    if (th) { sortBy(th.dataset.sort); return; }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { st.page = Number(pg.dataset.page); render(); return; }
    const act = e.target.closest('[data-act]');
    if (act && opt.onAction) {
      const row = st.rows.find(r => keyOf(r) === act.dataset.key);
      if (row) opt.onAction(act.dataset.act, act.dataset.key, row);
    }
  };
  box.onkeydown = e => {
    const th = e.target.closest('[data-sort]');
    if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th.dataset.sort); }
  };
  box.onchange = e => {
    if (e.target.matches('[data-size]')) { st.size = Number(e.target.value); st.page = 1; render(); }
  };
  function sortBy(key) {
    if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
    else { st.sortKey = key; st.sortDir = 'asc'; }
    st.page = 1; render();
  }
  render();
  return {
    setRows(rows, keepPage) { st.rows = rows || []; if (!keepPage) st.page = 1; render(); },
    render: render,
    sortedRows: sorted
  };
}

/* ---------- GRAFIK ---------- */
const VHS_COLORS = ['#00e5ff', '#ff2e97', '#2f5bff', '#ffd23f', '#3dffa2', '#9b6bff', '#ff8a3d', '#5be3d0'];
const charts = {};
function drawChart(id, canvas, config) {
  if (!window.Chart) { canvas.parentElement.innerHTML = '<p class="sub">Pustaka grafik gagal dimuat. Periksa koneksi internet.</p>'; return null; }
  if (!drawChart.ready) {
    Chart.defaults.color = '#9aa5d6';
    Chart.defaults.font.family = '"Share Tech Mono", ui-monospace, monospace';
    Chart.defaults.borderColor = 'rgba(42,52,112,.7)';
    Chart.defaults.maintainAspectRatio = false;
    drawChart.ready = true;
  }
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, config);
  return charts[id];
}
function destroyCharts() { Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; }); }

/* ---------- CSV (anti formula injection) ---------- */
function csvCell(v) {
  let s = (v === null || v === undefined) ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(columns, rows) {
  const lines = [columns.map(c => csvCell(c.label)).join(',')];
  rows.forEach(r => lines.push(columns.map(c => csvCell(r[c.key])).join(',')));
  return '\uFEFF' + lines.join('\r\n');
}
function downloadFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime || 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- EFEK VHS ---------- */
function getFx() { return storeGet('fx') || 'full'; }
function setFx(mode) {
  if (['full', 'lite', 'off'].indexOf(mode) === -1) mode = 'full';
  document.body.dataset.fx = mode;
  storeSet('fx', mode);
}
function channelChange() {
  const s = $('#static-burst');
  if (!s || document.body.dataset.fx !== 'full') return;
  s.classList.remove('burst');
  void s.offsetWidth;
  s.classList.add('burst');
}
function startClock() {
  const tick = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    $('#osd-clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const t = state.tapeStart ? Math.floor((Date.now() - state.tapeStart) / 1000) : 0;
    $('#osd-tape').textContent = `${Math.floor(t / 3600)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
  };
  tick();
  clockTimer = setInterval(tick, 1000);
}

/* ---------- AUTENTIKASI (username + password; sesi diterbitkan server) ---------- */
function showLogin(msg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-msg').textContent = msg || '';
  $('#login-pass').value = '';
  pingBackend();
  setTimeout(() => $('#login-user').focus(), 60);
}

// expired = true bila server sudah menyatakan sesi berakhir (tidak perlu memanggil logout lagi).
function endSession(msg, expired) {
  if (state.token && !expired) apiRequest('logout', {}, { silent: true }).catch(() => {});
  state.token = ''; state.me = null; state.izin = [];
  sessSet('tok', null);
  destroyCharts();
  modalStack.slice().forEach(m => m.close());
  showLogin(msg || '');
}

async function startSession(token) {
  state.token = token;
  showLoading('Memuat akun');
  try {
    await loadMeta();
  } catch (e) {
    state.token = ''; sessSet('tok', null);
    hideLoading();
    showLogin(e.message || 'Gagal masuk.');
    return false;
  }
  hideLoading();
  sessSet('tok', token);
  state.tapeStart = Date.now();
  $('#user-name').textContent = state.me.nama;
  $('#user-role').textContent = state.me.role;
  $$('.nav-item[data-need]').forEach(a => { a.hidden = !can(a.dataset.need); });
  $('#login').hidden = true;
  $('#app').hidden = false;
  refreshIcons();
  if (state.me.must_change) { openChangePassword(true); return true; }
  showView(currentHash());
  return true;
}

function bindLogin() {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('#login-user').value.trim(), p = $('#login-pass').value;
    const msg = $('#login-msg');
    if (!u || !p) { msg.textContent = 'Username dan password wajib diisi.'; return; }
    msg.textContent = '';
    const btn = $('#login-btn');
    btn.disabled = true;
    try {
      const r = await apiRequest('login', { username: u, password: p }, { loadingText: 'Memverifikasi akun' });
      $('#login-pass').value = '';
      await startSession(r.data.token);
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// forced = true: dipakai saat login pertama atau setelah reset; menutup dialog tanpa mengganti = keluar.
function openChangePassword(forced) {
  let done = false;
  const f = [
    field({ name: 'password_lama', label: 'Password saat ini', type: 'password', required: true, attrs: 'autocomplete="current-password" maxlength="100"' }),
    field({ name: 'password_baru', label: 'Password baru', type: 'password', required: true, attrs: 'autocomplete="new-password" maxlength="100"', help: 'Minimal 8 karakter, mengandung huruf dan angka.' }),
    field({ name: 'ulang', label: 'Ulangi password baru', type: 'password', required: true, attrs: 'autocomplete="new-password" maxlength="100"' })
  ].join('');
  const m = openModal({
    title: forced ? 'Ganti Password Sementara' : 'Ganti Password',
    body: `${forced ? '<p class="notice">Anda harus mengganti password sementara sebelum melanjutkan.</p>' : ''}<form id="pw-form" novalidate><div class="form-grid" style="grid-template-columns:1fr">${f}</div><div id="form-error"></div></form>`,
    footer: `<button type="button" class="btn btn-ghost" data-close>${forced ? 'Keluar' : 'Batal'}</button><button type="submit" form="pw-form" class="btn btn-primary" id="pw-save">Simpan password</button>`,
    onClose: () => { if (forced && !done && state.token) endSession('Anda harus mengganti password terlebih dahulu.'); }
  });
  const form = $('#pw-form', m.el);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = validateForm(form);
    if (!v.ok) return;
    const box = $('#form-error', m.el);
    if (v.data.password_baru.length < 8) { box.innerHTML = '<div class="notice err" role="alert">Password baru minimal 8 karakter.</div>'; return; }
    if (v.data.password_baru !== v.data.ulang) { box.innerHTML = '<div class="notice err" role="alert">Pengulangan password tidak sama.</div>'; return; }
    const btn = $('#pw-save', m.el);
    btn.disabled = true;
    box.innerHTML = '';
    try {
      const r = await changePassword({ password_lama: v.data.password_lama, password_baru: v.data.password_baru });
      done = true;
      m.close();
      showToast(r.message || 'Password diganti.');
      if (forced) { state.me.must_change = false; showView(currentHash()); }
    } catch (err) {
      box.innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

async function pingBackend() {
  let el = $('#backend-status');
  if (!el) {
    el = document.createElement('p');
    el.id = 'backend-status'; el.className = 'hint';
    $('#login-msg').after(el);
  }
  el.textContent = 'Memeriksa koneksi ke backend…';
  try {
    const r = await fetch(CONFIG.BACKEND_URL, { method: 'GET' });
    const j = await r.json();
    el.textContent = j && j.success ? `Backend terhubung (versi ${j.data && j.data.versi ? j.data.versi : '?'}).` : 'Backend merespons dengan kesalahan.';
  } catch (e) {
    el.textContent = 'Backend tidak dapat dihubungi. Periksa URL deployment dan pastikan akses Web App diatur ke "Anyone".';
  }
}

/* ---------- ROUTER ---------- */
const VIEW_NAMES = ['dashboard', 'barang', 'transaksi', 'peminjaman', 'pemeliharaan', 'kategori', 'lokasi', 'laporan', 'pengguna', 'pengaturan'];
function currentHash() { return (location.hash || '').replace('#', '').split('?')[0]; }
function navAllowed(name) {
  const a = $(`.nav-item[data-view="${name}"]`);
  return !!a && (!a.dataset.need || can(a.dataset.need));
}
function firstAllowedView() { return VIEW_NAMES.filter(navAllowed)[0] || 'pengaturan'; }
function navigate(name) {
  if (currentHash() === name) showView(name); else location.hash = name;
}

async function showView(name) {
  if (!state.me) return;
  if (VIEW_NAMES.indexOf(name) === -1) name = firstAllowedView();
  if (!navAllowed(name)) { showToast('Anda tidak memiliki akses ke menu tersebut.', 'info'); name = firstAllowedView(); }
  if (currentHash() !== name) { history.replaceState(null, '', '#' + name); }
  const seq = ++renderSeq;
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('.nav-item').forEach(a => { a.classList.toggle('active', a.dataset.view === name); if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  closeNav();
  channelChange();
  destroyCharts();
  const body = $('#body-' + name), actions = $('#actions-' + name);
  actions.innerHTML = '';
  document.title = `${$('#t-' + name).textContent} — Inventaris Lab TKJ`;
  window.scrollTo(0, 0);
  const def = views[name];
  if (!def) {
    body.innerHTML = emptyState('MODUL BELUM TERPASANG', 'File modul untuk menu ini belum dimuat. Pastikan file script modul sudah ditambahkan di index.html.');
    return;
  }
  body.innerHTML = '<p class="sub">Memuat…</p>';
  try {
    await def.render(body, { actions: actions, isCurrent: () => seq === renderSeq });
    if (seq === renderSeq) refreshIcons();
  } catch (err) {
    if (seq !== renderSeq) return;
    body.innerHTML = `<div class="notice err" role="alert">${esc(err.message || 'Gagal memuat halaman.')}</div>
      <button type="button" class="btn" data-retry><i data-lucide="repeat"></i> Coba lagi</button>`;
    $('[data-retry]', body).onclick = () => showView(name);
    refreshIcons();
  }
}

function openNav() { $('#sidebar').classList.add('open'); $('#nav-scrim').hidden = false; $('#menu-toggle').setAttribute('aria-expanded', 'true'); }
function closeNav() { $('#sidebar').classList.remove('open'); $('#nav-scrim').hidden = true; $('#menu-toggle').setAttribute('aria-expanded', 'false'); }

/* ---------- API PUBLIK UNTUK MODUL ---------- */
const App = {
  state: state,
  registerView(name, def) { views[name] = def; },
  refresh() { return showView(currentHash()); },
  navigate: navigate,
  takeSearch() { const q = state.pendingSearch; state.pendingSearch = ''; return q; },
  loadMeta: loadMeta,
  openChangePassword: openChangePassword,
  can: can
};

/* ---------- INISIALISASI ---------- */
function bindShell() {
  bindLogin();
  $('#menu-toggle').addEventListener('click', () => ($('#sidebar').classList.contains('open') ? closeNav() : openNav()));
  $('#nav-scrim').addEventListener('click', closeNav);
  $('#btn-logout').addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Keluar', message: 'Anda yakin ingin keluar dari aplikasi?', confirmText: 'Keluar' })) endSession('Anda telah keluar.');
  });
  $('#search-form').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#global-search').value.trim();
    if (!q) return;
    if (!navAllowed('barang')) { showToast('Anda tidak memiliki akses ke data barang.', 'info'); return; }
    state.pendingSearch = q;
    navigate('barang');
  });
  window.addEventListener('hashchange', () => showView(currentHash()));
}

async function init() {
  setFx(getFx());
  bindShell();
  startClock();
  if (CONFIG.BACKEND_URL.indexOf('ISI_') === 0) console.warn('BACKEND_URL belum diatur.');
  await sleep(CONFIG.BOOT_MS);
  $('#boot').classList.add('hide');
  setTimeout(() => { $('#boot').hidden = true; }, 400);
  const saved = sessGet('tok');
  if (saved && await startSession(saved)) return;
  showLogin('');
}
document.addEventListener('DOMContentLoaded', init);
