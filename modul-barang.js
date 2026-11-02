/* =====================================================================
   MODUL DATA BARANG — modul-barang.js (Tahap 3C)
   CRUD barang, pencarian, filter, pengurutan, paginasi, detail + riwayat.
   ===================================================================== */
'use strict';

(function () {
  const S = { all: [], table: null, tableOpt: null, body: null };

  function uniqueSorted(list) {
    return Array.from(new Set(list.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));
  }
  function opts(list, placeholder) {
    return `<option value="">${esc(placeholder)}</option>` + list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  }
  function withCurrent(list, current) {
    return current && list.indexOf(current) === -1 ? list.concat([current]) : list;
  }

  /* ---------- Filter ---------- */
  function filtersActive() {
    return !!($('#b-q').value.trim() || $('#b-kat').value || $('#b-kon').value || $('#b-lok').value);
  }
  function applyFilters(keepPage) {
    const q = $('#b-q').value.trim().toLowerCase();
    const kat = $('#b-kat').value, kon = $('#b-kon').value, lok = $('#b-lok').value;
    const rows = S.all.filter(b =>
      (!q || String(b.nama_barang).toLowerCase().indexOf(q) > -1 || String(b.kode_barang).toLowerCase().indexOf(q) > -1) &&
      (!kat || b.kategori === kat) && (!kon || b.kondisi === kon) && (!lok || b.lokasi === lok));
    S.tableOpt.empty = filtersActive()
      ? { title: 'TIDAK DITEMUKAN', text: 'Tidak ada barang yang cocok dengan pencarian atau filter. Coba ubah kata kunci.', actionHtml: '<button type="button" class="btn btn-sm" data-reset>Atur ulang filter</button>' }
      : { title: 'BELUM ADA BARANG', text: 'Data inventaris masih kosong.', actionHtml: App.can('addBarang') ? '<button type="button" class="btn btn-primary" data-add>Tambah barang pertama</button>' : '' };
    S.table.setRows(rows, keepPage);
    $('#b-count').textContent = `${fmtNum(rows.length)} dari ${fmtNum(S.all.length)} jenis barang`;
  }
  async function reloadList() {
    S.all = await getBarang({});
    applyFilters(true);
  }

  /* ---------- Formulir tambah / ubah ---------- */
  function openForm(row) {
    const edit = !!row, b = row || {};
    const kategori = withCurrent(state.kategori, b.kategori), lokasi = withCurrent(state.lokasi, b.lokasi);
    const f = [
      field({ name: 'kode_barang', label: 'Kode inventaris', value: b.kode_barang, attrs: 'maxlength="50"', help: edit ? '' : 'Kosongkan agar dibuat otomatis.' }),
      field({ name: 'nama_barang', label: 'Nama barang', required: true, value: b.nama_barang, attrs: 'maxlength="150"' }),
      field({ name: 'kategori', label: 'Kategori', type: 'select', required: true, options: kategori, placeholder: 'Pilih kategori', value: b.kategori }),
      field({ name: 'merek', label: 'Merek', value: b.merek, attrs: 'maxlength="100"' }),
      field({ name: 'model', label: 'Model atau tipe', value: b.model, attrs: 'maxlength="100"' }),
      field({ name: 'nomor_seri', label: 'Nomor seri', value: b.nomor_seri, attrs: 'maxlength="100"' }),
      field({ name: 'jumlah_total', label: 'Jumlah unit', type: 'number', required: true, value: edit ? b.jumlah_total : 1,
        attrs: `min="${edit ? (b.jumlah_dipinjam || 0) : 1}" max="1000000" step="1"`, help: edit && b.jumlah_dipinjam ? `Sedang dipinjam: ${b.jumlah_dipinjam} unit.` : '' }),
      field({ name: 'satuan', label: 'Satuan', required: true, value: b.satuan || 'unit', attrs: 'maxlength="30"' }),
      field({ name: 'kondisi', label: 'Kondisi', type: 'select', required: true, options: state.enums.kondisi, value: b.kondisi || 'Baik' }),
      field({ name: 'lokasi', label: 'Lokasi penyimpanan', type: 'select', required: true, options: lokasi, placeholder: 'Pilih lokasi', value: b.lokasi }),
      field({ name: 'tanggal_pengadaan', label: 'Tanggal pengadaan', type: 'date', value: b.tanggal_pengadaan }),
      field({ name: 'sumber_pengadaan', label: 'Sumber pengadaan', value: b.sumber_pengadaan, attrs: 'maxlength="150"' }),
      field({ name: 'harga_satuan', label: 'Harga satuan (Rp)', type: 'number', value: b.harga_satuan || 0, attrs: 'min="0" step="0.01"' }),
      field({ name: 'penanggung_jawab', label: 'Penanggung jawab', value: b.penanggung_jawab, attrs: 'maxlength="100"' }),
      field({ name: 'foto_url', label: 'URL foto (opsional)', type: 'url', value: b.foto_url, attrs: 'maxlength="500"', full: true }),
      field({ name: 'keterangan', label: 'Keterangan', type: 'textarea', value: b.keterangan, attrs: 'maxlength="1000"', full: true })
    ].join('');
    const m = openModal({
      title: edit ? 'Ubah Barang' : 'Tambah Barang', size: 'lg',
      body: `<form id="barang-form" novalidate><div class="form-grid">${f}</div><p class="sub" id="total-nilai" style="margin-top:12px"></p><div id="form-error"></div></form>`,
      footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="barang-form" class="btn btn-primary" id="b-save">Simpan</button>'
    });
    const form = $('#barang-form', m.el);
    const hitung = () => {
      const j = Number(form.elements.jumlah_total.value) || 0, h = Number(form.elements.harga_satuan.value) || 0;
      $('#total-nilai', m.el).textContent = `Total nilai: ${fmtRupiah(j * h)}`;
    };
    form.addEventListener('input', hitung);
    hitung();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = validateForm(form);
      if (!v.ok) return;
      const data = v.data;
      if (edit) { data.id_barang = b.id_barang; data.updated_at = b.updated_at; }
      const btn = $('#b-save', m.el);
      btn.disabled = true;
      $('#form-error', m.el).innerHTML = '';
      try {
        const r = await saveBarang(data);
        m.close();
        showToast(r.message || 'Barang berhasil disimpan.');
        await reloadList();
      } catch (err) {
        $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}${err.code === 'CONFLICT' ? ' Tutup formulir lalu buka kembali.' : ''}</div>`;
        showToast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }

  /* ---------- Detail ---------- */
  function kv(k, v) { return `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${v === '' || v === null || v === undefined ? '-' : v}</div></div>`; }
  function miniTable(cols, rows, kosong) {
    if (!rows.length) return `<p class="sub">${esc(kosong)}</p>`;
    return `<div class="table-wrap"><table class="table" style="min-width:560px"><thead><tr>${cols.map(c => `<th scope="col">${esc(c[0])}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  async function openDetail(id) {
    const d = await getBarangById(id);
    const b = d.barang;
    const foto = /^https?:\/\//i.test(b.foto_url || '') ? `<img src="${esc(b.foto_url)}" alt="Foto ${esc(b.nama_barang)}" loading="lazy" referrerpolicy="no-referrer" style="max-width:220px;max-height:180px;border:1px solid var(--line);margin-bottom:14px">` : '';
    const info = `${foto}<div class="kv-grid">
      ${kv('Kode inventaris', `<span class="code">${esc(b.kode_barang)}</span>`)}${kv('Nama barang', esc(b.nama_barang))}${kv('Kategori', esc(b.kategori))}
      ${kv('Merek', esc(b.merek))}${kv('Model/tipe', esc(b.model))}${kv('Nomor seri', esc(b.nomor_seri))}
      ${kv('Jumlah total', `${fmtNum(b.jumlah_total)} ${esc(b.satuan)}`)}${kv('Sedang dipinjam', fmtNum(b.jumlah_dipinjam))}${kv('Tersedia', fmtNum(b.tersedia))}
      ${kv('Kondisi', badgeKondisi(b.kondisi))}${kv('Lokasi', esc(b.lokasi))}${kv('Tanggal pengadaan', fmtDate(b.tanggal_pengadaan))}
      ${kv('Sumber pengadaan', esc(b.sumber_pengadaan))}${kv('Harga satuan', fmtRupiah(b.harga_satuan))}${kv('Total nilai', fmtRupiah(b.total_nilai))}
      ${kv('Penanggung jawab', esc(b.penanggung_jawab))}${kv('Dibuat', fmtDateTime(b.created_at))}${kv('Terakhir diperbarui', fmtDateTime(b.updated_at))}
      ${kv('Keterangan', esc(b.keterangan))}</div>`;

    let riwayat = '';
    if (d.riwayat_transaksi) {
      const panel = [
        miniTable([['Tanggal', r => esc(fmtDate(r.tanggal))], ['Jenis', r => esc(r.jenis_transaksi)], ['Jumlah', r => fmtNum(r.jumlah)],
          ['Lokasi', r => esc([r.lokasi_asal, r.lokasi_tujuan].filter(Boolean).join(' → ') || '-')], ['Petugas', r => esc(r.petugas)], ['Keterangan', r => esc(r.keterangan)]],
          d.riwayat_transaksi, 'Belum ada riwayat transaksi.'),
        miniTable([['Tgl pinjam', r => esc(fmtDate(r.tanggal_pinjam))], ['Peminjam', r => esc(r.nama_peminjam)], ['Jumlah', r => fmtNum(r.jumlah_pinjam)],
          ['Rencana kembali', r => esc(fmtDate(r.rencana_kembali))], ['Status', r => badgeStatus(r.status_efektif)], ['Terlambat', r => r.hari_terlambat ? `${r.hari_terlambat} hari` : '-']],
          d.riwayat_peminjaman, 'Belum ada riwayat peminjaman.'),
        miniTable([['Tgl laporan', r => esc(fmtDate(r.tanggal_laporan))], ['Kerusakan', r => esc(r.deskripsi_kerusakan)], ['Unit', r => fmtNum(r.jumlah_unit)],
          ['Status', r => badgeStatus(r.status)], ['Biaya', r => fmtRupiah(r.biaya)]],
          d.riwayat_pemeliharaan, 'Belum ada riwayat pemeliharaan.')
      ];
      riwayat = `<h3 class="vt" style="font-size:24px;margin:18px 0 8px">Riwayat</h3>
        <div class="tabs" role="tablist">${['Transaksi', 'Peminjaman', 'Pemeliharaan'].map((t, i) => `<button type="button" role="tab" class="tab${i ? '' : ' active'}" data-tab="${i}" aria-selected="${i ? 'false' : 'true'}">${t}</button>`).join('')}</div>
        ${panel.map((p, i) => `<div data-panel="${i}" role="tabpanel"${i ? ' hidden' : ''}>${p}</div>`).join('')}`;
    }
    const footer = '<button type="button" class="btn btn-ghost" data-close>Tutup</button>' + (App.can('updateBarang') ? '<button type="button" class="btn btn-primary" data-edit>Ubah data</button>' : '');
    const m = openModal({ title: `Detail: ${b.nama_barang}`, size: 'lg', body: info + riwayat, footer: footer });
    m.body.addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      $$('[data-tab]', m.body).forEach(x => { const on = x === t; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
      $$('[data-panel]', m.body).forEach(p => { p.hidden = p.dataset.panel !== t.dataset.tab; });
    });
    const ed = $('[data-edit]', m.footer);
    if (ed) ed.onclick = () => { m.close(); openForm(S.all.find(x => x.id_barang === id) || b); };
  }

  /* ---------- Hapus ---------- */
  async function hapus(row) {
    const ok = await confirmDialog({
      title: 'Hapus barang', danger: true, confirmText: 'Hapus',
      message: `Hapus "${row.nama_barang}" (${row.kode_barang}) dari inventaris? Riwayat transaksi tetap tersimpan. Barang yang masih dipinjam atau dalam perbaikan tidak dapat dihapus.`
    });
    if (!ok) return;
    try {
      const r = await deleteBarang(row.id_barang);
      showToast(r.message || 'Barang dihapus.');
      await reloadList();
    } catch (err) { reportError(err); }
  }

  /* ---------- Tampilan ---------- */
  App.registerView('barang', {
    async render(body, ctx) {
      S.body = body;
      if (App.can('addBarang')) {
        ctx.actions.innerHTML = '<button type="button" class="btn btn-primary" data-add><i data-lucide="package"></i> Tambah barang</button>';
        $('[data-add]', ctx.actions).onclick = () => openForm(null);
      }
      S.all = await getBarang({});
      if (!ctx.isCurrent()) return;
      const kategori = uniqueSorted(state.kategori.concat(S.all.map(b => b.kategori)));
      const lokasi = uniqueSorted(state.lokasi.concat(S.all.map(b => b.lokasi)));
      body.innerHTML = `<div class="toolbar" role="search">
          <label class="sr-only" for="b-q">Cari barang</label><input id="b-q" class="input" type="search" placeholder="Cari nama atau kode barang…" maxlength="100" style="min-width:240px">
          <select id="b-kat" class="select" aria-label="Filter kategori">${opts(kategori, 'Semua kategori')}</select>
          <select id="b-kon" class="select" aria-label="Filter kondisi">${opts(state.enums.kondisi, 'Semua kondisi')}</select>
          <select id="b-lok" class="select" aria-label="Filter lokasi">${opts(lokasi, 'Semua lokasi')}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-reset>Atur ulang</button>
          <span class="toolbar-spacer"></span><span class="sub" id="b-count" aria-live="polite"></span></div>
        <div id="b-table"></div>`;

      const can = App.can;
      S.tableOpt = {
        container: $('#b-table'), rows: [], rowKey: r => r.id_barang, sortKey: 'nama_barang', caption: 'Daftar barang inventaris',
        columns: [
          { key: '_no', label: 'No', render: (r, i) => i },
          { key: 'kode_barang', label: 'Kode', cls: 'code', render: r => esc(r.kode_barang) },
          { key: 'nama_barang', label: 'Nama barang', render: r => `<strong>${esc(r.nama_barang)}</strong>${r.merek || r.model ? `<br><span class="sub">${esc([r.merek, r.model].filter(Boolean).join(' '))}</span>` : ''}` },
          { key: 'kategori', label: 'Kategori', render: r => esc(r.kategori) },
          { key: 'jumlah_total', label: 'Jumlah', align: 'right', render: r => `${fmtNum(r.jumlah_total)} ${esc(r.satuan)}${r.jumlah_dipinjam ? `<br><span class="sub">${fmtNum(r.jumlah_dipinjam)} dipinjam</span>` : ''}` },
          { key: 'kondisi', label: 'Kondisi', render: r => badgeKondisi(r.kondisi) },
          { key: 'lokasi', label: 'Lokasi', render: r => esc(r.lokasi) },
          { key: '_aksi', label: 'Aksi', render: r => `<div class="td-actions">${actionBtn('detail', r.id_barang, 'eye', 'Lihat detail')}${can('updateBarang') ? actionBtn('edit', r.id_barang, 'pencil', 'Ubah') : ''}${can('deleteBarang') ? actionBtn('hapus', r.id_barang, 'trash-2', 'Hapus', 'btn-danger') : ''}</div>` }
        ],
        onAction: (act, key, row) => {
          if (act === 'detail') openDetail(key).catch(reportError);
          else if (act === 'edit') openForm(row);
          else if (act === 'hapus') hapus(row);
        }
      };
      S.table = createTable(S.tableOpt);

      const pending = App.takeSearch();
      if (pending) $('#b-q').value = pending;
      const deb = debounce(() => applyFilters(false), 200);
      $('#b-q').addEventListener('input', deb);
      ['#b-kat', '#b-kon', '#b-lok'].forEach(s => $(s).addEventListener('change', () => applyFilters(false)));
      body.onclick = e => {
        if (e.target.closest('[data-reset]')) {
          $('#b-q').value = ''; ['#b-kat', '#b-kon', '#b-lok'].forEach(s => { $(s).value = ''; });
          applyFilters(false);
        } else if (e.target.closest('#b-table [data-add]')) openForm(null);
      };
      applyFilters(false);
    }
  });
})();
