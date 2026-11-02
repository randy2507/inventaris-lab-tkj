/* =====================================================================
   MODUL BARANG MASUK / KELUAR — modul-transaksi.js (Tahap 3D)
   ===================================================================== */
'use strict';

(function () {
  const S = { rows: [], table: null };
  const TONE = { 'Barang Masuk': 'ok', 'Penambahan Stok': 'ok', 'Barang Keluar': 'warn', 'Pengurangan Stok': 'warn', 'Pemindahan Lokasi': 'info', 'Penghapusan Aset': 'bad' };
  const BATAS_FISIK = ['Barang Keluar', 'Pengurangan Stok', 'Penghapusan Aset', 'Pemindahan Lokasi'];

  function applyFilter() {
    const q = $('#t-q').value.trim().toLowerCase();
    const rows = S.rows.filter(r => !q || [r.nama_barang, r.petugas, r.keterangan].some(v => String(v).toLowerCase().indexOf(q) > -1));
    S.table.setRows(rows);
    $('#t-count').textContent = `${fmtNum(rows.length)} transaksi`;
  }

  async function load() {
    const p = {}, j = $('#t-jenis').value, d1 = $('#t-dari').value, d2 = $('#t-sampai').value;
    if (d1 && d2 && d1 > d2) { showToast('Tanggal awal tidak boleh setelah tanggal akhir.', 'err'); return; }
    if (j) p.jenis_transaksi = j;
    if (d1) p.dari = d1;
    if (d2) p.sampai = d2;
    S.rows = await getTransaksi(p);
    applyFilter();
  }

  async function openForm() {
    const barang = await getBarang({});
    if (!barang.length) { showToast('Belum ada barang. Tambahkan barang di menu Data Barang terlebih dahulu.', 'info'); return; }
    const f = [
      field({ name: 'jenis_transaksi', label: 'Jenis transaksi', type: 'select', required: true, options: state.enums.jenis_transaksi, placeholder: 'Pilih jenis' }),
      field({ name: 'tanggal', label: 'Tanggal transaksi', type: 'date', required: true, value: todayLocal() }),
      field({ name: 'id_barang', label: 'Barang', type: 'select', required: true, options: barangOptions(barang), placeholder: 'Pilih barang', full: true }),
      field({ name: 'jumlah', label: 'Jumlah', type: 'number', required: true, value: 1, attrs: 'min="1" max="1000000" step="1"' }),
      field({ name: 'lokasi_tujuan', label: 'Lokasi tujuan', type: 'select', options: state.lokasi, placeholder: 'Pilih lokasi' }),
      field({ name: 'keterangan', label: 'Keterangan', type: 'textarea', attrs: 'maxlength="500"', full: true })
    ].join('');
    const m = openModal({
      title: 'Catat Transaksi', size: 'lg',
      body: `<form id="trx-form" novalidate><div class="form-grid">${f}</div><p class="sub" id="trx-info" style="margin-top:12px" aria-live="polite"></p><div id="form-error"></div></form>`,
      footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="trx-form" class="btn btn-primary" id="t-save">Simpan</button>'
    });
    const form = $('#trx-form', m.el), el = form.elements;
    const tujuanField = el.lokasi_tujuan.closest('.field');

    const sync = () => {
      const b = barang.find(x => x.id_barang === el.id_barang.value);
      const jenis = el.jenis_transaksi.value;
      const pindah = jenis === 'Pemindahan Lokasi';
      tujuanField.hidden = !pindah;
      el.lokasi_tujuan.required = pindah;
      if (!pindah) el.lokasi_tujuan.value = '';
      let max = 1000000, info = '';
      if (b) {
        const fisik = b.jumlah_total - b.jumlah_dipinjam;
        info = `Lokasi: ${b.lokasi} • Total: ${fmtNum(b.jumlah_total)} ${b.satuan} • Dipinjam: ${fmtNum(b.jumlah_dipinjam)} • Kondisi: ${b.kondisi}`;
        if (BATAS_FISIK.indexOf(jenis) > -1) { max = fisik; info += ` • Maksimal jumlah: ${fmtNum(fisik)}`; }
      }
      el.jumlah.max = String(max);
      $('#trx-info', m.el).textContent = info;
    };
    form.addEventListener('change', sync);
    sync();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = validateForm(form);
      if (!v.ok) return;
      const btn = $('#t-save', m.el);
      btn.disabled = true;
      $('#form-error', m.el).innerHTML = '';
      try {
        const r = await saveTransaksi(v.data);
        m.close();
        showToast(r.message || 'Transaksi dicatat.');
        await load();
      } catch (err) {
        $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
        showToast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }

  App.registerView('transaksi', {
    async render(body, ctx) {
      if (App.can('addTransaksi')) {
        ctx.actions.innerHTML = '<button type="button" class="btn btn-primary"><i data-lucide="repeat"></i> Catat transaksi</button>';
        $('button', ctx.actions).onclick = () => openForm().catch(reportError);
      }
      body.innerHTML = `<div class="toolbar">
          <label class="sr-only" for="t-q">Cari transaksi</label><input id="t-q" class="input" type="search" placeholder="Cari barang, petugas, keterangan…" maxlength="100" style="min-width:230px">
          <select id="t-jenis" class="select" aria-label="Filter jenis transaksi"><option value="">Semua jenis</option>${state.enums.jenis_transaksi.map(j => `<option>${esc(j)}</option>`).join('')}</select>
          <label class="field-label" for="t-dari">Dari</label><input id="t-dari" class="input" type="date">
          <label class="field-label" for="t-sampai">Sampai</label><input id="t-sampai" class="input" type="date">
          <span class="toolbar-spacer"></span><span class="sub" id="t-count" aria-live="polite"></span></div>
        <div id="t-table"></div>`;
      S.table = createTable({
        container: $('#t-table'), rows: [], rowKey: r => r.id_transaksi, sortKey: 'tanggal', sortDir: 'desc', caption: 'Riwayat transaksi barang',
        empty: { title: 'BELUM ADA TRANSAKSI', text: 'Transaksi barang masuk, keluar, dan pemindahan akan tercatat di sini.' },
        columns: [
          { key: '_no', label: 'No', render: (r, i) => i },
          { key: 'tanggal', label: 'Tanggal', render: r => esc(fmtDate(r.tanggal)) },
          { key: 'jenis_transaksi', label: 'Jenis', render: r => badge(r.jenis_transaksi, TONE[r.jenis_transaksi]) },
          { key: 'nama_barang', label: 'Nama barang' },
          { key: 'jumlah', label: 'Jumlah', align: 'right', render: r => fmtNum(r.jumlah) },
          { key: 'lokasi_asal', label: 'Lokasi', render: r => esc([r.lokasi_asal, r.lokasi_tujuan].filter(Boolean).join(' → ') || '-') },
          { key: 'petugas', label: 'Petugas' },
          { key: 'keterangan', label: 'Keterangan' }
        ]
      });
      const deb = debounce(applyFilter, 200);
      $('#t-q').addEventListener('input', deb);
      ['#t-jenis', '#t-dari', '#t-sampai'].forEach(s => $(s).addEventListener('change', () => load().catch(reportError)));
      await load();
    }
  });
})();
