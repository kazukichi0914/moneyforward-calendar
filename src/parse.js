// MoneyForward ME のトップページ（https://moneyforward.com/）から総資産を取り出す。
//
// 2026-10 時点の実ページの構造（サーバー側で描画される HTML）:
//   <section id="user-info">
//     <section class="total-assets">
//       <h1 class="heading-normal margin-zero">総資産</h1>
//       <div class="heading-radius-box">12,345,678円</div>
//   ...
//   <section id="assets-info">
//     <section class="total-assets clearfix">
//       <h1 class="heading-normal">総資産</h1>
//       <p class="number heading-radius-box">12,345,678円（前日比）...</p>

/** "12,345,678円" のような文字列の先頭にある金額を整数にする。見つからなければ null。 */
export function parseYen(text) {
  if (typeof text !== 'string') return null;
  const m = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .match(/^\s*([-−]?)\s*([\d,]+)\s*円/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ''));
  if (!Number.isSafeInteger(n)) return null;
  return m[1] ? -n : n;
}

/** トップページの HTML 文字列から総資産を取り出す（Service Worker には DOMParser が無いため正規表現で読む）。 */
export function extractTotalAssetsFromHtml(html) {
  if (typeof html !== 'string') return null;
  const patterns = [
    /<section[^>]*class="total-assets"[^>]*>[\s\S]*?総資産[\s\S]*?<div[^>]*class="heading-radius-box"[^>]*>([^<]*)</,
    /<section[^>]*class="total-assets[^"]*"[^>]*>[\s\S]*?総資産[\s\S]*?<p[^>]*class="[^"]*\bnumber\b[^"]*"[^>]*>([^<]*)</,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const n = parseYen(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * 表示中のページの DOM から総資産を取り出す。chrome.scripting.executeScript でページ内で実行するため、
 * この関数は外側の変数を使わない自己完結の形にしてある。
 */
export function extractTotalAssetsFromDom() {
  const selectors = [
    'section#user-info section.total-assets .heading-radius-box',
    'section#assets-info section.total-assets p.number',
    'section.total-assets .heading-radius-box',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const text = el.textContent
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    const m = text.match(/^\s*([-−]?)\s*([\d,]+)\s*円/);
    if (m) {
      const n = Number(m[2].replace(/,/g, ''));
      if (Number.isSafeInteger(n)) return m[1] ? -n : n;
    }
  }
  return null;
}
