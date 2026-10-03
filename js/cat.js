/* =========================================================
   cat.js ― 黒猫マーク（このアプリの「お気に入り」）の絵
   ---------------------------------------------------------
   ・シンプルな座った黒猫のシルエット。色は style.css で決めています。
   ・Cat.icon()  … ボタンやフィルターに使う小さいアイコン（文字色に合わせて塗る）
   ・Cat.sitter() … 作品の隅に座る黒猫（金色の目つき）
   ========================================================= */

const Cat = (() => {
  // 座った猫の形（頭・耳・体・床に流したしっぽ）
  const BODY = `
    <path d="M33 121 C29 95 37 68 60 60 C83 68 91 95 87 121 Z"/>
    <path d="M37 38 L39 9 L57 26 Z"/>
    <path d="M83 38 L81 9 L63 26 Z"/>
    <ellipse cx="60" cy="45" rx="25" ry="22"/>`;
  const TAIL = 'M40 120 C27 123 15 121 10 111';

  /** 小さいアイコン（filled=false で輪郭だけ） */
  function icon(filled = true) {
    return `<svg class="cat-icon${filled ? ' is-filled' : ''}" viewBox="4 4 92 122" aria-hidden="true" focusable="false">
      <path class="cat-tail" d="${TAIL}"/>
      <g class="cat-body">${BODY}</g>
    </svg>`;
  }

  /** 作品の隅に座る黒猫 */
  function sitter() {
    return `<span class="sitting-cat" aria-hidden="true">
      <svg viewBox="4 4 92 122" focusable="false">
        <path class="cat-tail rim" d="${TAIL}"/>
        <g class="cat-body rim">${BODY}</g>
        <path class="cat-tail" d="${TAIL}"/>
        <g class="cat-body">${BODY}</g>
        <circle class="cat-eye" cx="50" cy="46" r="5"/>
        <circle class="cat-eye" cx="70" cy="46" r="5"/>
        <ellipse class="cat-pupil" cx="50" cy="46" rx="1.5" ry="3.8"/>
        <ellipse class="cat-pupil" cx="70" cy="46" rx="1.5" ry="3.8"/>
      </svg>
    </span>`;
  }

  return { icon, sitter };
})();
