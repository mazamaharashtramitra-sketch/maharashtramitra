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

/* ═══════════════════════════════════════════════════════
   WEEKLY DATE HELPERS
   ═══════════════════════════════════════════════════════ */
function getWeekStart(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = date.getDate() - day;
  const sunday = new Date(date);
  sunday.setDate(diff);
  return sunday;
}

function getWeekEnd(d) {
  const start = getWeekStart(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function toIsoDate(d) {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS_MR = ['जानेवारी','फेब्रुवारी','मार्च','एप्रिल','मे','जून','जुलै','ऑगस्ट','सप्टेंबर','ऑक्टोबर','नोव्हेंबर','डिसेंबर'];

const toMrDate = (iso) => {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${toMr(+d)} ${MONTHS_MR[+m - 1]} ${toMr(y)}`;
};

const toMrWeekRange = (startIso, endIso) => {
  const [sy, sm, sd] = startIso.split('-');
  const [ey, em, ed] = endIso.split('-');
  if (!sy || !sm || !sd || !ey || !em || !ed) return startIso;
  if (sm === em) {
    return `${toMr(+sd)} ते ${toMr(+ed)} ${MONTHS_MR[+sm - 1]} ${toMr(sy)}`;
  }
  if (sy === ey) {
    return `${toMr(+sd)} ${MONTHS_MR[+sm - 1]} ते ${toMr(+ed)} ${MONTHS_MR[+em - 1]} ${toMr(sy)}`;
  }
  return `${toMr(+sd)} ${MONTHS_MR[+sm - 1]} ${toMr(sy)} ते ${toMr(+ed)} ${MONTHS_MR[+em - 1]} ${toMr(ey)}`;
};

const now = new Date();
const weekStart = getWeekStart(now);
const weekEnd = getWeekEnd(now);
const WEEK_START_ISO = toIsoDate(weekStart);
const WEEK_END_ISO = toIsoDate(weekEnd);
const WEEK_RANGE_MR = toMrWeekRange(WEEK_START_ISO, WEEK_END_ISO);

const WORDS_PER_PAGE = (config.newsletter && config.newsletter.wordsPerPage) || 450;

/* ─── Load articles ─── */
function loadArticles(cat, editionSlug) {
  if (editionSlug) {
    const localDir = path.join(ROOT, 'data/articles', editionSlug, cat);
    if (fs.existsSync(localDir)) {
      const files = fs.readdirSync(localDir).filter(f => f.endsWith('.json'));
      if (files.length) return files.map(f => JSON.parse(fs.readFileSync(path.join(localDir, f), 'utf8')));
    }
  }
  const dir = path.join(ROOT, 'data/articles', cat);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

/* ─── Load overrides ─── */
function loadOverrides(date, editionSlug) {
  const tryLoad = (p) => {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  if (editionSlug) {
    const local = tryLoad(path.join(ROOT, 'data/overrides', editionSlug, `${date}.json`));
    if (local) return local;
  }
  return tryLoad(path.join(ROOT, 'data/overrides', `${date}.json`))
      || tryLoad(path.join(ROOT, 'data/overrides', '_global', `${date}.json`))
      || {};
}

/* ─── Pick one article ─── */
function pickArticle(category, editionSlug, date, overrides) {
  const pool = loadArticles(category, editionSlug);
  const overrideSlug = overrides[category];
  if (overrideSlug) {
    const found = pool.find(a => a.slug === overrideSlug);
    if (found) return found;
  }
  const [a] = seededPick(pool, date + category, 1);
  return a || { title: 'शीघ्र', category, body: '', image: '', quote: '' };
}

/* ─── Load ads ─── */
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
    for (const [slot, ad] of Object.entries(data.slots || {})) merged.slots[slot] = ad;
  }
  return merged;
}

/* ─── Deterministic shuffle ─── */
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

/* ─── Split long article ─── */
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

/* ─── Render ad ─── */
function renderAd(ad) {
  if (!ad) return '';
  const tier = ad.tier || 'galli';
  const accent = tier === 'premium' ? '#e5a33b' : tier === 'shahar' ? '#315e50' : '#e5a33b';

  if (ad.image) {
    return `<a href="${esc(ad.link)}" rel="nofollow sponsored" target="_blank" class="ad-card ad-image">
      <img src="${esc(ad.image)}" alt="${esc(ad.sponsor || ad.title)}" loading="lazy">
      <span class="ad-badge">प्रायोजित · ${esc(ad.sponsor)}</span>
    </a>`;
  }

  return `<a href="${esc(ad.link)}" rel="nofollow sponsored" target="_blank" class="ad-card ad-text" style="border-left-color:${accent}">
    <span class="ad-label">प्रायोजित · ${esc(ad.sponsor)}</span>
    <span class="ad-icon">${esc(ad.icon || '★')}</span>
    <strong class="ad-title">${esc(ad.title)}</strong>
    <span class="ad-desc">${esc(ad.description)}</span>
    <span class="ad-cta">${esc(ad.cta)} →</span>
  </a>`;
}

function renderAdBlock(ads, pageKey) {
  const slots = (config.ads && config.ads.slots && config.ads.slots[pageKey])
             || (pageKey.startsWith('page') ? ['galli'] : []);
  if (!slots.length) return '';
  const items = slots.map(k => ads.slots && ads.slots[k]).filter(Boolean);
  if (!items.length) return '';
  const cols = items.length === 1 ? '1fr' : items.length === 2 ? '1fr 1fr' : 'repeat(3,1fr)';
  return `<div class="ad-grid" style="grid-template-columns:${cols}">
    ${items.map(renderAd).join('')}
  </div>`;
}
/* ═══════════════════════════════════════════════════════
   PAGE 1 — DYNAMIC HTML/CSS COVER (nature-inspired, no image)
   ═══════════════════════════════════════════════════════ */
function renderCover(edition, totalPages) {
  const c = config.cover;
  const highlights = (c.highlights || [])
    .map(h => `<span class="cv-pill">${esc(h)}</span>`)
    .join('');

  const accent = edition.accent || '#e5a33b';
  const accentSoft = edition.accentSoft || '#f5c66b';
  const skyTop = edition.skyTop || '#1a1410';
  const skyMid = edition.skyMid || '#2a1d18';
  const skyLow = edition.skyLow || '#3d2818';
  const city = edition.city || 'महाराष्ट्र';
  const region = edition.region || 'महाराष्ट्र, भारत';

  return `<article class="news-page cover-page" id="page-1" aria-label="पृष्ठ १ — मुखपृष्ठ"
    style="--cv-accent:${esc(accent)};--cv-accent-soft:${esc(accentSoft)};--cv-sky-top:${esc(skyTop)};--cv-sky-mid:${esc(skyMid)};--cv-sky-low:${esc(skyLow)}">

    <div class="cv-bg" aria-hidden="true">
      <div class="cv-sky"></div>
      <div class="cv-aurora"></div>
      <div class="cv-rays"></div>
      <div class="cv-stars"></div>
      <div class="cv-hills cv-hills-far"></div>
      <div class="cv-hills cv-hills-mid"></div>
      <div class="cv-hills cv-hills-near"></div>
      <div class="cv-sun"></div>
      <div class="cv-trees"></div>
      <div class="cv-fireflies"></div>
      <div class="cv-vignette"></div>
    </div>

    <div class="cv-corners" aria-hidden="true">
      <span class="cv-corner cv-corner-tl"></span>
      <span class="cv-corner cv-corner-tr"></span>
      <span class="cv-corner cv-corner-bl"></span>
      <span class="cv-corner cv-corner-br"></span>
    </div>

    <div class="cv-content">

      <header class="cv-masthead">
        <div class="cv-emblem">
          <span class="cv-emblem-letter">म</span>
          <span class="cv-emblem-ring"></span>
        </div>
        <div class="cv-brand">
          <div class="cv-name">${esc(edition.name)}</div>
          <div class="cv-tagline">${esc(edition.tagline || config.site.tagline)}</div>
        </div>
      </header>

      <div class="cv-badge">
        <span class="cv-badge-dot"></span>
        <span>${esc(c.label)}</span>
      </div>

      <div class="cv-hero">
        <div class="cv-hero-kicker">साप्ताहिक अंक</div>
        <h1 class="cv-title">
          <span class="cv-title-line">${esc(edition.name)}</span>
        </h1>
        <p class="cv-subtitle">${esc(edition.tagline || config.site.tagline)}</p>
        <div class="cv-underline">
          <span></span><i>◆</i><span></span>
        </div>
      </div>

      <div class="cv-meta">
        <div class="cv-meta-item">
          <span class="cv-meta-label">आठवडा</span>
          <strong class="cv-meta-value">${esc(WEEK_RANGE_MR)}</strong>
        </div>
        <div class="cv-meta-divider"></div>
        <div class="cv-meta-item">
          <span class="cv-meta-label">स्थान</span>
          <strong class="cv-meta-value">${esc(city)}</strong>
          <span class="cv-meta-sub">${esc(region)}</span>
        </div>
        <div class="cv-meta-divider"></div>
        <div class="cv-meta-item">
          <span class="cv-meta-label">एकूण पृष्ठे</span>
          <strong class="cv-meta-value">${toMr(totalPages)}</strong>
        </div>
      </div>

      <div class="cv-highlights">
        ${highlights}
      </div>

      <footer class="cv-footer">
        <span class="cv-footer-line"></span>
        <span class="cv-footer-text">मराठी वाचूया. मराठीत जोडलेले राहूया.</span>
        <span class="cv-footer-line"></span>
      </footer>

    </div>

  </article>`;
}
/* ═══════════════════════════════════════════════════════
   PAGE 2 — EDITION INFO
   ═══════════════════════════════════════════════════════ */
function renderEditionInfo(edition, totalPages, articles) {
  const c = config.cover;
  const tags = (c.highlights || []).map(h => `<span>${esc(h)}</span>`).join('');
  const previewList = articles.slice(0, 6).map((a, i) => `
    <li>
      <span class="ed-num">${toMr(i + 1).padStart(2, '०')}</span>
      <span class="ed-title">${esc(a.title)}</span>
      <span class="ed-cat">${esc(a.category)}</span>
    </li>`).join('');

  return `<article class="news-page edition-info-page" id="page-2" aria-label="पृष्ठ २ — अंक परिचय">
  <header class="ed-masthead">
    <div class="ed-logo">
      <div class="ed-emblem">म</div>
      <div>
        <div class="ed-name">${esc(edition.name)}</div>
        <div class="ed-kicker">${esc(edition.tagline || config.site.tagline)}</div>
      </div>
    </div>
    <div class="ed-issue-stamp">साप्ताहिक अंक<strong>${esc(WEEK_RANGE_MR)}</strong></div>
  </header>

  <div class="ed-hero">
    <span class="ed-label">${esc(c.label)}</span>
    <h1 class="ed-title-main">या आठवड्याचं वाचन,<br><span>मनापासून.</span></h1>
    <p class="ed-desc">${esc(edition.tagline || config.site.tagline)}</p>
    <div class="ed-tags">${tags}</div>
  </div>

  <div class="ed-meta">
    <div class="meta-block">
      <span class="meta-label">स्थान</span>
      <strong>${esc(edition.city || 'महाराष्ट्र')}</strong>
      <small>${esc(edition.region || 'महाराष्ट्र, भारत')}</small>
    </div>
    <div class="meta-block">
      <span class="meta-label">आठवडा</span>
      <strong>${esc(WEEK_RANGE_MR)}</strong>
      <small>साप्ताहिक अंक</small>
    </div>
    <div class="meta-block">
      <span class="meta-label">एकूण पृष्ठे</span>
      <strong>${toMr(totalPages)}</strong>
      <small>वाचनासाठी सज्ज</small>
    </div>
  </div>

  <div class="ed-preview">
    <div class="ed-rule">या आठवड्याच्या अंकात</div>
    <ol class="ed-list">${previewList}</ol>
  </div>

  <div class="ed-note">
    <span class="ed-note-label">संपादकाचं मनोगत</span>
    <p>प्रिय वाचकहो, हा साप्ताहिक अंक तुमच्या आठवड्यातला छोटा विराम घेऊन आला आहे. प्रत्येक पानावर एक नवा विषय, एक नवा दृष्टिकोन आणि थोडं थांबून विचार करण्याची संधी. वाचत राहा, जोडलेले राहा.</p>
  </div>

  <footer class="page-footer"><strong>${esc(edition.name)}</strong><span class="folio">०२ / ${toMr(totalPages)}</span></footer>
</article>`;
}

/* ═══════════════════════════════════════════════════════
   PAGE 3 — CONTENTS
   ═══════════════════════════════════════════════════════ */
function renderContents(articles, totalPages) {
  const list = articles.map(a => `
    <li><a href="#page-${a.startPage}">
      <span class="contents-number">${toMr(a.startPage).padStart(2, '०')}</span>
      <span class="contents-name">${esc(a.title)}<span class="contents-hint">${esc(a.category)}${a.totalParts > 1 ? ` · ${toMr(a.totalParts)} पृष्ठे` : ''}</span></span>
      <span class="contents-page-no">${toMr(a.startPage).padStart(2, '०')}</span>
    </a></li>`).join('');

  return `<article class="news-page" id="page-3" aria-label="पृष्ठ ३ — अनुक्रमणिका">
  <div class="page-topline"><span>${esc(config.site.name)}</span><span>अनुक्रमणिका</span></div>
  <div class="eyebrow">या आठवड्यात काय आहे?</div>
  <h2 class="page-title">विचारांची एक सुंदर<br><span class="accent">वाचनयात्रा.</span></h2>
  <p class="page-subtitle">${esc(config.site.tagline)}</p>
  <ol class="contents-list">${list}</ol>
  <footer class="page-footer"><strong>${esc(WEEK_RANGE_MR)}</strong><span class="folio">०३ / ${toMr(totalPages)}</span></footer>
</article>`;
}

/* ═══════════════════════════════════════════════════════
   ARTICLE PAGES
   ═══════════════════════════════════════════════════════ */
function renderArticle(a, n, part, totalParts, totalPages, ads) {
  const isFirst = part === 1;
  const adBlock = renderAdBlock(ads, `page${n}`);

  let videoBlock = '';
  if (isFirst && a.youtube && a.youtube.id) {
    const start = a.youtube.start ? `?start=${a.youtube.start}` : '';
    videoBlock = `<div class="video-wrap">
        <iframe src="https://www.youtube.com/embed/${esc(a.youtube.id)}${start}"
          title="${esc(a.youtube.title || a.title)}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
      </div>`;
  }

  return `<article class="news-page" id="page-${n}">
  <div class="page-topline">
    <span>${esc(a.category)}${!isFirst ? ' · क्रमशः' : ''}</span>
    <span>पृष्ठ ${toMr(n).padStart(2, '०')}</span>
  </div>
  <div class="eyebrow">${esc(a.category)}</div>
  ${isFirst
    ? `<h2 class="page-title">${esc(a.title)}</h2>
       <div class="lead-photo"><img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy"></div>
       ${videoBlock}
       <div class="page-copy" style="margin-top:20px"><p class="dropcap">${esc(a.parts[part-1])}</p></div>`
    : `<h2 class="page-title" style="font-size:26px">${esc(a.title)}<span style="font-size:14px;color:#747b72;font-weight:400"> · भाग ${toMr(part)} / ${toMr(totalParts)}</span></h2>
       <div class="page-copy" style="margin-top:20px"><p>${esc(a.parts[part-1])}</p></div>`}
  ${isFirst && a.quote && totalParts === 1 ? `<blockquote class="pull-quote">“${esc(a.quote)}”</blockquote>` : ''}
  ${adBlock}
  <footer class="page-footer"><strong>${esc(config.site.name)}</strong><span class="folio">${toMr(n).padStart(2, '०')} / ${toMr(totalPages)}</span></footer>
</article>`;
}

/* ═══════════════════════════════════════════════════════
   BACK COVER
   ═══════════════════════════════════════════════════════ */
function renderBack(edition, totalPages) {
  return `<article class="news-page closing-page" id="page-${totalPages}">
  <div class="page-topline"><span>समारोप</span><span>पुढील आठवड्याकडे</span></div>
  <div class="eyebrow">धन्यवाद</div>
  <h2 class="page-title">वाचत राहा,<br><span style="color:#f3c66e">जोडलेले राहा.</span></h2>
  <p class="page-subtitle">${esc(edition.name)} — ${esc(config.site.tagline)}</p>
  <div class="closing-signature"><div class="big-mark">म</div><p>मराठी वाचूया. मराठीत जोडलेले राहूया.</p></div>
  <footer class="page-footer"><strong>${esc(edition.name)} · ${esc(WEEK_RANGE_MR)}</strong><span class="folio">${toMr(totalPages)} / ${toMr(totalPages)}</span></footer>
</article>`;
}

/* ═══════════════════════════════════════════════════════
   NEWSLETTER BUILDER
   ═══════════════════════════════════════════════════════ */
function buildNewsletter(edition) {
  const ads = loadAds(edition);
  const overrides = loadOverrides(WEEK_START_ISO, edition.slug);
  const articlePages = config.pages.filter(p => p.type === 'article');

  const articles = articlePages.map(p => {
    const art = pickArticle(p.category, edition.slug, WEEK_START_ISO, overrides);
    return {
      title: art.title,
      category: art.category,
      body: art.body,
      image: art.image,
      quote: art.quote,
      youtube: art.youtube || null,
      parts: splitArticle(art.body),
      totalParts: 1,
      startPage: 0
    };
  });

  articles.forEach(a => a.totalParts = a.parts.length);

  let cursor = 4;
  articles.forEach(a => {
    a.startPage = cursor;
    cursor += a.totalParts;
  });

  const totalPages = cursor;

  const pages = [
    renderCover(edition, totalPages),
    renderEditionInfo(edition, totalPages, articles),
    renderContents(articles, totalPages)
  ];

  for (const a of articles) {
    for (let p = 1; p <= a.totalParts; p++) {
      const n = a.startPage + p - 1;
      pages.push(renderArticle(a, n, p, a.totalParts, totalPages, ads));
    }
  }

  pages.push(renderBack(edition, totalPages));

  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/newsletter.html'), 'utf8');

  return tpl
    .replace(/{{EDITION_NAME}}/g, esc(edition.name))
    .replace(/{{TAGLINE}}/g, esc(edition.tagline))
    .replace(/{{PAGE_TITLE}}/g, esc(edition.name + ' · ' + config.site.tagline))
    .replace(/{{META_DESCRIPTION}}/g, esc(edition.tagline))
    .replace(/{{YEAR}}/g, esc(new Date().getFullYear()))
    .replace(/{{ISSUE_DATE}}/g, esc(WEEK_RANGE_MR))
    .replace(/{{PAGES_HTML}}/g, pages.join('\n'))
    .replace(/{{FOOTER_COLUMNS}}/g, footerColumns());
}

/* ═══════════════════════════════════════════════════════
   LEGAL PAGE SECTIONS
   ═══════════════════════════════════════════════════════ */
function renderLegalSections(sections) {
  return (sections || []).map(s => {
    if (s.type === 'pricing') {
      const cards = (s.cards || []).map(c => `
        <div class="pricing-card${c.featured ? ' featured' : ''}">
          ${c.featured ? '<span class="pricing-badge">सर्वात लोकप्रिय</span>' : ''}
          <div class="pricing-icon">${esc(c.icon || '★')}</div>
          <h3 class="pricing-name">${esc(c.name)}</h3>
          <div class="pricing-price">
            <span class="price-amount">${esc(c.price)}</span>
            ${c.period ? `<span class="price-period">${esc(c.period)}</span>` : ''}
          </div>
          ${c.description ? `<p class="pricing-desc">${esc(c.description)}</p>` : ''}
          <ul class="pricing-features">
            ${(c.features || []).map(f => `<li>${esc(f)}</li>`).join('')}
          </ul>
          <a href="${esc(c.ctaLink || '#contact-form')}" class="pricing-cta">${esc(c.cta || 'निवडा')}</a>
        </div>
      `).join('');
      const cols = Math.min((s.cards || []).length, 4);
      return `<section class="legal-section legal-section-pricing">
        ${s.heading ? `<h2 class="legal-heading">${esc(s.heading)}</h2>` : ''}
        ${s.body ? `<p class="legal-body">${esc(s.body)}</p>` : ''}
        <div class="pricing-grid cols-${cols}">${cards}</div>
      </section>`;
    }

    if (s.type === 'form') {
      const f = s.form || {};
      const fields = (f.fields || []).map(fld => {
        const req = fld.required ? 'required' : '';
        const ph = fld.placeholder ? `placeholder="${esc(fld.placeholder)}"` : '';
        if (fld.type === 'textarea') {
          return `<label class="form-field form-field-full">
            <span class="form-label">${esc(fld.label)}${fld.required ? ' *' : ''}</span>
            <textarea name="${esc(fld.name)}" rows="5" ${req} ${ph}></textarea>
          </label>`;
        }
        if (fld.type === 'select') {
          return `<label class="form-field">
            <span class="form-label">${esc(fld.label)}${fld.required ? ' *' : ''}</span>
            <select name="${esc(fld.name)}" ${req}>
              ${(fld.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
            </select>
          </label>`;
        }
        return `<label class="form-field">
          <span class="form-label">${esc(fld.label)}${fld.required ? ' *' : ''}</span>
          <input type="${esc(fld.type || 'text')}" name="${esc(fld.name)}" ${req} ${ph}>
        </label>`;
      }).join('');

      return `<section class="legal-section legal-section-form" id="contact-form">
        ${s.heading ? `<h2 class="legal-heading">${esc(s.heading)}</h2>` : ''}
        ${s.body ? `<p class="legal-body">${esc(s.body)}</p>` : ''}
        <form action="${esc(f.action || 'https://formsubmit.co/mazamaharashtramitra@gmail.com')}" method="POST" class="lead-form">
          <input type="hidden" name="_subject" value="${esc(f.subject || 'New Enquiry — माझा मित्र')}">
          <input type="hidden" name="_captcha" value="false">
          <input type="hidden" name="_template" value="table">
          <input type="hidden" name="_next" value="https://maharashtramitra.pages.dev/thank-you/">
          <div class="form-grid">${fields}</div>
          <button type="submit" class="form-submit">${esc(f.submitText || '📩 पाठवा')}</button>
          <p class="form-note">${esc(f.note || 'आम्ही २४ तासांत तुम्हाला उत्तर देऊ.')}</p>
        </form>
      </section>`;
    }

    if (s.type === 'html') {
      return `<section class="legal-section">${s.html || ''}</section>`;
    }

    return `<section class="legal-section">
      ${s.heading ? `<h2 class="legal-heading">${esc(s.heading)}</h2>` : ''}
      ${s.body ? `<p class="legal-body">${esc(s.body)}</p>` : ''}
    </section>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   LEGAL PAGE
   ═══════════════════════════════════════════════════════ */
function buildLegalPage(page) {
  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/legal.html'), 'utf8');
  const defaultEdition = editions.find(e => e.slug === 'maharashtra') || editions[0];
  const sections = renderLegalSections(page.sections);
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

/* ═══════════════════════════════════════════════════════
   MAIN BUILD
   ═══════════════════════════════════════════════════════ */
let n = 0;
for (const ed of editions) {
  const html = buildNewsletter(ed);
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

console.log(`✅ Built ${n} editions + ${legalCount} legal pages — Week: ${WEEK_RANGE_MR}`);
