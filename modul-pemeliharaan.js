/* =====================================================================
   MODUL PEMELIHARAAN & PERBAIKAN — modul-pemeliharaan.js (Tahap 3D)
   ===================================================================== */
'use strict';

(function () {
  const S = { daftar: [], table: null };
  const STATUS_AWAL = ['Dilaporkan', 'Menunggu Perbaikan', 'Sedang Diperbaiki'];
  const STATUS_AKHIR = ['Selesai', 'Tidak Dapat Diperbaiki'];

  function ringkasanHtml(r, daftar) {
    const sedang = daftar.filter(x => x.status === 'Sedang Diperbaiki');
    const kartu = [
      ['Laporan belum selesai', r.aktif, r.aktif ? 'warn' : 'ok'],
      ['Sedang diperbaiki', r.sedang_diperbaiki, 'info'],
      ['Total biaya perbaikan', fmtRupiah(r.total_biaya), 'info']
    ].map(i => `<div class="stat-card tone-${i[2]}"><span class="stat-label">${i[0]}</span><span class="stat-value" style="font-size:${typeof i[1] === 'string' ? 30 : 46}px">${typeof i[1] === 'string' ? esc(i[1]) : fmtNum(i[1])}</span></div>`).join('');
    const list = sedang.length
      ? `<section class="card" style="margin-bottom:20px"><h2>Barang sedang diperbaiki</h2><ul class="activity-list">${sedang.map(x =>
        `<li><time>${esc(fmtDate(x.tanggal_laporan))}</time><span><strong>${esc(x.nama_barang)}</strong> (${fmtNum(x.jumlah_unit)} unit) — ${esc(x.deskripsi_kerusakan)}${x.teknisi ? ` <span class="sub">Teknisi: ${esc(x.teknisi)}</span>` : ''}</span></li>`).join('')}</ul></section>` : '';
    return `<div class="stat-grid">${kartu}</div>${list}`;
  }

  function applyFilter() {
    const st = $('#m-status').value, q = $('#m-q').value.trim().toLowerCase();
    const rows = S.daftar.filter(r => (!st || r.status === st) &&
      (!q || [r.nama_barang, r.deskripsi_kerusakan, r.pelapor, r.teknisi].some(v => String(v).toLowerCase().indexOf(q) > -1)));
    S.table.setRows(rows);
  }

  async function loadAll() {
    const d = await getPemeliharaan({});
    S.daftar = d.daftar;
    $('#m-summary').innerHTML = ringkasanHtml(d.ringkasan, d.daftar);
    applyFilter();
  }

  async function openLapor() {
    const barang = await getBarang({});
    if (!barang.length) { showToast('Belum ada barang yang bisa dilaporkan.', 'info'); return; }
    const f = [
      field({ name: 'id_barang', label: 'Barang', type: 'select', required: true, options: barangOptions(barang), placeholder: 'Pilih barang', full: true }),
      field({ name: 'jumlah_unit', label: 'Jumlah unit bermasalah', type: 'number', required: true, value: 1, attrs: 'min="1" step="1"' }),
      field({ name: 'tanggal_laporan', label: 'Tanggal laporan', type: 'date', required: true, value: todayLocal() }),
      field({ name: 'deskripsi_kerusakan', label: 'Deskripsi kerusakan', type: 'textarea', required: true, attrs: 'maxlength="1000"', full: true }),
      field({ name: 'pelapor', label: 'Nama pelapor', value: state.me.nama, attrs: 'maxlength="100"' }),
      field({ name: 'status', label: 'Status awal', type: 'select', options: STATUS_AWAL, value: 'Dilaporkan' }),
      field({ name: 'teknisi', label: 'Teknisi atau petugas', attrs: 'maxlength="100"' }),
      field({ name: 'biaya', label: 'Biaya perbaikan (Rp)', type: 'number', value: 0, attrs: 'min="0" step="0.01"' }),
      field({ name: 'tindakan_perbaikan', label: 'Tindakan perbaikan', type: 'textarea', attrs: 'maxlength="1000"', full: true }),
      field({ name: 'catatan', label: 'Catatan tambahan', type: 'textarea', attrs: 'maxlength="1000"', full: true })
    ].join('');
    const m = openModal({
      title: 'Laporan Kerusakan', size: 'lg',
      body: `<form id="mnt-form" novalidate><div class="form-grid">${f}</div><p class="sub" id="mnt-info" style="margin-top:12px" aria-live="polite"></p><div id="form-error"></div></form>`,
      footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="mnt-form" class="btn btn-primary" id="m-save">Simpan laporan</button>'
    });
    const form = $('#mnt-form', m.el), el = form.elements;
    el.id_barang.addEventListener('change', () => {
      const b = barang.find(x => x.id_barang === el.id_barang.value);
      el.jumlah_unit.max = b ? String(b.jumlah_total) : '';
      $('#mnt-info', m.el).textContent = b ? `Jumlah barang: ${fmtNum(b.jumlah_total)} ${b.satuan} • Kondisi: ${b.kondisi} • Lokasi: ${b.lokasi}` : '';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = validateForm(form);
      if (!v.ok) return;
      const btn = $('#m-save', m.el);
      btn.disabled = true;
      try {
        const r = await savePemeliharaan(v.data);
        m.close();
        showToast(r.message || 'Laporan dicatat.');
        await loadAll();
      } catch (err) {
        $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
        showToast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }

  function openUpdate(r) {
    const f = [
      field({ name: 'status', label: 'Status perbaikan', type: 'select', required: true, options: state.enums.status_pemeliharaan, value: r.status }),
      field({ name: 'tanggal_selesai', label: 'Tanggal selesai', type: 'date', value: r.tanggal_selesai || todayLocal() }),
      field({ name: 'teknisi', label: 'Teknisi atau petugas', value: r.teknisi, attrs: 'maxlength="100"' }),
      field({ name: 'biaya', label: 'Biaya perbaikan (Rp)', type: 'number', value: r.biaya || 0, attrs: 'min="0" step="0.01"' }),
      field({ name: 'tindakan_perbaikan', label: 'Tindakan perbaikan', type: 'textarea', value: r.tindakan_perbaikan, attrs: 'maxlength="1000"', full: true }),
      field({ name: 'catatan', label: 'Catatan tambahan', type: 'textarea', value: r.catatan, attrs: 'maxlength="1000"', full: true })
    ].join('');
    const m = openModal({
      title: 'Perbarui Pemeliharaan', size: 'lg',
      body: `<p><strong>${esc(r.nama_barang)}</strong> (${fmtNum(r.jumlah_unit)} unit) — ${esc(r.deskripsi_kerusakan)}<br><span class="sub">Dilaporkan ${esc(fmtDate(r.tanggal_laporan))} oleh ${esc(r.pelapor || '-')}</span></p>
        <form id="upd-form" novalidate style="margin-top:14px"><div class="form-grid">${f}</div>
        <p class="sub" style="margin-top:12px">Efek status pada kondisi barang: Sedang Diperbaiki → Dalam Perbaikan, Selesai → Baik, Tidak Dapat Diperbaiki → Rusak Berat. Laporan yang sudah Selesai atau Tidak Dapat Diperbaiki tidak dapat diubah lagi.</p>
        <div id="form-error"></div></form>`,
      footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="upd-form" class="btn btn-primary" id="u-save">Simpan perubahan</button>'
    });
    const form = $('#upd-form', m.el), el = form.elements;
    const tglField = el.tanggal_selesai.closest('.field');
    const sync = () => { tglField.hidden = STATUS_AKHIR.indexOf(el.status.value) === -1; };
    el.status.addEventListener('change', sync);
    sync();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = validateForm(form);
      if (!v.ok) return;
      const data = Object.assign({ id_pemeliharaan: r.id_pemeliharaan }, v.data);
      if (STATUS_AKHIR.indexOf(data.status) === -1) data.tanggal_selesai = '';
      const btn = $('#u-save', m.el);
      btn.disabled = true;
      try {
        const res = await savePemeliharaan(data);
        m.close();
        showToast(res.message || 'Data diperbarui.');
        await loadAll();
      } catch (err) {
        $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
        showToast(err.message, 'err');
        btn.disabled = false;
      }
    });
  }

  App.registerView('pemeliharaan', {
    async render(body, ctx) {
      if (App.can('addPemeliharaan')) {
        ctx.actions.innerHTML = '<button type="button" class="btn btn-primary"><i data-lucide="wrench"></i> Laporkan kerusakan</button>';
        $('button', ctx.actions).onclick = () => openLapor().catch(reportError);
      }
      body.innerHTML = `<div id="m-summary"></div>
        <div class="toolbar"><label class="sr-only" for="m-q">Cari laporan</label>
          <input id="m-q" class="input" type="search" placeholder="Cari barang, kerusakan, pelapor…" maxlength="100" style="min-width:240px">
          <select id="m-status" class="select" aria-label="Filter status"><option value="">Semua status</option>${state.enums.status_pemeliharaan.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div id="m-table"></div>`;
      S.table = createTable({
        container: $('#m-table'), rows: [], rowKey: r => r.id_pemeliharaan, sortKey: 'tanggal_laporan', sortDir: 'desc', caption: 'Riwayat pemeliharaan dan perbaikan',
        empty: { title: 'BELUM ADA LAPORAN', text: 'Laporan kerusakan dan riwayat perbaikan akan tampil di sini.' },
        columns: [
          { key: '_no', label: 'No', render: (r, i) => i },
          { key: 'tanggal_laporan', label: 'Tgl laporan', render: r => esc(fmtDate(r.tanggal_laporan)) },
          { key: 'nama_barang', label: 'Barang', render: r => `<strong>${esc(r.nama_barang)}</strong><br><span class="sub">${fmtNum(r.jumlah_unit)} unit</span>` },
          { key: 'deskripsi_kerusakan', label: 'Kerusakan' },
          { key: 'pelapor', label: 'Pelapor' },
          { key: 'status', label: 'Status', render: r => badgeStatus(r.status) },
          { key: 'teknisi', label: 'Teknisi' },
          { key: 'biaya', label: 'Biaya', align: 'right', render: r => fmtRupiah(r.biaya) },
          { key: 'tanggal_selesai', label: 'Selesai', render: r => esc(fmtDate(r.tanggal_selesai)) },
          { key: '_aksi', label: 'Aksi', render: r => STATUS_AKHIR.indexOf(r.status) === -1 && App.can('updatePemeliharaan')
            ? `<div class="td-actions">${actionBtn('ubah', r.id_pemeliharaan, 'pencil', 'Perbarui status')}</div>` : '' }
        ],
        onAction: (act, key, row) => { if (act === 'ubah') openUpdate(row); }
      });
      $('#m-q').addEventListener('input', debounce(applyFilter, 200));
      $('#m-status').addEventListener('change', applyFilter);
      await loadAll();
    }
  });
})();
