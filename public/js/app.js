/**
 * app.js
 * Main gallery application — splash screen, particle animation,
 * sidebar navigation, image grid, actress strip, and filters.
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────
  const state = {
    images:      [],
    page:        1,
    limit:       30,
    totalPages:  1,
    loading:     false,
    filter:      { category_id: null, actress_id: null },
    categories:  [],
    actresses:   [],
    settings:    {},
  };

  // ─── Element refs ────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const splash          = $('splash');
  const app             = $('app');
  const header          = $('header');
  const menuToggle      = $('menu-toggle');
  const sidebar         = $('sidebar');
  const sidebarOverlay  = $('sidebar-overlay');
  const sidebarClose    = $('sidebar-close');
  const categoryList    = $('category-list');
  const actressSidebar  = $('actress-sidebar-list');
  const galleryGrid     = $('gallery-grid');
  const gallerySkeleton = $('gallery-skeleton');
  const galleryEmpty    = $('gallery-empty');
  const loadMoreContainer = $('load-more-container');
  const loadMoreBtn     = $('load-more-btn');
  const actressStripTrack = $('actress-strip-track');
  const actressStrip    = $('actress-strip');
  const filtersActive   = $('filters-active');
  const filtersClear    = $('filters-clear');

  // ─── Init ────────────────────────────────────────────────────────────────
  async function init() {
    initParticles();
    initSplash();
    await loadSettings();
    await Promise.all([loadCategories(), loadActresses()]);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PARTICLE CANVAS
  // ═══════════════════════════════════════════════════════════════════
  function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const PARTICLE_COUNT = 80;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    class Particle {
      constructor() { this.reset(true); }
      reset(random = false) {
        this.x  = Math.random() * canvas.width;
        this.y  = random ? Math.random() * canvas.height : canvas.height + 10;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = -Math.random() * 0.5 - 0.2;
        this.r  = Math.random() * 1.5 + 0.3;
        this.a  = Math.random() * 0.6 + 0.1;
        this.life = Math.random();
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life += 0.003;
        if (this.y < -10) this.reset();
      }
      draw() {
        const pulse = 0.5 + 0.5 * Math.sin(this.life * Math.PI * 2);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,212,255,${this.a * pulse})`;
        ctx.fill();
      }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw grid lines
      ctx.strokeStyle = 'rgba(0,212,255,0.04)';
      ctx.lineWidth = 1;
      const gridSize = 80;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
      // Central glow
      const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.height*0.5);
      grad.addColorStop(0, 'rgba(0,212,255,0.07)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Particles
      particles.forEach(p => { p.update(); p.draw(); });
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SPLASH SCREEN
  // ═══════════════════════════════════════════════════════════════════
  function initSplash() {
    let entered = false;

    function enter() {
      if (entered) return;
      entered = true;
      splash.classList.add('is-leaving');
      setTimeout(() => {
        splash.style.display = 'none';
        revealApp();
      }, 900);
    }

    // Auto-enter after 4 seconds
    const autoTimer = setTimeout(enter, 4000);

    // Or on click/tap
    splash.addEventListener('click', () => {
      clearTimeout(autoTimer);
      enter();
    });
  }

  function revealApp() {
    app.classList.remove('app--hidden');
    app.classList.add('app--visible');
    // Load content
    loadImages();
    buildActressStrip();
    initIntersectionObserver();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SETTINGS
  // ═══════════════════════════════════════════════════════════════════
  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const { data } = await res.json();
      state.settings = data;
      // Update Instagram links
      const igUrl    = data.instagram_url    || '#';
      const igHandle = data.instagram_handle || '@myystical__arts';
      [$('header-ig-link'), $('sidebar-ig-link'), $('footer-ig-btn')].forEach(el => {
        if (el) el.href = igUrl;
      });
      [$('header-ig-handle'), $('sidebar-ig-handle'), $('footer-ig-handle')].forEach(el => {
        if (el) el.textContent = igHandle;
      });
      if (data.site_name) document.title = `${data.site_name} — Curated Celebrity Gallery`;
    } catch (_) { /* non-critical */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORIES & ACTRESSES
  // ═══════════════════════════════════════════════════════════════════
  async function loadCategories() {
    try {
      const res = await fetch('/api/categories');
      if (!res.ok) return;
      const { data } = await res.json();
      state.categories = data;
      renderCategoryList(data);
    } catch (_) {}
  }

  function renderCategoryList(cats) {
    if (!categoryList) return;
    // Keep "All Categories" item
    const allItem = categoryList.querySelector('[data-value=""]');
    categoryList.innerHTML = '';
    if (allItem) categoryList.appendChild(allItem);
    cats.forEach(cat => {
      const li = document.createElement('li');
      li.className = 'sidebar__item';
      li.dataset.filter = 'category';
      li.dataset.value  = cat.id;
      li.setAttribute('role', 'listitem');
      li.innerHTML = `<span class="sidebar__item-dot"></span>${escHtml(cat.name)}`;
      li.addEventListener('click', () => applyFilter('category', cat.id, cat.name));
      categoryList.appendChild(li);
    });
    // Wire up "All" item
    const all = categoryList.querySelector('[data-value=""]');
    if (all) all.addEventListener('click', () => applyFilter('category', null, 'All Categories'));
  }

  async function loadActresses() {
    try {
      const res = await fetch('/api/actresses');
      if (!res.ok) return;
      const { data } = await res.json();
      state.actresses = data || [];
      renderActressSidebar(state.actresses);
      buildActressStrip();
    } catch (_) {}
  }


  function renderActressSidebar(actresses) {
    if (!actressSidebar) return;
    const allItem = actressSidebar.querySelector('[data-value=""]');
    actressSidebar.innerHTML = '';
    if (allItem) actressSidebar.appendChild(allItem);
    actresses.forEach(a => {
      const li = document.createElement('li');
      li.className = 'sidebar__item';
      li.dataset.filter = 'actress';
      li.dataset.value  = a.id;
      li.setAttribute('role', 'listitem');
      li.innerHTML = a.face_url
        ? `<img class="sidebar__item-face" src="${escAttr(a.face_url)}" alt="" draggable="false" />${escHtml(a.name)}`
        : `<span class="sidebar__item-dot"></span>${escHtml(a.name)}`;
      li.addEventListener('click', () => applyFilter('actress', a.id, a.name));
      actressSidebar.appendChild(li);
    });
    const all = actressSidebar.querySelector('[data-value=""]');
    if (all) all.addEventListener('click', () => applyFilter('actress', null, 'All Actresses'));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  FILTERS
  // ═══════════════════════════════════════════════════════════════════
  function applyFilter(type, value, label) {
    if (type === 'category') {
      state.filter.category_id = value;
    } else if (type === 'actress') {
      state.filter.actress_id = value;
    }
    state.page = 1;
    state.images = [];
    // Update active state in sidebar
    updateSidebarActive(type, value);
    // Update actress strip active state
    updateStripActive(value);
    // Update filters bar
    updateFiltersBar();
    // Close sidebar on mobile
    closeSidebar();
    // Reload images
    galleryGrid.innerHTML = '';
    loadImages();
  }

  function updateSidebarActive(type, value) {
    const listId = type === 'category' ? 'category-list' : 'actress-sidebar-list';
    const list = $(listId);
    if (!list) return;
    list.querySelectorAll('.sidebar__item').forEach(item => {
      const isActive = (item.dataset.value == value) || (value === null && item.dataset.value === '');
      item.classList.toggle('sidebar__item--active', isActive);
    });
  }

  function updateStripActive(actressId) {
    actressStripTrack.querySelectorAll('.actress-card').forEach(card => {
      const isActive = (card.dataset.id == actressId) || (actressId === null && card.dataset.id === '');
      card.classList.toggle('is-active', isActive);
    });
  }

  function updateFiltersBar() {
    const catLabel = state.filter.category_id
      ? (state.categories.find(c => c.id == state.filter.category_id)?.name || 'Category')
      : null;
    const actLabel = state.filter.actress_id
      ? (state.actresses.find(a => a.id == state.filter.actress_id)?.name || 'Actress')
      : null;

    const parts = [catLabel, actLabel].filter(Boolean);
    filtersActive.textContent = parts.length ? parts.join(' + ') : 'All Photos';
    filtersClear.style.display = parts.length ? '' : 'none';
  }

  if (filtersClear) {
    filtersClear.addEventListener('click', () => {
      state.filter.category_id = null;
      state.filter.actress_id  = null;
      state.page = 1;
      state.images = [];
      galleryGrid.innerHTML = '';
      updateSidebarActive('category', null);
      updateSidebarActive('actress', null);
      updateStripActive(null);
      updateFiltersBar();
      loadImages();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  IMAGES
  // ═══════════════════════════════════════════════════════════════════
  async function loadImages(append = false) {
    if (state.loading) return;
    state.loading = true;

    if (!append) {
      gallerySkeleton.style.display = 'grid';
      galleryEmpty.style.display = 'none';
      loadMoreContainer.style.display = 'none';
    } else {
      loadMoreBtn.classList.add('is-loading');
    }

    try {
      const params = new URLSearchParams({
        page:  state.page,
        limit: state.limit,
      });
      if (state.filter.category_id) params.set('category_id', state.filter.category_id);
      if (state.filter.actress_id)  params.set('actress_id',  state.filter.actress_id);

      const res  = await fetch(`/api/images?${params}`);
      if (!res.ok) throw new Error('Failed to load images');
      const json = await res.json();

      gallerySkeleton.style.display = 'none';

      if (!json.data || json.data.length === 0 && !append) {
        galleryEmpty.style.display = '';
        return;
      }

      state.images.push(...json.data);
      state.totalPages = json.pagination.pages;

      renderImages(json.data, append);

      loadMoreContainer.style.display = json.pagination.has_next ? '' : 'none';
    } catch (err) {
      console.error(err);
      gallerySkeleton.style.display = 'none';
      if (!append) galleryEmpty.style.display = '';
    } finally {
      state.loading = false;
      loadMoreBtn.classList.remove('is-loading');
    }
  }

  function renderImages(images, append = false) {
    images.forEach((img, i) => {
      const card = createImageCard(img, state.images.length - images.length + i);
      galleryGrid.appendChild(card);
    });
  }

  function createImageCard(img, globalIndex) {
    const card = document.createElement('article');
    card.className = 'img-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${img.actress?.name || 'Photo'}: ${img.caption || 'View image'}`);
    card.dataset.index = globalIndex;

    card.innerHTML = `
      <img
        class="img-card__img"
        src="${escAttr(img.url)}"
        alt="${escAttr(img.actress?.name || img.caption || 'Celebrity photo')}"
        loading="lazy"
        draggable="false"
      />
      <div class="img-card__overlay"></div>
      <div class="img-card__info">
        ${img.actress?.name ? `<p class="img-card__actress">${escHtml(img.actress.name)}</p>` : ''}
        ${img.caption ? `<p class="img-card__caption">${escHtml(img.caption)}</p>` : ''}
      </div>
      ${img.category?.name ? `<span class="img-card__category-tag">${escHtml(img.category.name)}</span>` : ''}
      <div class="img-card__no-dl" aria-hidden="true"></div>
    `;

    // Click → open lightbox
    card.addEventListener('click', () => {
      window.Lightbox.open(state.images, globalIndex);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.Lightbox.open(state.images, globalIndex);
      }
    });

    // Block right-click on card
    card.addEventListener('contextmenu', e => e.preventDefault());

    return card;
  }

  // Load more
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      state.page++;
      loadImages(true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ACTRESS STRIP
  // ═══════════════════════════════════════════════════════════════════
  function buildActressStrip() {
    if (!actressStripTrack) return;
    actressStripTrack.innerHTML = '';

    if (!state.actresses.length) {
      actressStrip.style.display = 'none';
      return;
    }

    state.actresses.forEach((a, i) => {
      const card = document.createElement('div');
      card.className = 'actress-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `Filter by ${a.name}`);
      card.dataset.id = a.id;
      card.style.animationDelay = `${i * 60}ms`;

      card.innerHTML = `
        <div class="actress-card__face-wrap">
          ${a.face_url
            ? `<img class="actress-card__face" src="${escAttr(a.face_url)}" alt="${escAttr(a.name)}" draggable="false" loading="lazy" />`
            : `<div class="actress-card__face-placeholder" aria-hidden="true">◉</div>`
          }
        </div>
        <span class="actress-card__name">${escHtml(a.name)}</span>
      `;

      card.addEventListener('click', () => {
        applyFilter('actress', a.id, a.name);
        sidebar.setAttribute('aria-hidden', 'true');
        sidebarOverlay.classList.remove('is-visible');
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyFilter('actress', a.id, a.name);
        }
      });

      actressStripTrack.appendChild(card);
    });

    // Drag-to-scroll on strip
    initDragScroll(actressStrip.querySelector('.actress-strip__scroll-wrapper'));
  }

  // Drag-scroll
  function initDragScroll(el) {
    if (!el) return;
    let isDown = false, startX, scrollLeft;
    el.addEventListener('mousedown', e => {
      isDown = true;
      startX = e.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
    });
    el.addEventListener('mouseleave', () => { isDown = false; });
    el.addEventListener('mouseup',    () => { isDown = false; });
    el.addEventListener('mousemove',  e => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      el.scrollLeft = scrollLeft - (x - startX) * 1.5;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SIDEBAR
  // ═══════════════════════════════════════════════════════════════════
  function openSidebar() {
    sidebar.classList.add('is-open');
    sidebarOverlay.classList.add('is-visible');
    sidebar.setAttribute('aria-hidden', 'false');
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('is-open');
    sidebarOverlay.classList.remove('is-visible');
    sidebar.setAttribute('aria-hidden', 'true');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  if (menuToggle)    menuToggle.addEventListener('click',    openSidebar);
  if (sidebarClose)  sidebarClose.addEventListener('click',  closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  // ESC closes sidebar
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) closeSidebar();
  });

  // ═══════════════════════════════════════════════════════════════════
  //  INTERSECTION OBSERVER (scroll animations)
  // ═══════════════════════════════════════════════════════════════════
  function initIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    // Observe gallery cards (via MutationObserver since they're added dynamically)
    const mutObs = new MutationObserver(() => {
      galleryGrid.querySelectorAll('.img-card:not(.is-visible)').forEach(card => observer.observe(card));
      actressStripTrack.querySelectorAll('.actress-card:not(.is-visible)').forEach(card => observer.observe(card));
    });
    mutObs.observe(galleryGrid, { childList: true });
    mutObs.observe(actressStripTrack, { childList: true });

    // Observe actress strip section
    if (actressStrip) observer.observe(actressStrip);
  }

  // ─── Header scroll effect ─────────────────────────────────────────────────
  window.addEventListener('scroll', () => {
    if (header) {
      header.style.background = window.scrollY > 10
        ? 'rgba(0,0,0,0.95)'
        : 'rgba(0,0,0,0.85)';
    }
  }, { passive: true });

  // ─── Utilities ────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function escAttr(str) { return escHtml(str); }

  // ─── Toast ────────────────────────────────────────────────────────────────
  window.showToast = function(msg, type = 'info', duration = 4000) {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  // ─── Start ────────────────────────────────────────────────────────────────
  init();

})();
