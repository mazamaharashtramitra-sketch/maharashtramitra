(() => {
  'use strict';
  const body = document.body;
  const progressFill = document.getElementById('progressFill');
  const pageStatus = document.getElementById('pageStatus');
  const pages = Array.from(document.querySelectorAll('.news-page'));
  let scale = 1, ticking = false;

  const updateProgress = () => {
    const s = document.documentElement.scrollHeight - window.innerHeight;
    const p = s > 0 ? (window.scrollY / s) * 100 : 0;
    if (progressFill) progressFill.style.width = Math.min(100, Math.max(0, p)) + '%';
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(updateProgress); ticking = true; }
  }, { passive: true });
  updateProgress();

  document.getElementById('smallerText')?.addEventListener('click', () => {
    scale = Math.max(0.85, scale - 0.05);
    document.documentElement.style.setProperty('--body-scale', scale);
  });
  document.getElementById('largerText')?.addEventListener('click', () => {
    scale = Math.min(1.2, scale + 0.05);
    document.documentElement.style.setProperty('--body-scale', scale);
  });
  document.getElementById('themeToggle')?.addEventListener('click', () => body.classList.toggle('night'));
  document.getElementById('printButton')?.addEventListener('click', () => window.print());

  if ('IntersectionObserver' in window && pageStatus) {
    const obs = new IntersectionObserver((entries) => {
      const v = entries.filter(e => e.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!v) return;
      const i = pages.indexOf(v.target) + 1;
      if (i > 0) pageStatus.textContent = `पृष्ठ ${String(i).replace(/\d/g,d=>'०१२३४५६७८९'[+d])} / १०`;
    }, { threshold: [0.2, 0.4, 0.6, 0.8] });
    pages.forEach(p => obs.observe(p));
  }
})();
