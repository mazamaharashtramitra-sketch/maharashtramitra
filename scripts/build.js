#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const config = read('data/config.json');
const editions = fs.readdirSync(path.join(ROOT, 'data/editions'))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/editions', f), 'utf8')));

const OUT = path.join(ROOT, 'public');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const toMr = n => String(n).replace(/\d/g, d => '०१२३४५६७८९'[+d]);

const WORDS_PER_PAGE = (config.newsletter && config.newsletter.wordsPerPage) || 450;

function loadArticles(cat) {
  const dir = path.join(ROOT, 'data/articles', cat);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function loadAds(edition) {
  const files = [
    'data/ads/default.json',
    'data/ads/state/maharashtra.json',
    edition.city ? `data/ads/city/${edition.city.toLowerCase().replace(/\s+/g,'-')}.json` : null,
    `data/ads/city/${edition.slug}.json`,
    `data/ads/neighborhood/${edition.slug}.json`
  ].filter(Boolean);

  const merged = { slots: {} };
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    for (const [slot, ad] of Object.entries(data.slots || {})) {
      merged.slots[slot] = ad;
    }
  }
  return merged;
}

function seededPick(arr, seed, count) {
  if (!arr.length) return [];
  const a = [...arr];
  let s = 0;
  for (const c of seed) s = ((s << 5) - s + c.charCodeAt(0)) | 0;
  s = Math.abs(s) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  const out = [];
  while (out.length < count) out.push(...a);
  return out.slice(0, count);
}

function splitArticle(body) {
  const paras = String(body || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return [''];

  const pages = [];
  let current = [];
  let count = 0;

  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (count + w > WORDS_PER_PAGE && current.length > 0) {
      pages.push(current.join('\n\n'));
      current = [p];
      count = w;
    } else {
      current.push(p);
      count += w;
    }
  }
  if (current.length) pages.push(current.join('\n\n'));

  return pages.length ? pages : [body];
}

function footerColumns() {
  return (config.footer.columns || []).map(c => `
    <div class="footer-col"><h4>${esc(c.title)}</h4>
      ${c.links.map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}
    </div>`).join('');
}

function renderAd(ad) {
  if (!ad) return '';
  const tier = ad.tier || 'galli';
  const accent = tier === 'premium' ? '#e5a33b'
               : tier === 'shahar'  ? '#315e50'
               : '#e5a33b';

  if (ad.image) {
    return `<a href="${esc(ad.link)}" rel="nofollow sponsored" target="_blank" style="display:block;border:1px solid #e6e1d6;border-left:4px solid ${accent};border-radius:0 12px 12px 0;overflow:hidden;background:#fffefa;text-decoration:none;color:inherit;position:relative">
      <img src="${esc(ad.image)}" alt="${esc(ad.sponsor || ad.title)}" loading="lazy" style="display:block;width:100%;height:auto">
      <span style="position:absolute;top:8px;left:10px;padding:3px 8px;background:rgba(23,43,42,.78);color:#fff;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;border-radius:99px">प्रायोजित · ${esc(ad.sponsor)}</span>
    </a>`;
  }

  return `<a href="${esc(ad.link)}" rel="nofollow sponsored" target="_blank" style="display:grid;gap:6px;padding:18px 20px;border:1px solid #e6e1d6;border-left:4px solid ${accent};border-radius:0 12px 12px 0;background:#fffefa;text-decoration:none;color:inherit">
    <span style="font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b8751f">प्रायोजित · ${esc(ad.sponsor)}</span>
    <span style="font-size:22px;line-height:1">${esc(ad.icon || '★')}</span>
    <strong style="font:700 15px/1.5 Georgia,serif;color:#172b2a">${esc(ad.title)}</strong>
    <span style="color:#40514d;font-size:12px;line-height:1.8">${esc(ad.description)}</span>
    <span style="margin-top:4px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#315e50">${esc(ad.cta)} →</span>
  </a>`;
}

function renderAdBlock(ads, pageKey) {
  const slots = (config.ads && config.ads.slots && config.ads.slots[pageKey])
             || (pageKey.startsWith('page') ? ['galli'] : []);
  if (!slots.length) return '';
  const items = slots.map(k => ads.slots && ads.slots[k]).filter(Boolean);
  if (!items.length) return '';
  const cols = items.length === 1 ? '1fr' : items.length === 2 ? '1fr 1fr' : 'repeat(3,1fr)';
  return `<div style="display:grid;grid-template-columns:${cols};gap:12px;margin:28px 0">
    ${items.map(renderAd).join('')}
  </div>`;
}

function renderCover(edition, date, totalPages) {
  const c = config.cover;
  return `<article class="news-page cover-page" id="page-1">
  <header class="cover-masthead">
    <div class="cover-logo">
      <div class="cover-emblem">म</div>
      <div>
        <div class="cover-name">${esc(edition.name)}</div>
        <div class="cover-kicker">${esc(config.site.tagline)}</div>
      </div>
    </div>
    <div class="issue-stamp">दैनिक अंक<strong>${esc(date)}</strong></div>
  </header>
  <div class="cover-content">
    <span class="cover-label">${esc(c.label)}</span>
    <h1 class="cover-title">आजचं वाचन,<br><span>आजच्या मनाने.</span></h1>
    <p class="cover-description">${esc(config.site.tagline)}</p>
    <div class="cover-bottom">
      <div class="cover-highlights">${(c.highlights||[]).map(h => `<span>${esc(h)}</span>`).join('')}</div>
      <div class="cover-issue-number">आजचा अंक<b>${toMr(totalPages)} पृष्ठे</b></div>
    </div>
  </div>
  <style>.cover-page::before{background:linear-gradient(180deg,rgba(15,30,29,.08) 0%,rgba(15,30,29,.18) 25%,rgba(15,30,29,.92) 68%,#172b2a 100%),url("${esc(c.image)}") center 28%/cover no-repeat;}</style>
</article>`;
}

function renderContents(articles, date, totalPages) {
  const list = articles.map(a => `
    <li><a href="#page-${a.startPage}">
      <span class="contents-number">${toMr(a.startPage)}</span>
      <span class="contents-name">${esc(a.title)}<span class="contents-hint">${esc(a.category)}${a.totalParts > 1 ? ` · ${toMr(a.totalParts)} पृष्ठे` : ''}</span></span>
      <span class="contents-page-no">${toMr(a.startPage)}</span>
    </a></li>`).join('');
  return `<article class="news-page" id="page-2">
  <div class="page-topline"><span>${esc(config.site.name)}</span><span>अनुक्रमणिका</span></div>
  <div class="eyebrow">आजचा अंक</div>
  <h2 class="page-title">आजचं<br><span class="accent">वाचन.</span></h2>
  <p class="page-subtitle">${esc(config.site.tagline)}</p>
  <ol class="contents-list">${list}</ol>
  <footer class="page-footer"><strong>${esc(date)}</strong><span class="folio">०२ / ${toMr(totalPages)}</span></footer>
</article>`;
}

function renderArticle(a, n, part, totalParts, totalPages, ads) {
  const isFirst = part === 1;
  const adBlock = renderAdBlock(ads, `page${n}`);
  return `<article class="news-page" id="page-${n}">
  <div class="page-topline">
    <span>${esc(a.category)}${!isFirst ? ' · क्रमशः' : ''}</span>
    <span>पृष्ठ ${toMr(n)}</span>
  </div>
  <div class="eyebrow">${esc(a.category)}</div>
  ${isFirst
    ? `<h2 class="page-title">${esc(a.title)}</h2>
       <div class="lead-photo"><img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy"></div>
       <div class="page-copy" style="margin-top:20px"><p class="dropcap">${esc(a.parts[part-1])}</p></div>`
    : `<h2 class="page-title" style="font-size:26px">${esc(a.title)}<span style="font-size:14px;color:#747b72;font-weight:400"> · भाग ${toMr(part)} / ${toMr(totalParts)}</span></h2>
       <div class="page-copy" style="margin-top:20px"><p>${esc(a.parts[part-1])}</p></div>`}
  ${isFirst && a.quote && totalParts === 1 ? `<blockquote class="pull-quote">“${esc(a.quote)}”</blockquote>` : ''}
  ${adBlock}
  <footer class="page-footer"><strong>${esc(config.site.name)}</strong><span class="folio">${toMr(n)} / ${toMr(totalPages)}</span></footer>
</article>`;
}

function renderBack(edition, date, totalPages) {
  return `<article class="news-page closing-page" id="page-${totalPages}">
  <div class="page-topline"><span>समारोप</span><span>पुढील अंकाकडे</span></div>
  <div class="eyebrow">धन्यवाद</div>
  <h2 class="page-title">वाचत राहा,<br><span style="color:#f3c66e">जोडलेले राहा.</span></h2>
  <p class="page-subtitle">${esc(edition.name)} — ${esc(config.site.tagline)}</p>
  <div class="closing-signature"><div class="big-mark">म</div><p>मराठी वाचूया. मराठीत जोडलेले राहूया.</p></div>
  <footer class="page-footer"><strong>${esc(edition.name)} · ${esc(date)}</strong><span class="folio">${toMr(totalPages)} / ${toMr(totalPages)}</span></footer>
</article>`;
}

function buildNewsletter(edition, date) {
  const ads = loadAds(edition);
  const articlePages = config.pages.filter(p => p.type === 'article');

  const articles = articlePages.map(p => {
    const [a] = seededPick(loadArticles(p.category), date + p.category, 1);
    const art = a || { title: 'शीघ्र', category: p.category, body: '', image: '', quote: '' };
    return {
      title: art.title,
      category: art.category,
      body: art.body,
      image: art.image,
      quote: art.quote,
      parts: splitArticle(art.body),
      totalParts: 1,
      startPage: 0
    };
  });

  articles.forEach(a => a.totalParts = a.parts.length);

  let cursor = 3;
  articles.forEach(a => {
    a.startPage = cursor;
    cursor += a.totalParts;
  });

  const totalPages = cursor;

  let pages = [renderCover(edition, date, totalPages), renderContents(articles, date, totalPages)];

  for (const a of articles) {
    for (let p = 1; p <= a.totalParts; p++) {
      const n = a.startPage + p - 1;
      pages.push(renderArticle(a, n, p, a.totalParts, totalPages, ads));
    }
  }

  pages.push(renderBack(edition, date, totalPages));

  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/newsletter.html'), 'utf8');

  return tpl
    .replace(/{{EDITION_NAME}}/g, esc(edition.name))
    .replace(/{{TAGLINE}}/g, esc(edition.tagline))
    .replace(/{{PAGE_TITLE}}/g, esc(edition.name + ' · ' + config.site.tagline))
    .replace(/{{META_DESCRIPTION}}/g, esc(edition.tagline))
    .replace(/{{YEAR}}/g, esc(new Date().getFullYear()))
    .replace(/{{ISSUE_DATE}}/g, esc(date))
    .replace(/{{PAGES_HTML}}/g, pages.join('\n'))
    .replace(/{{FOOTER_COLUMNS}}/g, footerColumns());
}

function buildLegalPage(page) {
  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/legal.html'), 'utf8');
  const defaultEdition = editions.find(e => e.slug === 'maharashtra') || editions[0];

  const sections = (page.sections || []).map(s => `
    <section style="margin-bottom:32px">
      <h2 style="font:700 20px/1.5 var(--serif);margin:0 0 10px;color:var(--ink)">${esc(s.heading)}</h2>
      <p style="margin:0;color:var(--ink-soft);font-size:14px;line-height:1.95;white-space:pre-line">${esc(s.body)}</p>
    </section>`).join('');

  return tpl
    .replace(/{{EDITION_NAME}}/g, esc(defaultEdition.name))
    .replace(/{{TAGLINE}}/g, esc(defaultEdition.tagline))
    .replace(/{{PAGE_TITLE}}/g, esc(page.title))
    .replace(/{{PAGE_SUBTITLE}}/g, esc(page.subtitle || ''))
    .replace(/{{CATEGORY}}/g, esc(page.title))
    .replace(/{{UPDATED}}/g, esc(page.updated || ''))
    .replace(/{{SECTIONS_HTML}}/g, sections)
    .replace(/{{YEAR}}/g, esc(new Date().getFullYear()))
    .replace(/{{FOOTER_COLUMNS}}/g, footerColumns());
}

const today = new Date().toISOString().slice(0, 10);

let n = 0;
for (const ed of editions) {
  const html = buildNewsletter(ed, today);
  const dir = ed.slug === 'maharashtra' ? OUT : path.join(OUT, ed.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  n++;
}

let legalCount = 0;
const legalDir = path.join(ROOT, 'data/pages');
if (fs.existsSync(legalDir)) {
  for (const file of fs.readdirSync(legalDir).filter(f => f.endsWith('.json'))) {
    const page = JSON.parse(fs.readFileSync(path.join(legalDir, file), 'utf8'));
    const html = buildLegalPage(page);
    const dir = path.join(OUT, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    legalCount++;
  }
}

fs.mkdirSync(path.join(OUT, '_assets'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src/style.css'), path.join(OUT, '_assets/style.css'));
fs.copyFileSync(path.join(ROOT, 'src/script.js'), path.join(OUT, '_assets/script.js'));

console.log(`✅ Built ${n} editions + ${legalCount} legal pages for ${today}`);
