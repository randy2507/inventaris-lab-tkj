/* =====================================================================
   MODUL LAPORAN — modul-laporan.js (Tahap 3E)
   Tampilan, ekspor CSV, dan cetak. Ekspor Excel tidak disediakan.
   ===================================================================== */
'use strict';

(function () {
  const JUDUL = {
    inventaris: 'Inventaris keseluruhan', kategori: 'Barang per kategori', kondisi: 'Kondisi barang', lokasi: 'Barang per lokasi',
    transaksi: 'Barang masuk dan keluar', peminjaman: 'Peminjaman', keterlambatan: 'Keterlambatan pengembalian',
    pemeliharaan: 'Pemeliharaan', nilai: 'Nilai inventaris'
  };
  const BERBASIS_STOK = ['inventaris', 'kategori', 'kondisi', 'lokasi', 'nilai'];
  let hasil = null;

  function sel(id) { return $(id); }

  function cell(col, row) {
    const v = row[col.key];
    if (col.tipe === 'rupiah') return fmtRupiah(v);
    if (col.tipe === 'angka') return fmtNum(v);
    if (col.tipe === 'tanggal') return esc(fmtDate(v));
    if (col.key === 'kondisi') return badgeKondisi(v);
    if (col.key === 'status_efektif' || col.key === 'status') return badgeStatus(v);
    if (col.key === 'jenis_transaksi') return esc(v);
    return esc(v === '' || v === undefined || v === null ? '-' : v);
  }

  function render(res) {
    const periode = (res.periode.dari || res.periode.sampai)
      ? `${res.periode.dari ? fmtDate(res.periode.dari) : 'awal'} s.d. ${res.periode.sampai ? fmtDate(res.periode.sampai) : 'sekarang'}` : 'Semua periode';
    const ringkas = res.ringkasan.map(r =>
      `<div class="stat-card tone-info"><span class="stat-label">${esc(r.label)}</span><span class="stat-value" style="font-size:${r.tipe === 'rupiah' ? 28 : 42}px">${r.tipe === 'rupiah' ? fmtRupiah(r.nilai) : fmtNum(r.nilai)}</span></div>`).join('');
    const tabel = res.baris.length
      ? `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(res.judul)}</caption><thead><tr>
          <th scope="col">No</th>${res.kolom.map(c => `<th scope="col" class="${c.tipe === 'angka' || c.tipe === 'rupiah' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${res.baris.map((r, i) => `<tr><td>${i + 1}</td>${res.kolom.map(c => `<td class="${c.tipe === 'angka' || c.tipe === 'rupiah' ? 'num' : ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : emptyState('TIDAK ADA DATA', 'Tidak ada data yang cocok dengan filter laporan ini.');
    $('#r-out').innerHTML = `<section class="card" style="margin-bottom:14px"><h2>${esc(res.judul)}</h2>
        <p class="sub">Periode: ${esc(periode)} • Kategori: ${esc(res.kategori || 'Semua')} • Dibuat: ${esc(fmtDateTime(res.dibuat))}</p>
        ${BERBASIS_STOK.indexOf(res.jenis) > -1 && (res.periode.dari || res.periode.sampai) ? '<p class="sub">Periode memfilter berdasarkan tanggal pengadaan barang.</p>' : ''}</section>
      <div class="stat-grid">${ringkas}</div>${tabel}`;
    $('#r-csv').disabled = !res.baris.length;
    $('#r-print').disabled = false;
  }

  async function tampilkan() {
    const dari = sel('#r-dari').value, sampai = sel('#r-sampai').value;
    if (dari && sampai && dari > sampai) { showToast('Tanggal awal tidak boleh setelah tanggal akhir.', 'err'); return; }
    hasil = await getLaporan({ jenis: sel('#r-jenis').value, kategori: sel('#r-kat').value, dari: dari, sampai: sampai });
    render(hasil);
  }

  App.registerView('laporan', {
    async render(body, ctx) {
      const jenis = state.enums.jenis_laporan;
      ctx.actions.innerHTML = `<button type="button" class="btn" id="r-csv" disabled><i data-lucide="file-text"></i> Ekspor CSV</button>
        <button type="button" class="btn btn-primary" id="r-print" disabled><i data-lucide="file-text"></i> Cetak</button>`;
      body.innerHTML = `<div class="toolbar no-print">
          <label class="field-label" for="r-jenis">Jenis</label>
          <select id="r-jenis" class="select">${jenis.map(j => `<option value="${esc(j)}">${esc(JUDUL[j] || j)}</option>`).join('')}</select>
          <label class="field-label" for="r-kat">Kategori</label>
          <select id="r-kat" class="select"><option value="">Semua kategori</option>${state.kategori.map(k => `<option>${esc(k)}</option>`).join('')}</select>
          <label class="field-label" for="r-dari">Dari</label><input id="r-dari" class="input" type="date">
          <label class="field-label" for="r-sampai">Sampai</label><input id="r-sampai" class="input" type="date">
          <button type="button" class="btn btn-primary" id="r-show">Tampilkan</button></div>
        <div id="r-out"></div>`;
      $('#r-show').onclick = () => tampilkan().catch(reportError);
      $('#r-print').onclick = () => window.print();
      $('#r-csv').onclick = () => {
        if (!hasil || !hasil.baris.length) return;
        downloadFile(`laporan-${hasil.jenis}-${todayLocal()}.csv`, toCsv(hasil.kolom, hasil.baris));
        showToast('File CSV diunduh.', 'info');
      };
      hasil = null;
      await tampilkan();
      refreshIcons();
    }
  });
})();
