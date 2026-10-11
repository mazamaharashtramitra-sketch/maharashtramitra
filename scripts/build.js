function renderParagraphs(text, dropcap = false) {
  const paras = String(text || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (!paras.length) return '<p>—</p>';
  return paras.map((p, i) => {
    // 1. Remove pure divider lines (━, ─, ◆)
    if (/^[━─◆]+$/.test(p)) return '';

    // 2. ⭐ NEW: Diamond Heading (◆ Text)
    const diamondMatch = p.match(/^◆\s*(.+)$/);
    if (diamondMatch) {
      return `<h3 class="section-head">${esc(diamondMatch[1])}</h3>`;
    }

    // 3. Heading: ━━━ Text ━━━
    const headingMatch = p.match(/^[━─]+\s*(.+?)\s*[━─]+$/);
    if (headingMatch) {
      return `<h3 class="section-head">${esc(headingMatch[1])}</h3>`;
    }

    // 4. Partial heading: leading dashes + text
    const partialHeading = p.match(/^[━─]+\s*(.+)$/);
    if (partialHeading && partialHeading[1].length < 80) {
      return `<h3 class="section-head">${esc(partialHeading[1])}</h3>`;
    }

    // 5. Greeting paragraph (emoji)
    const isGreeting = (i === 0) && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(p);
    if (isGreeting) {
      return `<p class="greeting-line">${esc(p)}</p>`;
    }

    // 6. Regular paragraph
    const cls = (i === 0 && dropcap && !/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(p)) ? ' class="dropcap"' : '';
    return `<p${cls}>${esc(p)}</p>`;
  }).filter(Boolean).join('');
}
