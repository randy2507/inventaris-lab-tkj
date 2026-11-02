/* =====================================================================
   MODUL PEMINJAMAN — modul-peminjaman.js (Tahap 3D)
   ===================================================================== */
'use strict';

(function () {
  const S = { daftar: [], ringkasan: {}, tab: 'aktif', table: null, body: null };
  const TABS = [['aktif', 'Aktif'], ['terlambat', 'Terlambat'], ['riwayat', 'Riwayat'], ['semua', 'Semua']];

  function statusCell(r) {
    let sub = '';
    if (r.hari_terlambat) sub = `<br><span class="sub">${r.status === 'Dipinjam' ? 'lewat' : 'terlambat'} ${r.hari_terlambat} hari</span>`;
    return badgeStatus(r.status_efektif) + sub;
  }

  function filtered() {
    const q = ($('#p-q') ? $('#p-q').value : '').trim().toLowerCase();
    return S.daftar.filter(r => {
      const tabOk = S.tab === 'semua' || (S.tab === 'aktif' && r.status === 'Dipinjam') ||
        (S.tab === 'terlambat' && r.status_efektif === 'Terlambat') || (S.tab === 'riwayat' && r.status !== 'Dipinjam');
      return tabOk && (!q || [r.nama_peminjam, r.nama_barang, r.identitas_peminjam, r.kelas_bagian].some(v => String(v).toLowerCase().indexOf(q) > -1));
    });
  }
  function refreshTable() {
    S.table.setRows(filtered());
    $$('.tab', S.body).forEach(t => {
      const on = t.dataset.tab === S.tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  async function loadAll() {
    const d = await getPeminjaman({ filter: 'semua' });
    S.daftar = d.daftar;
    S.ringkasan = d.ringkasan;
    $('#p-stats').innerHTML = [
      ['Sedang dipinjam', S.ringkasan.aktif, 'info'], ['Terlambat', S.ringkasan.terlambat, S.ringkasan.terlambat ? 'bad' : 'ok'], ['Riwayat selesai', S.ringkasan.riwayat, 'ok']
    ].map(i => `<div class="stat-card tone-${i[2]}"><span class="stat-label">${i[0]}</span><span class="stat-value">${fmtNum(i[1])}</span></div>`).join('');
    refreshTable();
  }

  async function openPinjam() {
    const semua = await getBarang({});
    const barang = semua.filter(b => b.tersedia > 0);
    if (!barang.length) { showToast('Tidak ada barang yang tersedia untuk dipinjam.', 'info'); return; }
    const hari = todayLocal();
    const f = [
      field({ name: 'id_barang', label: 'Barang', type: 'select', required: true, options: barangOptions(barang), placeholder: 'Pilih barang', full: true }),
      field({ name: 'nama_peminjam', label: 'Nama peminjam', required: true, attrs: 'maxlength="100"' }),
      field({ name: 'identitas_peminjam', label: 'NIS/NIP atau identitas', attrs: 'maxlength="50"' }),
      field({ name: 'kelas_bagian', label: 'Kelas atau bagian', attrs: 'maxlength="50"' }),
      field({ name: 'jumlah_pinjam', label: 'Jumlah dipinjam', type: 'number', required: true, value: 1, attrs: 'min="1" step="1"' }),
      field({ name: 'tanggal_pinjam', label: 'Tanggal pinjam', type: 'date', required: true, value: hari }),
      field({ name: 'rencana_kembali', label: 'Rencana tanggal kembali', type: 'date', required: true, value: addDaysLocal(hari, 7) }),
      field({ name: 'kondisi_pinjam', label: 'Kondisi saat dipinjam', type: 'select', options: state.enums.kondisi, value: 'Baik' }),
      field({ name: 'keterangan', label: 'Catatan', type: 'textarea', attrs: 'maxlength="500"', full: true })
    ].join('');
    const m = openModal({
      title: 'Peminjaman Barang', size: 'lg',
      body: `<form id="pjm-form" novalidate><div class="form-grid">${f}</div><p class="sub" id="pjm-info" style="margin-top:12px" aria-live="polite"></p><div id="form-error"></div></form>`,
      footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="pjm-form" class="btn btn-primary" id="p-save">Simpan peminjaman</button>'
    });
    const form = $('#pjm-form', m.el), el = form.elements;
    el.id_barang.addEventListener('change', () => {
      const b = barang.find(x => x.id_barang === el.id_barang.value);
      el.jumlah_pinjam.max = b ? String(b.tersedia) : '';
      if (b) { el.kondisi_pinjam.value = b.kondisi; }
      $('#pjm-info', m.el).textContent = b ? `Lokasi: ${b.lokasi} • Tersedia: ${fmtNum(b.tersedia)} ${b.satuan} dari ${fmtNum(b.jumlah_total)}` : '';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = validateForm(form);
      if (!v.ok) return;
      const errBox = $('#form-error', m.el);
      if (v.data.rencana_kembali < v.data.tanggal_pinjam) {
        errBox.innerHTML = '<div class="notice err" role="alert">Rencana tanggal kembali tidak boleh sebelum tanggal pinjam.</div>';
        return;
      }
      const btn = $('#p-save', m.el);
      btn.disabled = true; errBox.innerHTML = '';
      try {
        const r = await savePeminjaman(v.data);
        m.close();
        showToast(r.message || 'Peminjaman dicatat.');
        await loadAll();
      } catch (err) {
        errBox.innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
        showToast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }

  function openReturn(r) {
    const f = [
      field({ name: 'kondisi_kembali', label: 'Kondisi saat dikembalikan', type: 'select', required: true, options: state.enums.kondisi_kembali, value: 'Baik' }),
      field({ name: 'tanggal_kembali', label: 'Tanggal pengembalian', type: 'date', required: true, value: todayLocal() }),
      field({ name: 'catatan', label: 'Catatan pengembalian', type: 'textarea', attrs: 'maxlength="300"', full: true })
    ].join('');
    const m = openModal({
      title: 'Pengembalian Barang',
      body: `<p><strong>${esc(r.nama_barang)}</strong> — ${fmtNum(r.jumlah_pinjam)} unit, dipinjam oleh ${esc(r.nama_peminjam)}${r.kelas_bagian ? ` (${esc(r.kelas_bagian)})` : ''}.<br>
        <span class="sub">Rencana kembali: ${esc(fmtDate(r.rencana_kembali))}${r.hari_terlambat ? ` • terlambat ${r.hari_terlambat} hari` : ''}</span></p>
        <form id="ret-form" novalidate style="margin-top:14px"><div class="form-grid">${f}</div>
        <p class="sub" id="ret-info" style="margin-top:10px" aria-live="polite"></p><div id="form-error"></div></form>`,
      footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="ret-form" class="btn btn-primary" id="r-save">Proses pengembalian</button>'
    });
    const form = $('#ret-form', m.el);
    form.elements.kondisi_kembali.addEventListener('change', e => {
      $('#ret-info', m.el).textContent = e.target.value === 'Baik' ? ''
        : 'Kondisi barang di inventaris akan diperbarui. Jika hanya sebagian unit yang rusak, unit tersebut dipisah menjadi kode baru.';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = validateForm(form);
      if (!v.ok) return;
      const btn = $('#r-save', m.el);
      btn.disabled = true;
      try {
        const res = await processReturn(Object.assign({ id_peminjaman: r.id_peminjaman }, v.data));
        m.close();
        showToast(res.message || 'Pengembalian dicatat.');
        await loadAll();
      } catch (err) {
        $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
        showToast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }

  async function batalkan(r) {
    const ok = await confirmDialog({
      title: 'Batalkan peminjaman', danger: true, confirmText: 'Batalkan peminjaman',
      message: `Batalkan peminjaman ${r.nama_barang} oleh ${r.nama_peminjam}? Stok akan dikembalikan sebagai tersedia.`
    });
    if (!ok) return;
    try {
      const res = await cancelPeminjaman({ id_peminjaman: r.id_peminjaman });
      showToast(res.message || 'Peminjaman dibatalkan.');
      await loadAll();
    } catch (err) { reportError(err); }
  }

  App.registerView('peminjaman', {
    async render(body, ctx) {
      S.body = body;
      if (App.can('addPeminjaman')) {
        ctx.actions.innerHTML = '<button type="button" class="btn btn-primary"><i data-lucide="hand-helping"></i> Peminjaman baru</button>';
        $('button', ctx.actions).onclick = () => openPinjam().catch(reportError);
      }
      body.innerHTML = `<div class="stat-grid" id="p-stats"></div>
        <div class="tabs" role="tablist">${TABS.map(t => `<button type="button" role="tab" class="tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
        <div class="toolbar"><label class="sr-only" for="p-q">Cari peminjaman</label>
          <input id="p-q" class="input" type="search" placeholder="Cari peminjam, barang, kelas…" maxlength="100" style="min-width:240px"></div>
        <div id="p-table"></div>`;
      S.table = createTable({
        container: $('#p-table'), rows: [], rowKey: r => r.id_peminjaman, sortKey: 'tanggal_pinjam', sortDir: 'desc', caption: 'Daftar peminjaman barang',
        empty: { title: 'TIDAK ADA PEMINJAMAN', text: 'Belum ada data pada tab ini.' },
        columns: [
          { key: '_no', label: 'No', render: (r, i) => i },
          { key: 'tanggal_pinjam', label: 'Tgl pinjam', render: r => esc(fmtDate(r.tanggal_pinjam)) },
          { key: 'nama_barang', label: 'Barang' },
          { key: 'nama_peminjam', label: 'Peminjam', render: r => `<strong>${esc(r.nama_peminjam)}</strong><br><span class="sub">${esc([r.identitas_peminjam, r.kelas_bagian].filter(Boolean).join(' • ') || '-')}</span>` },
          { key: 'jumlah_pinjam', label: 'Jumlah', align: 'right', render: r => fmtNum(r.jumlah_pinjam) },
          { key: 'rencana_kembali', label: 'Rencana kembali', render: r => esc(fmtDate(r.rencana_kembali)) },
          { key: 'tanggal_kembali', label: 'Tgl kembali', render: r => esc(fmtDate(r.tanggal_kembali)) },
          { key: 'status_efektif', label: 'Status', render: statusCell },
          { key: '_aksi', label: 'Aksi', render: r => r.status === 'Dipinjam' && App.can('returnBarang')
            ? `<div class="td-actions">${actionBtn('kembali', r.id_peminjaman, 'repeat', 'Proses pengembalian')}${actionBtn('batal', r.id_peminjaman, 'x', 'Batalkan peminjaman', 'btn-danger')}</div>` : '' }
        ],
        onAction: (act, key, row) => { if (act === 'kembali') openReturn(row); else if (act === 'batal') batalkan(row); }
      });
      body.onclick = e => {
        const t = e.target.closest('.tab');
        if (t) { S.tab = t.dataset.tab; refreshTable(); }
      };
      $('#p-q').addEventListener('input', debounce(refreshTable, 200));
      await loadAll();
      if (!ctx.isCurrent()) return;
      if (S.ringkasan.terlambat > 0 && S.tab === 'aktif') { S.tab = 'terlambat'; refreshTable(); }
    }
  });
})();
