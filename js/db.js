/* =========================================================
   db.js ― データの保存と読み込みだけを担当するファイル
   ---------------------------------------------------------
   ブラウザ内の IndexedDB に、3つの棚に分けて保存します。

     artworks   … 作品の情報（日付・色・黒猫など。軽い）
     originals  … 元画像そのもの（受け取ったファイルを一切加工せず保存）
     thumbs     … ギャラリー用のサムネイル画像（軽い）

   将来クラウド保存や同期を足すときは、このファイルの中身を
   差し替えれば、ほかのファイルはそのまま使えるようにしてあります。

   【Artwork（作品情報）の形】
   {
     id,                 作品ごとの固有ID
     fileName, fileType, fileSize, fileKey(重複チェック用),
     width, height,      元画像の大きさ
     thumbWidth, thumbHeight,
     importedAt,         アプリに取り込んだ日時（createdAtInApp）
     fileLastModified,   ファイルの更新日時（参考）
     autoDate,           自動で取れた制作日（取れなければ null）
     autoDateSource,     'exif' | 'metadata' | 'file' | 'unknown'
     manualSet,          制作日を手動で設定したか（true なら自動の日付より優先）
     manualDate,         手動で設定した制作日（manualSet が true で null なら「手動で不明にした」）
     favorite,           黒猫マーク（true / false）
     favoritedAt,
     color: {            色の解析結果（color.js が作る）
       version, dominant, palette:[{hex, share}],
       brightness, saturation, temperature, hues:[...]
     },
     tags: []            将来の「雰囲気タグ」用（MVPでは空）
                         予定の形：{ name, source:'user'|'ai', status:'suggested'|'accepted' }
   }
   日時はすべて「1970年からのミリ秒」の数値です。
   ========================================================= */

const DB = (() => {
  const DB_NAME = 'palette-log';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('artworks')) db.createObjectStore('artworks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('originals')) db.createObjectStore('originals');
        if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // 1回分の読み書き。stores は使う棚の名前の配列
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const out = fn(...stores.map((s) => t.objectStore(s)));
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  /** 作品を1件まるごと保存（情報＋元画像＋サムネイル） */
  function addArtwork(artwork, originalBlob, thumbBlob) {
    return tx(['artworks', 'originals', 'thumbs'], 'readwrite', (a, o, t) => {
      a.put(artwork);
      o.put(originalBlob, artwork.id);
      t.put(thumbBlob, artwork.id);
    });
  }

  /** 作品情報をすべて取得（画像は含まない） */
  function getAllArtworks() {
    return tx(['artworks'], 'readonly', (a) => a.getAll());
  }

  /** 作品情報を更新（黒猫・日付の変更など） */
  function putArtwork(artwork) {
    return tx(['artworks'], 'readwrite', (a) => {
      a.put(artwork);
    });
  }

  function getThumb(id) {
    return tx(['thumbs'], 'readonly', (t) => t.get(id));
  }

  function getOriginal(id) {
    return tx(['originals'], 'readonly', (o) => o.get(id));
  }

  /** 作品を削除（情報・元画像・サムネイルすべて） */
  function deleteArtwork(id) {
    return tx(['artworks', 'originals', 'thumbs'], 'readwrite', (a, o, t) => {
      a.delete(id);
      o.delete(id);
      t.delete(id);
    });
  }

  /** ブラウザに「勝手に消さないで」とお願いする（対応ブラウザのみ） */
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) {
      /* 非対応なら何もしない */
    }
    return false;
  }

  return { addArtwork, getAllArtworks, putArtwork, getThumb, getOriginal, deleteArtwork, requestPersist };
})();
