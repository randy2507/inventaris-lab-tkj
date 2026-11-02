/* =====================================================================
   MODUL KATEGORI, LOKASI, PENGGUNA, PENGATURAN — modul-admin.js (Tahap 3E)
   ===================================================================== */
'use strict';

(function () {
  /* ---------- Kategori & Lokasi (daftar master) ---------- */
  function masterView(c) {
    let table = null;
    const canEdit = () => App.can(c.addAction);

    async function load() {
      table.setRows(await c.getFn({ semua: canEdit() }));
    }

    function openForm(row) {
      const edit = !!row, r = row || {};
      const f = [
        field({ name: c.nameKey, label: c.nameLabel, required: true, value: r[c.nameKey], attrs: `maxlength="100"${edit ? ' readonly' : ''}`, help: edit ? 'Nama tidak dapat diubah karena dipakai pada data barang.' : '' }),
        field({ name: c.descKey, label: c.descLabel, type: 'textarea', value: r[c.descKey], attrs: 'maxlength="300"' }),
        edit ? field({ name: 'status', label: 'Status', type: 'select', options: ['Aktif', 'Nonaktif'], value: r.status }) : ''
      ].join('');
      const m = openModal({
        title: (edit ? 'Ubah ' : 'Tambah ') + c.singular,
        body: `<form id="master-form" novalidate><div class="form-grid" style="grid-template-columns:1fr">${f}</div><div id="form-error"></div></form>`,
        footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="master-form" class="btn btn-primary" id="ms-save">Simpan</button>'
      });
      const form = $('#master-form', m.el);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = validateForm(form);
        if (!v.ok) return;
        const data = v.data;
        if (edit) data[c.idKey] = r[c.idKey];
        const btn = $('#ms-save', m.el);
        btn.disabled = true;
        try {
          const res = await c.saveFn(data);
          m.close();
          showToast(res.message || 'Data disimpan.');
          await App.loadMeta();
          await load();
        } catch (err) {
          $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
          showToast(err.message, 'err');
          btn.disabled = false;
        }
      });
    }

    App.registerView(c.view, {
      async render(body, ctx) {
        if (canEdit()) {
          ctx.actions.innerHTML = `<button type="button" class="btn btn-primary">Tambah ${esc(c.singular)}</button>`;
          $('button', ctx.actions).onclick = () => openForm(null);
        }
        body.innerHTML = `<p class="sub" style="margin-bottom:14px">${esc(c.note)}</p><div id="ms-table"></div>`;
        table = createTable({
          container: $('#ms-table'), rows: [], rowKey: r => r[c.idKey], sortKey: c.nameKey, caption: 'Daftar ' + c.singular,
          empty: { title: 'BELUM ADA DATA', text: `Belum ada ${c.singular}.` },
          columns: [
            { key: '_no', label: 'No', render: (r, i) => i },
            { key: c.nameKey, label: c.nameLabel, render: r => `<strong>${esc(r[c.nameKey])}</strong>` },
            { key: c.descKey, label: c.descLabel },
            { key: 'status', label: 'Status', render: r => badgeStatus(r.status) },
            { key: '_aksi', label: 'Aksi', render: r => canEdit() ? `<div class="td-actions">${actionBtn('ubah', r[c.idKey], 'pencil', 'Ubah')}</div>` : '' }
          ],
          onAction: (act, key, row) => { if (act === 'ubah') openForm(row); }
        });
        await load();
      }
    });
  }

  masterView({
    view: 'kategori', singular: 'kategori', getFn: getKategori, saveFn: saveKategori, idKey: 'id_kategori', nameKey: 'nama_kategori',
    nameLabel: 'Nama kategori', descKey: 'deskripsi', descLabel: 'Deskripsi', addAction: 'addKategori',
    note: 'Kategori yang dinonaktifkan tidak muncul pada pilihan barang baru, tetapi barang lama tetap tersimpan.'
  });
  masterView({
    view: 'lokasi', singular: 'lokasi', getFn: getLokasi, saveFn: saveLokasi, idKey: 'id_lokasi', nameKey: 'nama_lokasi',
    nameLabel: 'Nama lokasi', descKey: 'keterangan', descLabel: 'Keterangan', addAction: 'addLokasi',
    note: 'Lokasi yang dinonaktifkan tidak muncul pada pilihan baru, tetapi barang lama tetap tersimpan.'
  });

  /* ---------- Pengguna ---------- */
  (function () {
    let table = null;
    async function load() { table.setRows(await getPengguna()); }

    function openForm(row) {
      const edit = !!row, r = row || {};
      const f = [
        field({ name: 'nama', label: 'Nama', required: true, value: r.nama, attrs: 'maxlength="100"' }),
        field({ name: 'email', label: 'Email Google', type: 'email', required: true, value: r.email, attrs: `maxlength="150"${edit ? ' readonly' : ''}`, help: edit ? 'Email tidak dapat diubah.' : 'Harus sama dengan akun Google yang dipakai untuk masuk.' }),
        field({ name: 'role', label: 'Peran', type: 'select', required: true, options: state.enums.role, placeholder: 'Pilih peran', value: r.role }),
        field({ name: 'status', label: 'Status', type: 'select', options: ['Aktif', 'Nonaktif'], value: r.status || 'Aktif' })
      ].join('');
      const m = openModal({
        title: edit ? 'Ubah Pengguna' : 'Tambah Pengguna',
        body: `<form id="user-form" novalidate><div class="form-grid" style="grid-template-columns:1fr">${f}</div><div id="form-error"></div></form>`,
        footer: '<button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" form="user-form" class="btn btn-primary" id="u-save">Simpan</button>'
      });
      const form = $('#user-form', m.el);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = validateForm(form);
        if (!v.ok) return;
        const data = v.data;
        if (edit) data.id_pengguna = r.id_pengguna;
        const btn = $('#u-save', m.el);
        btn.disabled = true;
        try {
          const res = await savePengguna(data);
          m.close();
          showToast(res.message || 'Pengguna disimpan.');
          await load();
        } catch (err) {
          $('#form-error', m.el).innerHTML = `<div class="notice err" role="alert">${esc(err.message)}</div>`;
          showToast(err.message, 'err');
          btn.disabled = false;
        }
      });
    }

    App.registerView('pengguna', {
      async render(body, ctx) {
        ctx.actions.innerHTML = '<button type="button" class="btn btn-primary"><i data-lucide="users"></i> Tambah pengguna</button>';
        $('button', ctx.actions).onclick = () => openForm(null);
        body.innerHTML = `<p class="sub" style="margin-bottom:14px">Hanya akun yang terdaftar dan berstatus Aktif yang dapat masuk. Hak akses diperiksa di server pada setiap permintaan.</p><div id="u-table"></div>`;
        table = createTable({
          container: $('#u-table'), rows: [], rowKey: r => r.id_pengguna, sortKey: 'nama', caption: 'Daftar pengguna',
          empty: { title: 'BELUM ADA PENGGUNA', text: 'Tambahkan pengguna agar dapat masuk.' },
          columns: [
            { key: '_no', label: 'No', render: (r, i) => i },
            { key: 'nama', label: 'Nama', render: r => `<strong>${esc(r.nama)}</strong>` },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Peran', render: r => badge(r.role, 'info') },
            { key: 'status', label: 'Status', render: r => badgeStatus(r.status) },
            { key: 'created_at', label: 'Dibuat', render: r => esc(fmtDateTime(r.created_at)) },
            { key: '_aksi', label: 'Aksi', render: r => `<div class="td-actions">${actionBtn('ubah', r.id_pengguna, 'pencil', 'Ubah')}</div>` }
          ],
          onAction: (act, key, row) => { if (act === 'ubah') openForm(row); }
        });
        await load();
      }
    });
  })();

  /* ---------- Pengaturan ---------- */
  const FX = [
    ['full', 'Penuh', 'Scanlines, noise, garis tracking, glitch, dan semburan static.'],
    ['lite', 'Ringan', 'Hanya scanlines dan vignette. Lebih hemat untuk perangkat lama.'],
    ['off', 'Mati', 'Tampilan polos tanpa efek VHS.']
  ];

  App.registerView('pengaturan', {
    async render(body, ctx) {
      const meta = await App.loadMeta();
      if (!ctx.isCurrent()) return;
      const fx = getFx();
      const adminLog = App.can('getLogAktivitas');
      body.innerHTML = `<div class="two-col">
        <section class="card"><h2>Efek tampilan VHS</h2>
          <fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px"><legend class="sr-only">Pilih tingkat efek</legend>
          ${FX.map(o => `<label style="display:flex;gap:10px;align-items:flex-start"><input type="radio" name="fx" value="${o[0]}"${o[0] === fx ? ' checked' : ''}>
            <span><strong>${o[1]}</strong><br><span class="sub">${o[2]}</span></span></label>`).join('')}</fieldset>
          <p class="sub" style="margin-top:12px">Jika sistem Anda memakai pengaturan "kurangi gerakan", animasi otomatis dimatikan. Efek juga tidak ikut tercetak.</p></section>
        <section class="card"><h2>Akun dan aplikasi</h2><div class="kv-grid" style="grid-template-columns:1fr">
          <div class="kv"><div class="k">Nama</div><div class="v">${esc(meta.user.nama)}</div></div>
          <div class="kv"><div class="k">Email</div><div class="v">${esc(meta.user.email)}</div></div>
          <div class="kv"><div class="k">Peran</div><div class="v">${esc(meta.user.role)}</div></div>
          <div class="kv"><div class="k">Versi backend</div><div class="v">${esc(meta.versi)}</div></div></div></section></div>
        ${adminLog ? '<section class="card" style="margin-top:14px"><h2>Log aktivitas (100 terbaru)</h2><div id="log-table"></div></section>' : ''}`;
      body.onchange = e => {
        if (e.target.name === 'fx') { setFx(e.target.value); channelChange(); showToast('Efek tampilan diperbarui.', 'info'); }
      };
      if (adminLog) {
        const logs = await getLogAktivitas({ limit: 100 });
        if (!ctx.isCurrent()) return;
        createTable({
          container: $('#log-table'), rows: logs.map((l, i) => Object.assign({ _k: String(i) }, l)), rowKey: r => r._k, pageSize: 10, sortKey: null, caption: 'Log aktivitas',
          empty: { title: 'LOG KOSONG', text: 'Belum ada aktivitas tercatat.' },
          columns: [
            { key: 'timestamp', label: 'Waktu', render: r => esc(fmtDateTime(r.timestamp)) },
            { key: 'email_pengguna', label: 'Pengguna' },
            { key: 'aksi', label: 'Aksi' },
            { key: 'modul', label: 'Modul' },
            { key: 'deskripsi', label: 'Deskripsi' }
          ]
        });
      }
    }
  });
})();
