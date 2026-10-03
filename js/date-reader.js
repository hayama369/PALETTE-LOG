/* =========================================================
   date-reader.js ― 画像ファイルから「制作日らしき日時」を探すファイル
   ---------------------------------------------------------
   探す順番（見つかった時点で終了）：
     1. EXIF の日時（撮影日時 → デジタル化日時 → 更新日時の順）
        … JPEG / PNG(eXIfチャンク) / WebP(EXIFチャンク) に対応
     2. XMP などのメタデータ（作成日時）
     3. ファイルの更新日時 … ただし取り込んだ瞬間に近すぎるときは信用しない
     4. どれも無ければ「不明」

   ※ SNSから保存し直した画像や書き出し直した画像は、元の日時が
     消えていることがよくあります。分からないものは無理に決めず「不明」にします。

   外部ライブラリは使わず、ファイルの中身（バイト列）を直接読んでいます。
   ========================================================= */

const DateReader = (() => {
  // 取得元の表示名
  const SOURCE_LABEL = {
    exif: 'EXIF',
    metadata: 'メタデータ',
    file: 'ファイル日時',
    manual: '手動',
    unknown: '不明',
  };

  const JPEG_HEAD_BYTES = 512 * 1024; // JPEGは先頭だけ読めば日時が入っている

  /**
   * ファイルから日時を探す
   * @param {File} file
   * @param {number} importedAt 取り込んだ時刻（ファイル日時を疑うために使う）
   * @returns {Promise<{date:number|null, source:string}>}
   */
  async function read(file, importedAt) {
    let found = null;
    try {
      found = await readEmbedded(file);
    } catch (e) {
      found = null; // 壊れたメタデータは無視
    }
    if (found) return found;

    // ファイルの更新日時（取り込んだ時刻とほぼ同じなら、選んだ瞬間に付いた時刻とみなして使わない）
    const lm = file.lastModified;
    if (lm && isReasonable(lm) && Math.abs(importedAt - lm) > CONFIG.FILE_DATE_DISTRUST_SEC * 1000) {
      return { date: lm, source: 'file' };
    }
    return { date: null, source: 'unknown' };
  }

  // ---------------------------------------------------------
  // 画像の中に埋め込まれた日時を探す
  // ---------------------------------------------------------
  async function readEmbedded(file) {
    const type = (file.type || '').toLowerCase();
    const isJpeg = type.includes('jpeg') || /\.jpe?g$/i.test(file.name);
    const blob = isJpeg ? file.slice(0, JPEG_HEAD_BYTES) : file;
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    if (bytes[0] === 0xff && bytes[1] === 0xd8) return fromJpeg(view, bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return fromPng(view, bytes);
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return fromWebp(view, bytes);
    return null;
  }

  // --- JPEG：APP1 セグメントに EXIF / XMP が入っている ---
  function fromJpeg(view, bytes) {
    let off = 2;
    let xmpResult = null;
    while (off + 4 < bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break; // 画像データ本体に入ったら終わり
      const size = view.getUint16(off + 2);
      const start = off + 4;
      if (marker === 0xe1) {
        if (ascii(bytes, start, 6) === 'Exif\0\0') {
          const d = fromTiff(view, start + 6);
          if (d) return { date: d, source: 'exif' };
        } else if (ascii(bytes, start, 28) === 'http://ns.adobe.com/xap/1.0/') {
          const d = fromXmp(text(bytes, start, size - 2));
          if (d) xmpResult = { date: d, source: 'metadata' };
        }
      }
      off += 2 + size;
    }
    return xmpResult;
  }

  // --- PNG：eXIf / tEXt / iTXt チャンク ---
  function fromPng(view, bytes) {
    let off = 8;
    let meta = null;
    while (off + 8 <= bytes.length) {
      const len = view.getUint32(off);
      const type = ascii(bytes, off + 4, 4);
      const start = off + 8;
      if (type === 'eXIf') {
        const d = fromTiff(view, start);
        if (d) return { date: d, source: 'exif' };
      } else if (type === 'tEXt' && !meta) {
        const raw = text(bytes, start, len, 'latin1');
        const i = raw.indexOf('\0');
        const key = raw.slice(0, i);
        // 「Creation Time」はアプリが付ける作成日時。date:create 等は変換時刻なので使わない
        if (/^creation time$/i.test(key)) {
          const d = parseLoose(raw.slice(i + 1));
          if (d) meta = { date: d, source: 'metadata' };
        }
      } else if (type === 'iTXt' && !meta) {
        const raw = text(bytes, start, len);
        if (raw.startsWith('XML:com.adobe.xmp')) {
          const d = fromXmp(raw);
          if (d) meta = { date: d, source: 'metadata' };
        }
      } else if (type === 'IEND') {
        break;
      }
      off = start + len + 4; // データ＋CRC
    }
    return meta;
  }

  // --- WebP：RIFF の EXIF / XMP チャンク ---
  function fromWebp(view, bytes) {
    let off = 12;
    let meta = null;
    while (off + 8 <= bytes.length) {
      const type = ascii(bytes, off, 4);
      const len = view.getUint32(off + 4, true);
      const start = off + 8;
      if (type === 'EXIF') {
        const tiffStart = ascii(bytes, start, 6) === 'Exif\0\0' ? start + 6 : start;
        const d = fromTiff(view, tiffStart);
        if (d) return { date: d, source: 'exif' };
      } else if (type === 'XMP ') {
        const d = fromXmp(text(bytes, start, len));
        if (d) meta = { date: d, source: 'metadata' };
      }
      off = start + len + (len % 2); // 奇数長は1バイト詰め物がある
    }
    return meta;
  }

  // --- EXIF本体（TIFF形式）を読む ---
  // 優先：DateTimeOriginal(0x9003) → DateTimeDigitized(0x9004) → DateTime(0x0132)
  function fromTiff(view, base) {
    const order = view.getUint16(base);
    const le = order === 0x4949; // 'II' = リトルエンディアン
    if (!le && order !== 0x4d4d) return null;
    const u16 = (o) => view.getUint16(base + o, le);
    const u32 = (o) => view.getUint32(base + o, le);

    function readIfd(ifdOff) {
      const out = {};
      if (base + ifdOff + 2 > view.byteLength) return out;
      const n = u16(ifdOff);
      for (let i = 0; i < n; i++) {
        const e = ifdOff + 2 + i * 12;
        if (base + e + 12 > view.byteLength) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        if (type === 2) {
          // 文字（日時はこれ）
          const at = count <= 4 ? e + 8 : u32(e + 8);
          let s = '';
          for (let k = 0; k < count - 1 && base + at + k < view.byteLength; k++) {
            s += String.fromCharCode(view.getUint8(base + at + k));
          }
          out[tag] = s;
        } else if (type === 4) {
          out[tag] = u32(e + 8); // 別の場所へのポインタなど
        }
      }
      return out;
    }

    const ifd0 = readIfd(u32(4));
    const exif = ifd0[0x8769] ? readIfd(ifd0[0x8769]) : {};
    const candidates = [exif[0x9003], exif[0x9004], ifd0[0x0132]];
    for (const c of candidates) {
      const d = parseExifDate(c);
      if (d) return d;
    }
    return null;
  }

  // --- XMP（XML形式のメタデータ）から作成日時を探す ---
  function fromXmp(xml) {
    const keys = ['exif:DateTimeOriginal', 'photoshop:DateCreated', 'xmp:CreateDate'];
    for (const k of keys) {
      const m = xml.match(new RegExp(k + '(?:="([^"]+)"|>([^<]+)<)'));
      if (m) {
        const d = parseLoose(m[1] || m[2]);
        if (d) return d;
      }
    }
    return null;
  }

  // ---------------------------------------------------------
  // 日時の文字 → 数値
  // ---------------------------------------------------------
  // EXIF形式 "2024:05:03 21:15:00"
  function parseExifDate(s) {
    if (!s) return null;
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    return isReasonable(d) ? d : null;
  }

  // いろいろな形式（ISO形式・EXIF形式など）
  function parseLoose(s) {
    if (!s) return null;
    s = s.trim();
    const exif = parseExifDate(s);
    if (exif) return exif;
    const d = Date.parse(s);
    return isReasonable(d) ? d : null;
  }

  // ありえる日時か（1980年〜来年まで）
  function isReasonable(ms) {
    if (!ms || isNaN(ms)) return false;
    const y = new Date(ms).getFullYear();
    return y >= 1980 && y <= new Date().getFullYear() + 1;
  }

  // ---------------------------------------------------------
  // バイト列 → 文字
  // ---------------------------------------------------------
  function ascii(bytes, start, len) {
    let s = '';
    for (let i = 0; i < len && start + i < bytes.length; i++) s += String.fromCharCode(bytes[start + i]);
    return s;
  }

  function text(bytes, start, len, enc = 'utf-8') {
    const end = Math.min(bytes.length, start + len);
    try {
      return new TextDecoder(enc).decode(bytes.subarray(start, end));
    } catch (e) {
      return ascii(bytes, start, end - start);
    }
  }

  return { read, SOURCE_LABEL };
})();
