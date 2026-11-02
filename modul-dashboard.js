/* =====================================================================
   MODUL DASHBOARD — modul-dashboard.js (Tahap 3C)
   Bergantung pada fungsi inti di script.js.
   ===================================================================== */
'use strict';

(function () {
  const KONDISI_WARNA = {
    'Baik': '#3dffa2', 'Rusak Ringan': '#ffd23f', 'Rusak Berat': '#ff2e97', 'Dalam Perbaikan': '#00e5ff', 'Tidak Diketahui': '#6b77ad'
  };

  function kartuHtml(k) {
    const items = [
      ['Total jenis barang', k.total_jenis, 'info'],
      ['Total unit barang', k.total_unit, 'info'],
      ['Kondisi baik', k.baik, 'ok'],
      ['Rusak ringan', k.rusak_ringan, 'warn'],
      ['Rusak berat', k.rusak_berat, 'bad'],
      ['Sedang dipinjam', k.dipinjam, 'info'],
      ['Sedang diperbaiki', k.diperbaiki, 'info'],
      ['Perlu ditindaklanjuti', k.perlu_tindak_lanjut, k.perlu_tindak_lanjut > 0 ? 'bad' : 'ok']
    ];
    return `<div class="stat-grid">${items.map(i =>
      `<div class="stat-card tone-${i[2]}"><span class="stat-label">${esc(i[0])}</span><span class="stat-value">${fmtNum(i[1])}</span></div>`).join('')}</div>`;
  }

  function chartCard(id, title) {
    return `<section class="card" aria-label="${esc(title)}"><h2>${esc(title)}</h2><div class="chart-box"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div></section>`;
  }

  function aktivitasHtml(list) {
    if (!list.length) return emptyState('BELUM ADA AKTIVITAS', 'Aktivitas akan muncul setelah ada perubahan data.');
    return `<ul class="activity-list">${list.map(a =>
      `<li><time datetime="${esc(a.timestamp)}">${esc(fmtDateTime(a.timestamp))}</time>
        <span><strong>${esc(a.aksi)}</strong> — ${esc(a.deskripsi)}${a.pengguna ? ` <span class="sub">(${esc(a.pengguna)})</span>` : ''}</span></li>`).join('')}</ul>`;
  }

  function gambar(g) {
    const tick = { color: '#9aa5d6' };
    const grid = { color: 'rgba(42,52,112,.6)' };
    const adaData = arr => arr.some(x => x.nilai > 0);

    const kat = g.per_kategori;
    if (adaData(kat)) {
      drawChart('kategori', $('#c-kategori'), {
        type: 'bar',
        data: { labels: kat.map(x => x.label), datasets: [{ label: 'Jumlah unit', data: kat.map(x => x.nilai), backgroundColor: '#00e5ff', borderColor: '#ff2e97', borderWidth: 1 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: tick, grid: grid }, y: { ticks: tick, grid: { display: false } } } }
      });
    } else $('#c-kategori').parentElement.innerHTML = '<p class="sub">Belum ada data.</p>';

    const kon = g.per_kondisi;
    if (adaData(kon)) {
      drawChart('kondisi', $('#c-kondisi'), {
        type: 'doughnut',
        data: { labels: kon.map(x => x.label), datasets: [{ data: kon.map(x => x.nilai), backgroundColor: kon.map(x => KONDISI_WARNA[x.label] || '#6b77ad'), borderColor: '#0a0e27', borderWidth: 2 }] },
        options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { color: '#e8ecff' } } } }
      });
    } else $('#c-kondisi').parentElement.innerHTML = '<p class="sub">Belum ada data.</p>';

    const lok = g.per_lokasi;
    if (adaData(lok)) {
      drawChart('lokasi', $('#c-lokasi'), {
        type: 'bar',
        data: { labels: lok.map(x => x.label), datasets: [{ label: 'Jumlah unit', data: lok.map(x => x.nilai), backgroundColor: lok.map((x, i) => VHS_COLORS[i % VHS_COLORS.length]) }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: tick, grid: { display: false } }, y: { beginAtZero: true, ticks: tick, grid: grid } } }
      });
    } else $('#c-lokasi').parentElement.innerHTML = '<p class="sub">Belum ada data.</p>';

    const bln = g.transaksi_bulanan;
    if (bln.some(x => x.masuk > 0 || x.keluar > 0)) {
      drawChart('bulanan', $('#c-bulanan'), {
        type: 'bar',
        data: {
          labels: bln.map(x => x.label),
          datasets: [
            { label: 'Masuk', data: bln.map(x => x.masuk), backgroundColor: '#00e5ff' },
            { label: 'Keluar', data: bln.map(x => x.keluar), backgroundColor: '#ff2e97' }
          ]
        },
        options: { plugins: { legend: { labels: { color: '#e8ecff' } } }, scales: { x: { ticks: tick, grid: { display: false } }, y: { beginAtZero: true, ticks: tick, grid: grid } } }
      });
    } else $('#c-bulanan').parentElement.innerHTML = '<p class="sub">Belum ada transaksi dalam 12 bulan terakhir.</p>';
  }

  App.registerView('dashboard', {
    async render(body, ctx) {
      ctx.actions.innerHTML = '<button type="button" class="btn" id="dash-refresh"><i data-lucide="repeat"></i> Muat ulang</button>';
      $('#dash-refresh', ctx.actions).onclick = () => App.refresh();
      const d = await getDashboardData();
      if (!ctx.isCurrent()) return;

      if (d.kartu.total_jenis === 0) {
        body.innerHTML = emptyState('BELUM ADA DATA INVENTARIS',
          'Dashboard akan terisi setelah barang pertama ditambahkan.',
          App.can('addBarang') ? '<button type="button" class="btn btn-primary" onclick="App.navigate(\'barang\')">Ke Data Barang</button>' : '');
        return;
      }
      body.innerHTML = kartuHtml(d.kartu) +
        `<div class="chart-grid">${chartCard('c-kategori', 'Jumlah barang per kategori')}${chartCard('c-kondisi', 'Kondisi barang')}
         ${chartCard('c-lokasi', 'Distribusi barang per lokasi')}${chartCard('c-bulanan', 'Barang masuk dan keluar per bulan')}</div>
         <section class="card"><h2>Aktivitas terbaru</h2>${aktivitasHtml(d.aktivitas_terbaru)}
         <p class="sub" style="margin-top:12px">Data dibaca dari Google Sheets: ${esc(fmtDateTime(d.dibuat))}</p></section>`;
      gambar(d.grafik);
    }
  });
})();
