/* =========================================================
   model.js ― 作品情報の「読み方」をまとめたファイル
   ---------------------------------------------------------
   ・制作日はどれを使うか（手動＞自動）
   ・日付や色の表示名
   ・時系列の並べ方、年月ごとのまとめ方
   画面のファイル（gallery.js / detail.js）はここを通して作品情報を読みます。
   ========================================================= */

const Model = (() => {
  // 色温度・色系の表示名と、フィルターの丸い印に使う見本色
  const TEMPERATURE_LABEL = { warm: '暖色', cool: '寒色', neutral: 'ニュートラル' };
  const HUE_LABEL = { red: '赤系', yellow: '黄色系', green: '緑系', blue: '青系', purple: '紫系' };
  const HUE_SAMPLE = { red: '#c4505f', yellow: '#d6a63c', green: '#5c9a63', blue: '#4f74b8', purple: '#8a62b0' };

  /**
   * 制作日（手動で設定していればそちらが優先）
   * manualSet が true で manualDate が null のとき＝「手動で不明にした」
   */
  function dateOf(a) {
    return a.manualSet ? a.manualDate : a.autoDate;
  }

  /** 制作日の取得元：'exif' | 'metadata' | 'file' | 'manual' | 'unknown' */
  function sourceOf(a) {
    if (a.manualSet) return a.manualDate ? 'manual' : 'unknown';
    return a.autoDate ? a.autoDateSource : 'unknown';
  }

  /** 「2026年10月3日」 */
  function formatDate(ms) {
    if (!ms) return '日付不明';
    const d = new Date(ms);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /** <input type="date"> 用の「2026-10-03」 */
  function toInputDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** 「2026-10-03」→ その日の正午（時差でずれないように）の数値 */
  function fromInputDate(s) {
    const m = (s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : null;
  }

  /** 並べ替え。newestFirst=true で新しい順。日付不明は常に最後 */
  function sort(list, newestFirst) {
    return list.slice().sort((a, b) => {
      const da = dateOf(a), db = dateOf(b);
      if (!da && !db) return b.importedAt - a.importedAt;
      if (!da) return 1;
      if (!db) return -1;
      return newestFirst ? db - da : da - db;
    });
  }

  /**
   * 年・月ごとにまとめる（並び順はそのまま）
   * 戻り値：[{ year, months:[{ month, items:[...] }] }, ...]、日付不明は year=null
   */
  function groupByMonth(sorted) {
    const years = [];
    let y = null, m = null;
    sorted.forEach((a) => {
      const ms = dateOf(a);
      const year = ms ? new Date(ms).getFullYear() : null;
      const month = ms ? new Date(ms).getMonth() + 1 : null;
      if (!y || y.year !== year) {
        y = { year, months: [] };
        years.push(y);
        m = null;
      }
      if (!m || m.month !== month) {
        m = { month, items: [] };
        y.months.push(m);
      }
      m.items.push(a);
    });
    return years;
  }

  /** ファイルの大きさ「2.4 MB」 */
  function formatBytes(n) {
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  return { TEMPERATURE_LABEL, HUE_LABEL, HUE_SAMPLE, dateOf, sourceOf, formatDate, toInputDate, fromInputDate, sort, groupByMonth, formatBytes };
})();
