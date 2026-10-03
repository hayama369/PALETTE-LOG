/* =========================================================
   filters.js ― ギャラリーの絞り込み（フィルター）の定義
   ---------------------------------------------------------
   ・フィルターは「グループ」ごとに1つまで選べます（もう一度押すと解除）。
   ・グループ同士は「かつ」でつながります。
     例：「寒色」かつ「暗い」かつ「黒猫」
   ・新しいフィルターを足したいときは GROUPS に1行足すだけでOK。
     test は「その作品が当てはまるなら true」を返す関数です。
   ・境目の数字（暗い／明るいなど）は config.js にあります。
   ========================================================= */

const Filters = (() => {
  const GROUPS = [
    {
      key: 'temp',
      options: [
        { key: 'warm', label: '暖色', test: (c) => c.temperature === 'warm' },
        { key: 'cool', label: '寒色', test: (c) => c.temperature === 'cool' },
        { key: 'neutral', label: 'ニュートラル', test: (c) => c.temperature === 'neutral' },
      ],
    },
    {
      key: 'sat',
      options: [
        { key: 'lowsat', label: '低彩度', test: (c) => c.saturation < CONFIG.LOW_SAT_BELOW },
        { key: 'highsat', label: '高彩度', test: (c) => c.saturation >= CONFIG.HIGH_SAT_FROM },
      ],
    },
    {
      key: 'light',
      options: [
        { key: 'dark', label: '暗い', test: (c) => c.brightness < CONFIG.DARK_BELOW },
        { key: 'bright', label: '明るい', test: (c) => c.brightness >= CONFIG.BRIGHT_FROM },
      ],
    },
    {
      key: 'hue',
      options: ['red', 'yellow', 'green', 'blue', 'purple'].map((h) => ({
        key: h,
        label: Model.HUE_LABEL[h],
        swatch: Model.HUE_SAMPLE[h],
        test: (c) => c.hues.includes(h),
      })),
    },
  ];

  /** 何も選んでいない状態 */
  function emptyState() {
    const s = { cat: false };
    GROUPS.forEach((g) => (s[g.key] = null));
    return s;
  }

  /** 作品が今の絞り込みに当てはまるか */
  function matches(artwork, state) {
    if (state.cat && !artwork.favorite) return false;
    for (const g of GROUPS) {
      const chosen = state[g.key];
      if (!chosen) continue;
      if (!artwork.color) return false; // 色をまだ解析していない作品は除く
      const opt = g.options.find((o) => o.key === chosen);
      if (opt && !opt.test(artwork.color)) return false;
    }
    return true;
  }

  /** 何か絞り込んでいるか */
  function isActive(state) {
    return state.cat || GROUPS.some((g) => state[g.key]);
  }

  /** 作品の色がどの分類に当てはまるか（詳細画面の表示用） */
  function labelsFor(color) {
    const out = [];
    GROUPS.forEach((g) => g.options.forEach((o) => color && o.test(color) && out.push(o.label)));
    return out;
  }

  return { GROUPS, emptyState, matches, isActive, labelsFor };
})();
