#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ═══════════════════════════════════════════════════════
   LOAD CONFIG
   ═══════════════════════════════════════════════════════ */
const readJSON = (p, fallback = null) => {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return fallback;
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { console.warn(`⚠ Invalid JSON: ${p}`); return fallback; }
};

const config = readJSON('data/config.json', {});
const citiesData = readJSON('data/cities.json', {});
const adsData = (readJSON('data/ads.json', { ads: {} }) || {}).ads || {};
const SLOT_LABELS = config.slotLabels || {};

const OUT = path.join(ROOT, 'public');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const toMr = n => String(n).replace(/\d/g, d => '०१२३४५६७८९'[+d]);

function getWeekStart(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const diff = date.getDate() - date.getDay();
  const sunday = new Date(date);
  sunday.setDate(diff);
  return sunday;
}
function getWeekEnd(d) {
  const s = getWeekStart(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
}
function toIsoDate(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

const MONTHS_MR = ['जानेवारी','फेब्रुवारी','मार्च','एप्रिल','मे','जून','जुलै','ऑगस्ट','सप्टेंबर','ऑक्टोबर','नोव्हेंबर','डिसेंबर'];
const toMrDate = iso => {
  const [y,m,d] = iso.split('-');
  return y && m && d ? `${toMr(+d)} ${MONTHS_MR[+m-1]} ${toMr(y)}` : iso;
};
const toMrWeekRange = (s, e) => {
  const [sy,sm,sd] = s.split('-');
  const [ey,em,ed] = e.split('-');
  if (!sy || !sm || !sd || !ey || !em || !ed) return s;
  if (sm === em) return `${toMr(+sd)} ते ${toMr(+ed)} ${MONTHS_MR[+sm-1]} ${toMr(sy)}`;
  return `${toMr(+sd)} ${MONTHS_MR[+sm-1]} ते ${toMr(+ed)} ${MONTHS_MR[+em-1]} ${toMr(sy)}`;
};

const now = new Date();
const WEEK_START_ISO = toIsoDate(getWeekStart(now));
const WEEK_END_ISO = toIsoDate(getWeekEnd(now));
const WEEK_RANGE_MR = toMrWeekRange(WEEK_START_ISO, WEEK_END_ISO);
const TODAY_ISO = toIsoDate(now);
const WORDS_PER_PAGE = (config.newsletter && config.newsletter.wordsPerPage) || 450;

/* ═══════════════════════════════════════════════════════
   LOAD ARTICLES
   ═══════════════════════════════════════════════════════ */
function loadFromDir(dir, kind) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  function walk(d) {
    for (const item of fs.readdirSync(d)) {
      if (item.startsWith('_') || item.startsWith('.')) continue;
      const fp = path.join(d, item);
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) walk(fp);
      else if (item.endsWith('.json')) {
        try {
          const a = JSON.parse(fs.readFileSync(fp, 'utf8'));
          if (!a.city) a.city = 'all';
          a._kind = kind;
          out.push(a);
        } catch (e) {
          console.warn(`⚠ Invalid: ${fp}`);
        }
      }
    }
  }
  walk(full);
  return out;
}

const ALL_ARTICLES = loadFromDir('data/articles', 'regular');
const ALL_SPECIALS = loadFromDir('data/special', 'special');
console.log(`📚 Loaded ${ALL_ARTICLES.length} regular + ${ALL_SPECIALS.length} special articles`);

/* ═══════════════════════════════════════════════════════
   SEEDED PICK
   ═══════════════════════════════════════════════════════ */
function seededPick(arr, seed, count = 1) {
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

/* ═══════════════════════════════════════════════════════
   PICK ARTICLE FOR SLOT
   Priority:
     1. Special article matching slot + city + week
     2. Regular article from pool (city-matched, unused)
   ═══════════════════════════════════════════════════════ */
function pickArticleForSlot(slot, citySlug, weekStart, weekEnd, usedSlugs) {
  // 1. Special
  const special = ALL_SPECIALS.find(s => {
    if (String(s.slot) !== String(slot)) return false;
    if (s.city !== 'all' && s.city !== citySlug) return false;
    if (!s.dateRange || !s.dateRange.from || !s.dateRange.to) return false;
    if (s.dateRange.from > weekEnd) return false;
    if (s.dateRange.to < weekStart) return false;
    if (usedSlugs.has(s.slug)) return false;
    return true;
  });
  if (special) return special;

  // 2. Regular
  const pool = ALL_ARTICLES.filter(a => {
    if (a.city !== 'all' && a.city !== citySlug) return false;
    if (usedSlugs.has(a.slug)) return false;
    return true;
  });
  if (!pool.length) return null;

  const [picked] = seededPick(pool, weekStart + '-' + slot + '-' + citySlug, 1);
  return picked;
}

/* ═══════════════════════════════════════════════════════
   SPLIT ARTICLE
   ═══════════════════════════════════════════════════════ */
function splitArticle(body) {
  const paras = String(body || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return ['या आठवड्यातील लेख लवकरच येत आहे.'];
  const pages = [];
  let current = [], count = 0;
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (count + w > WORDS_PER_PAGE && current.length > 0) {
      pages.push(current.join('\n\n'));
      current = [p]; count = w;
    } else {
      current.push(p); count += w;
    }
  }
  if (current.length) pages.push(current.join('\n\n'));
  return pages.length ? pages : [body];
}

/* ═══════════════════════════════════════════════════════
   FOOTER COLUMNS
   ═══════════════════════════════════════════════════════ */
function footerColumns() {
  return (config.footer.columns || []).map(c => `
    <div class="footer-col"><h4>${esc(c.title)}</h4>
      ${c.links.map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════
   AD RENDERING
   ═══════════════════════════════════════════════════════ */
function renderAdImage(ad) {
  if (!ad) return '';
  if (ad.startDate && ad.startDate > TODAY_ISO) return '';
  if (ad.endDate && ad.endDate < TODAY_ISO) return '';

  return `<a href="${esc(ad.link)}" rel="nofollow sponsored" target="_blank" style="display:block;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fffefa;text-decoration:none;position:relative">
    <img src="${esc(ad.image)}" alt="${esc(ad.sponsor || 'Advertisement')}" loading="lazy" style="display:block;width:100%;height:auto">
    <span style="position:absolute;top:8px;left:10px;padding:3px 8px;background:rgba(23,43,42,.78);color:#fff;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;border-radius:99px">प्रायोजित · ${esc(ad.sponsor || 'Ad')}</span>
  </a>`;
}

function renderPageAds(cityCode, pageNum) {
  const key = `${cityCode}-P${pageNum}`;
  const fp  = adsData[`${key}-FP`];
  const hp1 = adsData[`${key}-HP1`];
  const hp2 = adsData[`${key}-HP2`];
  const hp3 = adsData[`${key}-HP3`];

  const bs = [];
  for (let i = 1; i <= 9; i++) {
    const b = adsData[`${key}-B${i}`];
    if (b) bs.push(b);
  }

  const activeFP = fp ? renderAdImage(fp) : '';
  const activeHPs = [hp1, hp2, hp3].filter(Boolean).map(renderAdImage).filter(Boolean)
    .map(h => `<div style="margin:20px 0">${h}</div>`).join('');
  const activeBs = bs.map(renderAdImage).filter(Boolean);

  if (!activeFP && !activeHPs && !activeBs.length) return '';

  let html = '';
  if (activeFP) html += `<div style="margin:24px 0">${activeFP}</div>`;
  if (activeHPs) html += activeHPs;
  if (activeBs.length) {
    const cols = activeBs.length === 1 ? '1fr'
               : activeBs.length === 2 ? '1fr 1fr'
               : activeBs.length === 3 ? 'repeat(3,1fr)'
               : activeBs.length === 4 ? 'repeat(4,1fr)'
               : activeBs.length === 5 ? 'repeat(5,1fr)'
               : 'repeat(3,1fr)';
    html += `<div style="display:grid;grid-template-columns:${cols};gap:12px;margin:28px 0">${activeBs.join('')}</div>`;
  }
  return html;
}

/* ═══════════════════════════════════════════════════════
   RENDER COVER (dynamic HTML/CSS)
   ═══════════════════════════════════════════════════════ */
function renderCover(city, totalPages) {
  const c = config.cover || {};
  const highlights = (c.highlights || []).map(h => `<span class="cv-pill">${esc(h)}</span>`).join('');
  const accent = city.accent || '#e5a33b';
  const accentSoft = city.accentSoft || '#f5c66b';
  const skyTop = city.skyTop || '#1a1410';
  const skyMid = city.skyMid || '#2a1d18';
  const skyLow = city.skyLow || '#3d2818';
  const cityName = city.city || 'महाराष्ट्र';
  const region = city.region || 'महाराष्ट्र, भारत';
  const tagline = city.tagline || config.site.tagline;

  return `<article class="news-page cover-page" id="page-1" aria-label="पृष्ठ १ — मुखपृष्ठ"
    style="--cv-accent:${esc(accent)};--cv-accent-soft:${esc(accentSoft)};--cv-sky-top:${esc(skyTop)};--cv-sky-mid:${esc(skyMid)};--cv-sky-low:${esc(skyLow)}">
    <div class="cv-bg" aria-hidden="true">
      <div class="cv-sky"></div><div class="cv-aurora"></div><div class="cv-rays"></div>
      <div class="cv-stars"></div>
      <div class="cv-hills cv-hills-far"></div><div class="cv-hills cv-hills-mid"></div><div class="cv-hills cv-hills-near"></div>
      <div class="cv-sun"></div><div class="cv-trees"></div><div class="cv-fireflies"></div><div class="cv-vignette"></div>
    </div>
    <div class="cv-corners" aria-hidden="true">
      <span class="cv-corner cv-corner-tl"></span><span class="cv-corner cv-corner-tr"></span>
      <span class="cv-corner cv-corner-bl"></span><span class="cv-corner cv-corner-br"></span>
    </div>
    <div class="cv-content">
      <header class="cv-masthead">
        <div class="cv-emblem"><span class="cv-emblem-letter">म</span><span class="cv-emblem-ring"></span></div>
        <div class="cv-brand">
          <div class="cv-name">${esc(city.name)}</div>
          <div class="cv-tagline">${esc(tagline)}</div>
        </div>
      </header>
      <div class="cv-badge"><span class="cv-badge-dot"></span><span>${esc(c.label || 'आजचा विशेष अंक')}</span></div>
      <div class="cv-hero">
        <div class="cv-hero-kicker">साप्ताहिक अंक</div>
        <h1 class="cv-title"><span class="cv-title-line">${esc(city.name)}</span></h1>
        <p class="cv-subtitle">${esc(tagline)}</p>
        <div class="cv-underline"><span></span><i>◆</i><span></span></div>
      </div>
      <div class="cv-meta">
        <div class="cv-meta-item"><span class="cv-meta-label">आठवडा</span><strong class="cv-meta-value">${esc(WEEK_RANGE_MR)}</strong></div>
        <div class="cv-meta-divider"></div>
        <div class="cv-meta-item"><span class="cv-meta-label">स्थान</span><strong class="cv-meta-value">${esc(cityName)}</strong><span class="cv-meta-sub">${esc(region)}</span></div>
        <div class="cv-meta-divider"></div>
        <div class="cv-meta-item"><span class="cv-meta-label">एकूण पृष्ठे</span><strong class="cv-meta-value">${toMr(totalPages)}</strong></div>
      </div>
      <div class="cv-highlights">${highlights}</div>
      <footer class="cv-footer">
        <span class="cv-footer-line"></span>
        <span class="cv-footer-text">मराठी वाचूया. मराठीत जोडलेले राहूया.</span>
        <span class="cv-footer-line"></span>
      </footer>
    </div>
  </article>`;
}

/* ═══════════════════════════════════════════════════════
   RENDER EDITION INFO
   ═══════════════════════════════════════════════════════ */
function renderEditionInfo(city, totalPages, articles) {
  const c = config.cover || {};
  const tags = (c.highlights || []).map(h => `<span>${esc(h)}</span>`).join('');
  const previewList = articles.slice(0, 6).map((a, i) => `
    <li>
      <span class="ed-num">${toMr(i + 1).padStart(2, '०')}</span>
      <span class="ed-title">${esc(a.title)}</span>
      <span class="ed-cat">${esc(a.label)}</span>
    </li>`).join('');
  const tagline = city.tagline || config.site.tagline;

  return `<article class="news-page edition-info-page" id="page-2" aria-label="पृष्ठ २ — अंक परिचय">
  <header class="ed-masthead">
    <div class="ed-logo"><div class="ed-emblem">म</div>
      <div><div class="ed-name">${esc(city.name)}</div><div class="ed-kicker">${esc(tagline)}</div></div>
    </div>
    <div class="ed-issue-stamp">साप्ताहिक अंक<strong>${esc(WEEK_RANGE_MR)}</strong></div>
  </header>
  <div class="ed-hero">
    <span class="ed-label">${esc(c.label || 'आजचा विशेष अंक')}</span>
    <h1 class="ed-title-main">या आठवड्याचं वाचन,<br><span>मनापासून.</span></h1>
    <p class="ed-desc">${esc(tagline)}</p>
    <div class="ed-tags">${tags}</div>
  </div>
  <div class="ed-meta">
    <div class="meta-block"><span class="meta-label">स्थान</span><strong>${esc(city.city || 'महाराष्ट्र')}</strong><small>${esc(city.region || 'महाराष्ट्र, भारत')}</small></div>
    <div class="meta-block"><span class="meta-label">आठवडा</span><strong>${esc(WEEK_RANGE_MR)}</strong><small>साप्ताहिक अंक</small></div>
    <div class="meta-block"><span class="meta-label">एकूण पृष्ठे</span><strong>${toMr(totalPages)}</strong><small>वाचनासाठी सज्ज</small></div>
  </div>
  <div class="ed-preview">
    <div class="ed-rule">या आठवड्याच्या अंकात</div>
    <ol class="ed-list">${previewList}</ol>
  </div>
  <div class="ed-note">
    <span class="ed-note-label">संपादकाचं मनोगत</span>
    <p>प्रिय वाचकहो, हा साप्ताहिक अंक तुमच्या आठवड्यातला छोटा विराम घेऊन आला आहे. प्रत्येक पानावर एक नवा विषय, एक नवा दृष्टिकोन आणि थोडं थांबून विचार करण्याची संधी. वाचत राहा, जोडलेले राहा.</p>
  </div>
  <footer class="page-footer"><strong>${esc(city.name)}</strong><span class="folio">०२ / ${toMr(totalPages)}</span></footer>
</article>`;
}

/* ═══════════════════════════════════════════════════════
   RENDER CONTENTS
   ═══════════════════════════════════════════════════════ */
function renderContents(articles, totalPages) {
  const list = articles.map(a => `
    <li><a href="#page-${a.startPage}">
      <span class="contents-number">${toMr(a.startPage).padStart(2, '०')}</span>
      <span class="contents-name">${esc(a.title)}<span class="contents-hint">${esc(a.label)}${a.totalParts > 1 ? ` · ${toMr(a.totalParts)} पृष्ठे` : ''}</span></span>
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
   RENDER ARTICLE
   ═══════════════════════════════════════════════════════ */
function renderArticle(a, n, part, totalParts, totalPages, cityCode) {
  const isFirst = part === 1;
  const adBlock = renderPageAds(cityCode, n);

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
    <span>${esc(a.label)}${!isFirst ? ' · क्रमशः' : ''}</span>
    <span>पृष्ठ ${toMr(n).padStart(2, '०')}</span>
  </div>
  <div class="eyebrow">${esc(a.label)}</div>
  ${isFirst
    ? `<h2 class="page-title">${esc(a.title)}</h2>
       ${a.image ? `<div class="lead-photo"><img src="${esc(a.image)}" alt="${esc(a.title)}" loading="lazy"></div>` : ''}
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
   RENDER BACK COVER
   ═══════════════════════════════════════════════════════ */
function renderBack(city, totalPages) {
  const tagline = city.tagline || config.site.tagline;
  return `<article class="news-page closing-page" id="page-${totalPages}">
  <div class="page-topline"><span>समारोप</span><span>पुढील आठवड्याकडे</span></div>
  <div class="eyebrow">धन्यवाद</div>
  <h2 class="page-title">वाचत राहा,<br><span style="color:#f3c66e">जोडलेले राहा.</span></h2>
  <p class="page-subtitle">${esc(city.name)} — ${esc(tagline)}</p>
  <div class="closing-signature"><div class="big-mark">म</div><p>मराठी वाचूया. मराठीत जोडलेले राहूया.</p></div>
  <footer class="page-footer"><strong>${esc(city.name)} · ${esc(WEEK_RANGE_MR)}</strong><span class="folio">${toMr(totalPages)} / ${toMr(totalPages)}</span></footer>
</article>`;
}

/* ═══════════════════════════════════════════════════════
   BUILD NEWSLETTER
   ═══════════════════════════════════════════════════════ */
function buildNewsletter(citySlug, city) {
  const usedSlugs = new Set();
  const articleSlots = config.pages.filter(p => p.type === 'article');

  const articles = [];
  for (const slotDef of articleSlots) {
    const slot = slotDef.slot;
    const art = pickArticleForSlot(slot, citySlug, WEEK_START_ISO, WEEK_END_ISO, usedSlugs);

    if (!art) {
      // Placeholder for empty slot
      articles.push({
        title: 'लवकरच येत आहे',
        label: SLOT_LABELS[slot] || 'वाचन',
        body: 'या आठवड्यातील लेख लवकरच येत आहे.',
        image: '',
        quote: '',
        youtube: null,
        parts: ['या आठवड्यातील लेख लवकरच येत आहे.'],
        totalParts: 1,
        startPage: 0,
        _placeholder: true
      });
      continue;
    }

    usedSlugs.add(art.slug);
    articles.push({
      title: art.title,
      label: art.label || SLOT_LABELS[slot] || 'वाचन',
      body: art.body,
      image: art.image || '',
      quote: art.quote || '',
      youtube: art.youtube || null,
      parts: splitArticle(art.body),
      totalParts: 1,
      startPage: 0
    });
  }

  articles.forEach(a => a.totalParts = a.parts.length);

  let cursor = 4;
  articles.forEach(a => {
    a.startPage = cursor;
    cursor += a.totalParts;
  });

  const totalPages = cursor;

  const pages = [
    renderCover(city, totalPages),
    renderEditionInfo(city, totalPages, articles),
    renderContents(articles, totalPages)
  ];

  for (const a of articles) {
    for (let p = 1; p <= a.totalParts; p++) {
      const n = a.startPage + p - 1;
      pages.push(renderArticle(a, n, p, a.totalParts, totalPages, city.code));
    }
  }

  pages.push(renderBack(city, totalPages));

  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/newsletter.html'), 'utf8');

  return tpl
    .replace(/{{EDITION_NAME}}/g, esc(city.name))
    .replace(/{{TAGLINE}}/g, esc(city.tagline || config.site.tagline))
    .replace(/{{PAGE_TITLE}}/g, esc(city.name + ' · ' + config.site.tagline))
    .replace(/{{META_DESCRIPTION}}/g, esc(city.tagline || config.site.tagline))
    .replace(/{{YEAR}}/g, esc(new Date().getFullYear()))
    .replace(/{{ISSUE_DATE}}/g, esc(WEEK_RANGE_MR))
    .replace(/{{PAGES_HTML}}/g, pages.join('\n'))
    .replace(/{{FOOTER_COLUMNS}}/g, footerColumns());
}

/* ═══════════════════════════════════════════════════════
   LEGAL PAGES
   ═══════════════════════════════════════════════════════ */
function renderLegalSections(sections) {
  return (sections || []).map(s => {
    if (s.type === 'pricing') {
      const cards = (s.cards || []).map(c => `
        <div class="pricing-card${c.featured ? ' featured' : ''}">
          ${c.featured ? '<span class="pricing-badge">सर्वात लोकप्रिय</span>' : ''}
          <div class="pricing-icon">${esc(c.icon || '★')}</div>
          <h3 class="pricing-name">${esc(c.name)}</h3>
          <div class="pricing-price"><span class="price-amount">${esc(c.price)}</span>${c.period ? `<span class="price-period">${esc(c.period)}</span>` : ''}</div>
          ${c.description ? `<p class="pricing-desc">${esc(c.description)}</p>` : ''}
          <ul class="pricing-features">${(c.features || []).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
          <a href="${esc(c.ctaLink || '#contact-form')}" class="pricing-cta">${esc(c.cta || 'निवडा')}</a>
        </div>`).join('');
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
            <select name="${esc(fld.name)}" ${req}>${(fld.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
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
          <input type="hidden" name="_next" value="https://mazamitra.in/thank-you/">
          <div class="form-grid">${fields}</div>
          <button type="submit" class="form-submit">${esc(f.submitText || '📩 पाठवा')}</button>
          <p class="form-note">${esc(f.note || 'आम्ही २४ तासांत तुम्हाला उत्तर देऊ.')}</p>
        </form>
      </section>`;
    }

    if (s.type === 'html') return `<section class="legal-section">${s.html || ''}</section>`;

    return `<section class="legal-section">
      ${s.heading ? `<h2 class="legal-heading">${esc(s.heading)}</h2>` : ''}
      ${s.body ? `<p class="legal-body">${esc(s.body)}</p>` : ''}
    </section>`;
  }).join('');
}

function buildLegalPage(page) {
  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/legal.html'), 'utf8');
  const defaultCity = citiesData.maharashtra || Object.values(citiesData)[0] || {};
  const sections = renderLegalSections(page.sections);
  return tpl
    .replace(/{{EDITION_NAME}}/g, esc(defaultCity.name || 'माझा मित्र'))
    .replace(/{{TAGLINE}}/g, esc(defaultCity.tagline || config.site.tagline))
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
for (const [slug, city] of Object.entries(citiesData)) {
  const html = buildNewsletter(slug, city);
  const dir = slug === 'maharashtra' ? OUT : path.join(OUT, slug);
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
console.log(`📅 Week: ${WEEK_START_ISO} to ${WEEK_END_ISO}`);
console.log(`🏙️  Cities: ${Object.keys(citiesData).join(', ')}`);
console.log(`📚 Regular: ${ALL_ARTICLES.length} | Special: ${ALL_SPECIALS.length}`);
