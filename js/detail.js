/* =========================================================
   detail.js ― 作品詳細（1枚を大きく見る画面）の表示
   ---------------------------------------------------------
   表示：作品画像（元画像）／制作日と取得元／COLOR PALETTE／
         明度・彩度・色温度・色系／黒猫／制作日の編集／削除
   操作：左右の矢印・キーボードの ←→・スワイプで前後の作品へ
   保存などの実際の処理は app.js から渡された関数（handlers）が行います。
   ========================================================= */

const Detail = (() => {
  const $ = (id) => document.getElementById(id);
  const TEMP = Model.TEMPERATURE_LABEL;

  let handlers = {};
  let ids = []; // 前後移動の順番（ギャラリーに今出ている順）
  let current = null; // 表示中の作品
  let originalUrl = null;
  let deleteArmed = false;
  let catJustSat = false; // 黒猫が「いま座った」ときだけ座る動きを出す

  /**
   * @param {object} h { get(id), onToggleCat(id), onSetDate(id, mode, ms), onDelete(id) }
   */
  function init(h) {
    handlers = h;
    $('d-close').addEventListener('click', close);
    $('d-prev').addEventListener('click', () => step(-1));
    $('d-next').addEventListener('click', () => step(1));
    $('d-cat').addEventListener('click', toggleCat);
    $('d-date-edit').addEventListener('click', openDateForm);
    $('d-date-cancel').addEventListener('click', closeDateForm);
    $('d-date-form').addEventListener('submit', saveDate);
    $('d-date-unknown').addEventListener('click', () => setDate('unknown'));
    $('d-date-auto').addEventListener('click', () => setDate('auto'));
    $('d-delete').addEventListener('click', pressDelete);

    // キーボード
    document.addEventListener('keydown', (e) => {
      if ($('detail').hidden || e.target.matches('input')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'f' || e.key === 'F') toggleCat();
    });

    // スワイプ（スマホ）
    let startX = null, startY = null;
    const frame = $('d-frame');
    frame.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    frame.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
      startX = null;
    });
  }

  /** 開く。order は前後移動に使う作品idの並び */
  function open(id, order) {
    ids = order;
    $('detail').hidden = false;
    document.body.classList.add('is-detail-open');
    show(id);
    $('d-close').focus();
  }

  function close() {
    $('detail').hidden = true;
    document.body.classList.remove('is-detail-open');
    releaseOriginal();
    if (current && handlers.onClose) handlers.onClose(current.id);
    current = null;
  }

  function isOpen() {
    return !$('detail').hidden;
  }

  function step(dir) {
    if (!current) return;
    const i = ids.indexOf(current.id);
    const next = ids[i + dir];
    if (next) show(next);
  }

  // ---------------------------------------------------------
  // 1作品分を表示
  // ---------------------------------------------------------
  async function show(id) {
    const a = handlers.get(id);
    if (!a) return close();
    const changed = !current || current.id !== id;
    current = a;
    deleteArmed = false;
    closeDateForm();

    // 位置「12 / 48」と前後ボタン
    const i = ids.indexOf(id);
    $('d-count').textContent = i >= 0 ? i + 1 + ' / ' + ids.length : '';
    $('d-prev').disabled = i <= 0;
    $('d-next').disabled = i < 0 || i >= ids.length - 1;

    // 背景をうっすら作品の代表色に
    $('detail').style.setProperty('--tint', a.color ? a.color.dominant : '#000');

    if (changed) loadImage(a);
    render();
  }

  // 画像：まずサムネイルを出し、元画像が読めたら差し替える
  async function loadImage(a) {
    const img = $('d-img');
    releaseOriginal();
    img.style.aspectRatio = a.width + ' / ' + a.height;
    const thumb = Gallery.thumbUrl(a.id);
    if (thumb) img.src = thumb;
    else img.removeAttribute('src');
    img.alt = Model.formatDate(Model.dateOf(a)) + 'の作品';
    const blob = await DB.getOriginal(a.id);
    if (!blob || !current || current.id !== a.id) return;
    originalUrl = URL.createObjectURL(blob);
    img.src = originalUrl;
  }

  function releaseOriginal() {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = null;
  }

  // 文字や色の部分を描き直す
  function render() {
    const a = current;
    if (!a) return;

    // --- 黒猫 ---
    const frame = $('d-frame');
    const sitting = frame.querySelector('.sitting-cat');
    if (a.favorite && !sitting) {
      frame.insertAdjacentHTML('beforeend', Cat.sitter());
      if (catJustSat) frame.querySelector('.sitting-cat').classList.add('is-arriving');
    }
    if (!a.favorite && sitting) sitting.remove();
    catJustSat = false;
    const catBtn = $('d-cat');
    catBtn.setAttribute('aria-pressed', a.favorite ? 'true' : 'false');
    catBtn.querySelector('.cat-slot').innerHTML = Cat.icon(a.favorite);
    $('d-cat-label').textContent = a.favorite ? '黒猫がいる' : '黒猫を座らせる';

    // --- 制作日 ---
    const ms = Model.dateOf(a);
    const src = Model.sourceOf(a);
    $('d-date').textContent = Model.formatDate(ms);
    const badge = $('d-source');
    badge.textContent = DateReader.SOURCE_LABEL[src];
    badge.dataset.source = src;
    $('d-source-note').textContent = sourceNote(src);

    // --- 色 ---
    renderColor(a.color);

    // --- ファイル情報 ---
    $('d-file').textContent = [
      a.fileName,
      a.width + ' × ' + a.height + ' px',
      Model.formatBytes(a.fileSize),
      '取り込み ' + Model.formatDate(a.importedAt),
    ].join('　');

    // --- 削除ボタン（2回押し） ---
    const del = $('d-delete');
    del.textContent = deleteArmed ? '本当に削除する' : '削除';
    del.classList.toggle('is-armed', deleteArmed);
  }

  // 取得元ごとの一言
  function sourceNote(src) {
    return {
      exif: '画像に記録されていた日時。',
      metadata: '画像のメタデータに記録されていた作成日時。',
      file: 'ファイルの更新日時。書き出し直した日のこともある。',
      manual: '手動で設定した日付。',
      unknown: '画像から日付が取れなかった。',
    }[src];
  }

  function renderColor(c) {
    const band = $('d-band');
    const sw = $('d-swatches');
    band.textContent = '';
    sw.textContent = '';
    if (!c) {
      $('d-metrics').hidden = true;
      return;
    }
    $('d-metrics').hidden = false;

    // 面積の割合どおりの帯
    c.palette.forEach((p) => {
      const s = document.createElement('span');
      s.style.background = p.hex;
      s.style.flexGrow = String(p.share);
      s.title = p.hex + '　' + Math.round(p.share * 100) + '%';
      band.appendChild(s);
    });

    // 色見本（■）と色コード
    c.palette.forEach((p) => {
      const li = document.createElement('li');
      const chip = document.createElement('span');
      chip.className = 'swatch';
      chip.style.background = p.hex;
      const code = document.createElement('span');
      code.className = 'hex';
      code.textContent = p.hex.toUpperCase();
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = Math.round(p.share * 100) + '%';
      li.append(chip, code, pct);
      sw.appendChild(li);
    });

    setMeter('d-bright', c.brightness);
    setMeter('d-sat', c.saturation);
    $('d-temp').textContent = TEMP[c.temperature];
    $('d-hues').textContent = c.hues.length ? c.hues.map((h) => Model.HUE_LABEL[h]).join('・') : '色みが少ない';
  }

  function setMeter(id, v) {
    $(id + '-v').textContent = String(v);
    $(id + '-bar').style.width = v + '%';
  }

  // ---------------------------------------------------------
  // 操作
  // ---------------------------------------------------------
  async function toggleCat() {
    if (!current) return;
    catJustSat = !current.favorite; // これから座るなら、座る動きを出す
    current = await handlers.onToggleCat(current.id);
    render();
  }

  function openDateForm() {
    const a = current;
    $('d-date-form').hidden = false;
    $('d-date-edit').hidden = true;
    $('d-date-input').value = Model.toInputDate(Model.dateOf(a));
    $('d-date-auto').hidden = !a.manualSet;
    $('d-date-unknown').hidden = Model.sourceOf(a) === 'unknown';
    $('d-auto-note').textContent = a.autoDate
      ? '自動で取れた日付：' + Model.formatDate(a.autoDate) + '（' + DateReader.SOURCE_LABEL[a.autoDateSource] + '）'
      : '自動では日付が取れなかった。';
    $('d-date-input').focus();
  }

  function closeDateForm() {
    $('d-date-form').hidden = true;
    $('d-date-edit').hidden = false;
  }

  function saveDate(e) {
    e.preventDefault();
    const ms = Model.fromInputDate($('d-date-input').value);
    if (!ms) return $('d-date-input').focus();
    setDate('manual', ms);
  }

  // mode: 'manual'（日付を指定） / 'unknown'（不明にする） / 'auto'（自動に戻す）
  async function setDate(mode, ms) {
    if (!current) return;
    current = await handlers.onSetDate(current.id, mode, ms);
    closeDateForm();
    render();
  }

  async function pressDelete() {
    if (!current) return;
    if (!deleteArmed) {
      deleteArmed = true;
      return render();
    }
    const id = current.id;
    const i = ids.indexOf(id);
    ids = ids.filter((x) => x !== id);
    await handlers.onDelete(id);
    // 次の作品へ（なければ閉じる）
    const next = ids[i] || ids[i - 1];
    current = null;
    if (next) show(next);
    else close();
  }

  return { init, open, close, isOpen };
})();
