/* =========================================================
   color.js ― 画像から色を読み取るファイル（AIは使わない）
   ---------------------------------------------------------
   やっていること：
     1. 小さく縮めた画像のピクセルを1つずつ見る
     2. 人の目の感じ方に近い色の目盛り「OKLab」に変換する
        （L = 明るさ、a/b = 色み。色みの強さ＝彩度、色みの向き＝色相）
     3. k-means（似た色どうしをグループにまとめる方法）で主要色を5色にまとめる
     4. 平均の明度・彩度、暖色／寒色、何色系かを計算する

   結果の形（作品情報の color に入る）：
   {
     version: 1,                  解析方法を変えた時に、古い結果を見分けるための番号
     dominant: '#rrggbb',         代表色（いちばん面積の大きい色）
     palette: [{hex, share}],     主要色（面積の大きい順。share は割合 0〜1）
     brightness: 0〜100,          平均明度
     saturation: 0〜100,          平均彩度
     temperature: 'warm' | 'cool' | 'neutral',
     hues: ['red','yellow','green','blue','purple'] のうち当てはまるもの
   }
   ========================================================= */

const ColorAnalyzer = (() => {
  const VERSION = 1;

  // 色相（OKLabの角度）→ 色系。範囲は [始まり, 終わり) の度数
  const HUE_FAMILIES = [
    { key: 'red', from: 345, to: 45 }, // 赤〜ピンク
    { key: 'yellow', from: 45, to: 120 }, // 橙〜黄
    { key: 'green', from: 120, to: 175 },
    { key: 'blue', from: 175, to: 285 }, // 水色〜青
    { key: 'purple', from: 285, to: 345 },
  ];
  // 暖色・寒色とみなす色相の範囲（緑・紫はどちらにも数えない＝中間）
  const WARM = { from: 345, to: 115 };
  const COOL = { from: 175, to: 290 };
  // 暖色（寒色）と判定する条件：色み全体の半分以上を占め、かつ反対側の1.6倍以上
  const TEMP_SHARE_MIN = 0.5;
  const TEMP_RATIO_MIN = 1.6;

  const CHROMA_FULL = 0.2; // この色みの強さを「彩度100」とみなす
  const CHROMA_MIN = 0.035; // これより色みが弱いピクセルは「無彩色」扱い

  // sRGB(0〜255) → 光の強さ(0〜1) の早見表
  const LINEAR = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function toOklab(r, g, b) {
    const lr = LINEAR[r], lg = LINEAR[g], lb = LINEAR[b];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function inRange(h, r) {
    return r.from < r.to ? h >= r.from && h < r.to : h >= r.from || h < r.to;
  }

  // 決まった順番で出る乱数（同じ画像なら毎回同じ結果にするため）
  function seededRandom(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * ピクセル（ImageData.data）から色を解析する
   * @param {Uint8ClampedArray} data RGBA の並び
   */
  function analyzePixels(data) {
    // --- 1. ピクセルを OKLab に変換（透明部分は除く） ---
    const px = []; // [L, a, b, r, g, b]
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const [L, A, B] = toOklab(data[i], data[i + 1], data[i + 2]);
      px.push([L, A, B, data[i], data[i + 1], data[i + 2]]);
    }
    if (!px.length) return empty();

    // --- 2. 平均の明度・彩度、色相の分布 ---
    let sumL = 0, sumSat = 0, chromatic = 0, warm = 0, cool = 0, chromaSum = 0;
    const familyWeight = {};
    for (const p of px) {
      const C = Math.hypot(p[1], p[2]);
      sumL += p[0];
      sumSat += Math.min(1, C / CHROMA_FULL);
      if (C < CHROMA_MIN) continue;
      chromatic++;
      chromaSum += C;
      const h = (Math.atan2(p[2], p[1]) * 180) / Math.PI + 360;
      const hue = h % 360;
      const fam = HUE_FAMILIES.find((f) => inRange(hue, f));
      familyWeight[fam.key] = (familyWeight[fam.key] || 0) + C;
      if (inRange(hue, WARM)) warm += C;
      else if (inRange(hue, COOL)) cool += C;
    }
    const brightness = Math.round((sumL / px.length) * 100);
    const saturation = Math.round((sumSat / px.length) * 100);
    const chromaticRatio = chromatic / px.length;

    // 何色系か
    const totalFam = Object.values(familyWeight).reduce((a, b) => a + b, 0);
    const hues =
      chromaticRatio < 0.1 || !totalFam
        ? []
        : HUE_FAMILIES.map((f) => f.key).filter((k) => (familyWeight[k] || 0) / totalFam >= CONFIG.HUE_SHARE_MIN);

    // 暖色／寒色
    // 暖色／寒色（緑や紫が主役の絵、色みが少ない絵は「ニュートラル」）
    let temperature = 'neutral';
    if (chromaticRatio >= 0.1 && saturation >= 8 && chromaSum > 0) {
      const w = warm / chromaSum;
      const c = cool / chromaSum;
      if (w >= TEMP_SHARE_MIN && w >= c * TEMP_RATIO_MIN) temperature = 'warm';
      else if (c >= TEMP_SHARE_MIN && c >= w * TEMP_RATIO_MIN) temperature = 'cool';
    }

    // --- 3. 主要色（k-means） ---
    const palette = kmeans(px, CONFIG.PALETTE_SIZE);

    return {
      version: VERSION,
      dominant: palette[0].hex,
      palette,
      brightness,
      saturation,
      temperature,
      hues,
    };
  }

  // 似た色をグループにまとめて、各グループの平均色と割合を返す
  function kmeans(px, k) {
    const rand = seededRandom(px.length);
    const dist = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;

    // 初期位置（k-means++：なるべく離れた色を選ぶ）
    const centers = [px[Math.floor(rand() * px.length)].slice(0, 3)];
    while (centers.length < k) {
      const d = px.map((p) => Math.min(...centers.map((c) => dist(p, c))));
      const sum = d.reduce((a, b) => a + b, 0);
      if (!sum) break; // 全部同じ色
      let r = rand() * sum;
      let idx = 0;
      while ((r -= d[idx]) > 0 && idx < d.length - 1) idx++;
      centers.push(px[idx].slice(0, 3));
    }

    // 繰り返し：近い中心に割り当て → 中心を平均へ移動
    const assign = new Int32Array(px.length);
    for (let iter = 0; iter < 12; iter++) {
      let moved = false;
      for (let i = 0; i < px.length; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const dd = dist(px[i], centers[c]);
          if (dd < bestD) { bestD = dd; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < px.length; i++) {
        const a = acc[assign[i]];
        a[0] += px[i][0]; a[1] += px[i][1]; a[2] += px[i][2]; a[3]++;
      }
      acc.forEach((a, c) => { if (a[3]) centers[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
      if (!moved && iter > 0) break;
    }

    // 各グループの平均色（元のRGBで平均して、色ずれを防ぐ）
    const groups = centers.map((c) => ({ lab: c, r: 0, g: 0, b: 0, n: 0 }));
    for (let i = 0; i < px.length; i++) {
      const g = groups[assign[i]];
      g.r += px[i][3]; g.g += px[i][4]; g.b += px[i][5]; g.n++;
    }

    // ほぼ同じ色のグループは1つにまとめる
    const merged = [];
    groups
      .filter((g) => g.n)
      .sort((a, b) => b.n - a.n)
      .forEach((g) => {
        const near = merged.find((m) => dist(m.lab, g.lab) < 0.03 ** 2);
        if (near) {
          near.r += g.r; near.g += g.g; near.b += g.b; near.n += g.n;
        } else merged.push(g);
      });

    return merged
      .sort((a, b) => b.n - a.n)
      .map((g) => ({
        hex: toHex(g.r / g.n, g.g / g.n, g.b / g.n),
        share: Math.round((g.n / px.length) * 1000) / 1000,
      }));
  }

  function toHex(r, g, b) {
    return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function empty() {
    return { version: VERSION, dominant: '#000000', palette: [{ hex: '#000000', share: 1 }], brightness: 0, saturation: 0, temperature: 'neutral', hues: [] };
  }

  return { analyzePixels, VERSION };
})();
