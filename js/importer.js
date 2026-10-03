/* =========================================================
   importer.js ― 画像の取り込み（一括アップロード）を担当するファイル
   ---------------------------------------------------------
   1枚ずつ、次の順で処理します（100枚でも画面が固まらないように、
   1枚ごとにブラウザへ一息つかせています）。

     1. 同じファイルを既に取り込んでいたら飛ばす
     2. 制作日を探す（date-reader.js）
     3. 画像を読み込む
     4. サムネイルを作る（ギャラリー用。元画像は一切いじらない）
     5. 色を解析する（color.js）
     6. 保存する（db.js）… 元画像は受け取ったファイルをそのまま保存
   ========================================================= */

const Importer = (() => {
  const ACCEPT = /^image\/(jpeg|png|webp|gif|avif|bmp|heic|heif)$/i;
  const ACCEPT_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i;

  /** 画像ファイルだけを選び出す */
  function pickImages(fileList) {
    return Array.from(fileList).filter((f) => ACCEPT.test(f.type) || ACCEPT_EXT.test(f.name));
  }

  /**
   * まとめて取り込む
   * @param {File[]} files
   * @param {Set<string>} knownKeys 取り込み済みファイルの目印（重複チェック用）
   * @param {object} hooks onProgress(済んだ数, 全体), onAdded(作品情報)
   * @returns {Promise<{added:number, skipped:number, failed:string[]}>}
   */
  async function run(files, knownKeys, hooks = {}) {
    const result = { added: 0, skipped: 0, failed: [] };
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      hooks.onProgress && hooks.onProgress(i, files.length);
      const key = fileKey(file);
      if (knownKeys.has(key)) {
        result.skipped++;
        continue;
      }
      try {
        const artwork = await importOne(file, key);
        knownKeys.add(key);
        result.added++;
        hooks.onAdded && hooks.onAdded(artwork);
      } catch (e) {
        console.warn('取り込み失敗:', file.name, e);
        result.failed.push(file.name);
      }
      await breathe(); // 画面が固まらないよう一息
    }
    hooks.onProgress && hooks.onProgress(files.length, files.length);
    return result;
  }

  async function importOne(file, key) {
    const importedAt = Date.now();
    const date = await DateReader.read(file, importedAt);

    const img = await decode(file);
    try {
      const thumb = await makeThumb(img);
      const color = ColorAnalyzer.analyzePixels(samplePixels(img));
      const artwork = {
        id: newId(),
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        fileKey: key,
        width: img.width,
        height: img.height,
        thumbWidth: thumb.width,
        thumbHeight: thumb.height,
        importedAt,
        fileLastModified: file.lastModified || null,
        autoDate: date.date,
        autoDateSource: date.source,
        manualSet: false,
        manualDate: null,
        favorite: false,
        favoritedAt: null,
        color,
        tags: [],
      };
      // 元画像は File をそのまま保存（再圧縮しない）
      await DB.addArtwork(artwork, file, thumb.blob);
      return artwork;
    } finally {
      img.close && img.close(); // メモリを空ける
    }
  }

  // 画像を読み込む（使えれば速い createImageBitmap、だめなら <img>）
  async function decode(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file);
      } catch (e) {
        /* 下の方法で再挑戦 */
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, isImg: true };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  const sourceOf = (img) => (img.isImg ? img.source : img);

  // サムネイル（長い辺 THUMB_MAX まで縮めた JPEG）
  function makeThumb(img) {
    const scale = Math.min(1, CONFIG.THUMB_MAX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#18181a'; // 透明部分はギャラリーの地の色で埋める
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceOf(img), 0, 0, w, h);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, width: w, height: h }) : reject(new Error('サムネイル作成失敗'))),
        'image/jpeg',
        CONFIG.THUMB_QUALITY
      )
    );
  }

  // 色を数えるための小さな画像のピクセル
  function samplePixels(img) {
    const scale = Math.min(1, CONFIG.COLOR_SAMPLE_MAX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sourceOf(img), 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  // 同じファイルかどうかの目印（名前・大きさ・更新日時）
  function fileKey(file) {
    return [file.name, file.size, file.lastModified].join('|');
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const breathe = () => new Promise((r) => setTimeout(r, 0));

  return { pickImages, run };
})();
