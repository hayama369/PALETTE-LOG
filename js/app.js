/* =========================================================
   app.js ― 全体の流れとボタンのひも付けを担当するファイル
   ---------------------------------------------------------
   ・起動時に保存済みの作品を読み込んでギャラリーを描く
   ・画像の追加（ボタン／ドラッグ＆ドロップ）
   ・並び順の切り替え、色フィルター、黒猫フィルター
   ・詳細画面からの変更（黒猫・日付・削除）を保存して反映
   ========================================================= */

(() => {
  const $ = (id) => document.getElementById(id);

  // ---- 状態 ----
  const works = new Map(); // 作品id → 作品情報
  const knownKeys = new Set(); // 取り込み済みファイルの目印（重複チェック用）
  let newestFirst = true; // 並び順
  let filter = Filters.emptyState();
  let needsRender = false; // 詳細を閉じたときに一覧を描き直すか
  let importing = false;
  let toastTimer = null;

  // =========================================================
  // 起動
  // =========================================================
  async function start() {
    $('app-name').textContent = CONFIG.APP_NAME;
    Gallery.init($('gallery'), openDetail);
    Detail.init({
      get: (id) => works.get(id),
      onToggleCat: toggleCat,
      onSetDate: setDate,
      onDelete: deleteWork,
      onClose: () => needsRender && render(),
    });
    renderFilterBar();
    bindUpload();

    $('sort').addEventListener('click', () => {
      newestFirst = !newestFirst;
      render();
    });

    try {
      const all = await DB.getAllArtworks();
      all.forEach((a) => {
        works.set(a.id, a);
        knownKeys.add(a.fileKey);
      });
    } catch (e) {
      toast('保存場所を開けなかった。プライベートブラウズでは使えないことがある。');
    }
    render();
  }

  // =========================================================
  // ギャラリーを描く
  // =========================================================
  function currentList() {
    const list = [...works.values()].filter((a) => Filters.matches(a, filter));
    return Model.sort(list, newestFirst);
  }

  function render() {
    needsRender = false;
    const list = currentList();
    Gallery.render(list);

    const total = works.size;
    $('count').textContent = Filters.isActive(filter) ? list.length + ' / ' + total + ' 点' : total + ' 点';
    $('sort-label').textContent = newestFirst ? '新しい順' : '古い順';
    $('empty').hidden = total > 0;
    $('no-match').hidden = !(total > 0 && list.length === 0);
    $('controls').hidden = total === 0;
  }

  // =========================================================
  // フィルター
  // =========================================================
  function renderFilterBar() {
    const bar = $('filters');
    bar.textContent = '';

    // 黒猫
    const cat = chip('cat', 'cat', '黒猫');
    cat.insertAdjacentHTML('afterbegin', Cat.icon(true));
    cat.classList.add('chip-cat');
    bar.appendChild(cat);

    Filters.GROUPS.forEach((g) => {
      bar.appendChild(Object.assign(document.createElement('span'), { className: 'chip-sep' }));
      g.options.forEach((o) => {
        const c = chip(g.key, o.key, o.label);
        if (o.swatch) {
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = o.swatch;
          c.prepend(dot);
        }
        bar.appendChild(c);
      });
    });
    syncChips();

    bar.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      const { group, value } = c.dataset;
      if (group === 'cat') filter.cat = !filter.cat;
      else filter[group] = filter[group] === value ? null : value; // もう一度押したら解除
      syncChips();
      render();
    });
    $('clear-filter').addEventListener('click', () => {
      filter = Filters.emptyState();
      syncChips();
      render();
    });
  }

  function chip(group, value, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.group = group;
    b.dataset.value = value;
    b.append(label);
    return b;
  }

  function syncChips() {
    document.querySelectorAll('#filters .chip').forEach((c) => {
      const on = c.dataset.group === 'cat' ? filter.cat : filter[c.dataset.group] === c.dataset.value;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('clear-filter').hidden = !Filters.isActive(filter);
  }

  // =========================================================
  // 画像の追加
  // =========================================================
  function bindUpload() {
    const input = $('file-input');
    $('add').addEventListener('click', () => input.click());
    $('empty-add').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      importFiles(input.files);
      input.value = '';
    });

    // ドラッグ＆ドロップ（画面のどこに落としてもOK）
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      $('drop').hidden = false;
    });
    window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) $('drop').hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      $('drop').hidden = true;
      importFiles(e.dataTransfer.files);
    });
  }

  async function importFiles(fileList) {
    if (importing) return toast('いま取り込み中。終わってからもう一度。');
    const files = Importer.pickImages(fileList || []);
    if (!files.length) return toast('画像ファイルが見つからなかった。');

    importing = true;
    DB.requestPersist(); // ブラウザに「勝手に消さないで」とお願い
    const bar = $('progress');
    bar.hidden = false;
    let sinceRender = 0;

    const result = await Importer.run(files, knownKeys, {
      onProgress: (done, total) => {
        $('progress-text').textContent = '取り込み中　' + done + ' / ' + total;
        $('progress-fill').style.width = (done / total) * 100 + '%';
      },
      onAdded: (a) => {
        works.set(a.id, a);
        // 取り込みながら少しずつ表示（毎回だと重いので12枚ごと）
        if (++sinceRender >= 12) {
          sinceRender = 0;
          render();
        }
      },
    });

    importing = false;
    bar.hidden = true;
    render();

    const parts = [result.added + '点 追加した。'];
    if (result.skipped) parts.push('同じ画像' + result.skipped + '点は飛ばした。');
    if (result.failed.length) parts.push(result.failed.length + '点は読めなかった（' + result.failed.slice(0, 3).join('、') + (result.failed.length > 3 ? ' ほか' : '') + '）。');
    toast(parts.join(' '));
  }

  // =========================================================
  // 詳細画面とのやりとり
  // =========================================================
  function openDetail(id) {
    Detail.open(id, currentList().map((a) => a.id));
  }

  // 画面上の情報を先に書き換えてから保存する（保存待ちの間に閉じても表示がずれないように）
  async function save(a) {
    works.set(a.id, a);
    await DB.putArtwork(a);
    if (needsRender && !Detail.isOpen()) render();
    return a;
  }

  async function toggleCat(id) {
    const a = { ...works.get(id) };
    a.favorite = !a.favorite;
    a.favoritedAt = a.favorite ? Date.now() : null;
    if (filter.cat) needsRender = true;
    Gallery.updateCat(a);
    return save(a);
  }

  // mode: 'manual' / 'unknown' / 'auto'
  async function setDate(id, mode, ms) {
    const a = { ...works.get(id) };
    if (mode === 'manual') {
      a.manualSet = true;
      a.manualDate = ms;
    } else if (mode === 'unknown') {
      a.manualSet = true;
      a.manualDate = null;
    } else {
      a.manualSet = false;
      a.manualDate = null;
    }
    needsRender = true; // 並び順が変わるので、閉じたときに描き直す
    return save(a);
  }

  async function deleteWork(id) {
    const a = works.get(id);
    works.delete(id); // 画面上は先に消す
    if (a) knownKeys.delete(a.fileKey);
    needsRender = true;
    await DB.deleteArtwork(id);
    Gallery.forget(id);
    if (!Detail.isOpen()) render();
    toast('削除した。');
  }

  // =========================================================
  // お知らせ
  // =========================================================
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 5000);
  }

  start();
})();
