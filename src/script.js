(() => {
  'use strict';

  /* ═══════════════════════════════════════════════════════
     REMEMBER LAST EDITION — localStorage
     ═══════════════════════════════════════════════════════ */
  (function () {
    const LEGAL = ['about', 'advertise', 'contact', 'grievance', 'privacy', 'terms', 'payment'];
    const parts = location.pathname.split('/').filter(Boolean);
    const currentSlug = parts[0] || '';

    // Save edition when visiting an edition page (not a legal page, not root)
    if (currentSlug && !LEGAL.includes(currentSlug)) {
      try { localStorage.setItem('mazamitra_edition', currentSlug); } catch (e) {}
    }

    // Rewrite "आजचा अंक" link to point to last-visited edition
    const saved = (() => {
      try { return localStorage.getItem('mazamitra_edition'); } catch (e) { return null; }
    })();

    if (saved) {
      window.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('a[href="/"], a[href="./"]').forEach(a => {
          a.setAttribute('href', '/' + saved + '/');
        });
      });
    }
  })();

  /* ═══════════════════════════════════════════════════════
     CORE ELEMENTS
     ═══════════════════════════════════════════════════════ */
  const body = document.body;
  const progressFill = document.getElementById('progressFill');
  const pageStatus = document.getElementById('pageStatus');
  const pages = Array.from(document.querySelectorAll('.news-page'));
  let scale = 1, ticking = false;

  /* ═══════════════════════════════════════════════════════
     PROGRESS BAR — Reading progress
     ═══════════════════════════════════════════════════════ */
  const updateProgress = () => {
    const s = document.documentElement.scrollHeight - window.innerHeight;
    const p = s > 0 ? (window.scrollY / s) * 100 : 0;
    if (progressFill) progressFill.style.width = Math.min(100, Math.max(0, p)) + '%';
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateProgress);
      ticking = true;
    }
  }, { passive: true });

  updateProgress();

  /* ═══════════════════════════════════════════════════════
     TEXT SIZE CONTROLS
     ═══════════════════════════════════════════════════════ */
  document.getElementById('smallerText')?.addEventListener('click', () => {
    scale = Math.max(0.85, scale - 0.05);
    document.documentElement.style.setProperty('--body-scale', scale);
  });

  document.getElementById('largerText')?.addEventListener('click', () => {
    scale = Math.min(1.2, scale + 0.05);
    document.documentElement.style.setProperty('--body-scale', scale);
  });

  /* ═══════════════════════════════════════════════════════
     THEME TOGGLE — Dark mode
     ═══════════════════════════════════════════════════════ */
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    body.classList.toggle('night');
  });

  /* ═══════════════════════════════════════════════════════
     PRINT BUTTON
     ═══════════════════════════════════════════════════════ */
  document.getElementById('printButton')?.addEventListener('click', () => {
    window.print();
  });

  /* ═══════════════════════════════════════════════════════
     PAGE STATUS — IntersectionObserver
     ═══════════════════════════════════════════════════════ */
  if ('IntersectionObserver' in window && pageStatus) {
    const obs = new IntersectionObserver((entries) => {
      const v = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!v) return;
      const i = pages.indexOf(v.target) + 1;
      if (i > 0) {
        pageStatus.textContent = `पृष्ठ ${String(i).replace(/\d/g, d => '०१२३४५६७८९'[+d])} / १०`;
      }
    }, { threshold: [0.2, 0.4, 0.6, 0.8] });

    pages.forEach(p => obs.observe(p));
  }

  /* ═══════════════════════════════════════════════════════
     FLOATING CONTACT WIDGET
     ═══════════════════════════════════════════════════════ */
  (function initFloatingContact() {
    const btn = document.getElementById('floatContactBtn');
    const modal = document.getElementById('floatModal');
    const closeBtn = document.getElementById('floatClose');

    if (!btn || !modal || !closeBtn) return;

    let previouslyFocused = null;

    /* ─── Open Modal ─── */
    function openModal() {
      previouslyFocused = document.activeElement;
      modal.classList.add('active');
      body.style.overflow = 'hidden';

      // Focus first input after animation
      setTimeout(() => {
        const firstInput = modal.querySelector('input[name="name"]');
        if (firstInput) firstInput.focus();
      }, 300);
    }

    /* ─── Close Modal ─── */
    function closeModal() {
      modal.classList.remove('active');
      body.style.overflow = '';

      // Restore focus
      if (previouslyFocused && previouslyFocused.focus) {
        setTimeout(() => previouslyFocused.focus(), 100);
      }
    }

    /* ─── Event Listeners ─── */
    btn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        closeModal();
      }
    });

    // Trap focus inside modal (accessibility)
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !modal.classList.contains('active')) return;

      const focusable = modal.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, button:not([disabled])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Auto-open if URL has ?contact=1
    if (window.location.search.includes('contact=1')) {
      setTimeout(openModal, 600);
    }

    // Auto-open after 30 seconds on first visit only
    try {
      const seen = localStorage.getItem('mazamitra_contact_seen');
      if (!seen) {
        setTimeout(() => {
          if (!modal.classList.contains('active')) {
            openModal();
            try { localStorage.setItem('mazamitra_contact_seen', '1'); } catch (e) {}
          }
        }, 30000);
      }
    } catch (e) { /* ignore */ }
  })();

  /* ═══════════════════════════════════════════════════════
     SMOOTH SCROLL — Internal anchor links
     ═══════════════════════════════════════════════════════ */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    const targetId = link.getAttribute('href');
    if (!targetId || targetId === '#') return;

    const target = document.querySelector(targetId);
    if (!target) return;

    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Update URL without jumping
    if (history.replaceState) {
      history.replaceState(null, '', targetId);
    }
  });

  /* ═══════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS (Optional — power users)
     ═══════════════════════════════════════════════════════ */
  document.addEventListener('keydown', (e) => {
    // Only when not typing in an input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // + / = : increase text
    if (e.key === '+' || e.key === '=') {
      document.getElementById('largerText')?.click();
    }
    // - : decrease text
    if (e.key === '-' || e.key === '_') {
      document.getElementById('smallerText')?.click();
    }
    // t : toggle theme
    if (e.key === 't' || e.key === 'T') {
      document.getElementById('themeToggle')?.click();
    }
    // c : open contact
    if (e.key === 'c' || e.key === 'C') {
      document.getElementById('floatContactBtn')?.click();
    }
  });

  /* ═══════════════════════════════════════════════════════
     PAGE LOAD LOG (dev only — remove in production)
     ═══════════════════════════════════════════════════════ */
  if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
    console.log('✅ माझा मित्र — script.js loaded');
  }

})();
