/* =========================================================
   gallery.js ― ギャラリー（年・月で区切った作品一覧）の表示
   ---------------------------------------------------------
   ・作品はトリミングせず、縦横比のまま並べます。
     1行ごとに高さが揃うよう、横幅を縦横比に合わせて伸び縮みさせています
     （style.css の .work と --row-h を参照）。
   ・サムネイルは、画面に近づいた作品の分だけ読み込みます（100枚以上でも軽い）。
   ・元画像はここでは使いません（詳細画面でだけ読み込む）。
   ========================================================= */

const Gallery = (() => {
  let root = null;
  let observer = null;
  const urls = new Map(); // 作品id → サムネイルの表示用URL

  function init(container, onOpen) {
    root = container;
    root.addEventListener('click', (e) => {
      const card = e.target.closest('.work');
      if (card) onOpen(card.dataset.id);
    });
    // 画面の少し手前（600px）に来たらサムネイルを読み込む
    observer = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && loadThumb(en.target)),
      { rootMargin: '600px 0px' }
    );
  }

  /** 並べ替え・絞り込み済みの一覧を描く */
  function render(list) {
    observer.disconnect();
    root.textContent = '';
    const frag = document.createDocumentFragment();

    Model.groupByMonth(list).forEach((y) => {
      const section = el('section', 'year-block');
      const head = el('h2', 'year', y.year ? String(y.year) : '日付不明');
      section.appendChild(head);
      if (!y.year) {
        section.appendChild(el('p', 'year-note', '制作日が分からない作品。作品を開くと日付を入れられる。'));
      }

      y.months.forEach((m) => {
        if (m.month) section.appendChild(el('h3', 'month', m.month + '月'));
        const flow = el('div', 'flow');
        m.items.forEach((a) => flow.appendChild(card(a)));
        flow.appendChild(el('i', 'flow-end')); // 最後の行が伸びすぎないための詰め物
        section.appendChild(flow);
      });
      frag.appendChild(section);
    });

    root.appendChild(frag);
    root.querySelectorAll('.work').forEach((c) => observer.observe(c));
  }

  // 作品1枚分
  function card(a) {
    const b = el('button', 'work');
    b.type = 'button';
    b.dataset.id = a.id;
    const ar = a.thumbWidth / a.thumbHeight || 1;
    b.style.setProperty('--ar', ar.toFixed(4));
    if (a.color) b.style.backgroundColor = a.color.dominant; // 読み込み前は代表色で埋めておく
    b.setAttribute('aria-label', Model.formatDate(Model.dateOf(a)) + 'の作品' + (a.favorite ? '（黒猫）' : ''));

    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    if (urls.has(a.id)) {
      img.src = urls.get(a.id);
      img.classList.add('is-loaded');
    }
    img.addEventListener('load', () => img.classList.add('is-loaded'));
    b.appendChild(img);

    if (a.favorite) b.insertAdjacentHTML('beforeend', Cat.sitter());
    return b;
  }

  async function loadThumb(cardEl) {
    observer.unobserve(cardEl);
    const id = cardEl.dataset.id;
    const img = cardEl.querySelector('img');
    if (img.src) return;
    if (!urls.has(id)) {
      const blob = await DB.getThumb(id);
      if (!blob) return;
      urls.set(id, URL.createObjectURL(blob));
    }
    img.src = urls.get(id);
  }

  /** 黒猫の付け外しだけを反映（一覧を作り直さない） */
  function updateCat(artwork) {
    const c = root.querySelector('.work[data-id="' + CSS.escape(artwork.id) + '"]');
    if (!c) return;
    const sitting = c.querySelector('.sitting-cat');
    if (artwork.favorite && !sitting) c.insertAdjacentHTML('beforeend', Cat.sitter());
    if (!artwork.favorite && sitting) sitting.remove();
  }

  /** 削除した作品のURLを片づける */
  function forget(id) {
    if (urls.has(id)) {
      URL.revokeObjectURL(urls.get(id));
      urls.delete(id);
    }
  }

  /** サムネイルのURL（詳細画面で、元画像が出るまでのつなぎに使う） */
  function thumbUrl(id) {
    return urls.get(id) || null;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  return { init, render, updateCat, forget, thumbUrl };
})();
