/**
 * lightbox.js
 * Full-screen image viewer with anti-download protection.
 * Loaded before app.js so it's available immediately.
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────
  let currentImages = [];
  let currentIndex  = 0;
  let isOpen        = false;

  // ─── Elements ───────────────────────────────────────────────────────────
  const lb        = document.getElementById('lightbox');
  const backdrop  = document.getElementById('lightbox-backdrop');
  const closeBtn  = document.getElementById('lightbox-close');
  const prevBtn   = document.getElementById('lightbox-prev');
  const nextBtn   = document.getElementById('lightbox-next');
  const img       = document.getElementById('lightbox-img');
  const actress   = document.getElementById('lightbox-actress');
  const caption   = document.getElementById('lightbox-caption');
  const counter   = document.getElementById('lightbox-counter');

  // ─── Public API ─────────────────────────────────────────────────────────
  window.Lightbox = {
    open(images, index = 0) {
      currentImages = images;
      currentIndex  = index;
      isOpen = true;
      show();
      lb.classList.add('is-open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      setTimeout(() => img.focus(), 100);
    },
    close() {
      isOpen = false;
      lb.classList.remove('is-open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      img.src = '';
    },
    next() { navigate(1); },
    prev() { navigate(-1); },
  };

  // ─── Show image ──────────────────────────────────────────────────────────
  function show() {
    if (!currentImages.length) return;
    const item = currentImages[currentIndex];
    img.src = item.url;
    img.alt = item.actress?.name || item.caption || 'Photo';
    actress.textContent = item.actress?.name || '';
    caption.textContent = item.caption || '';
    counter.textContent = `${currentIndex + 1} / ${currentImages.length}`;
    prevBtn.style.display = currentImages.length > 1 ? '' : 'none';
    nextBtn.style.display = currentImages.length > 1 ? '' : 'none';
  }

  function navigate(dir) {
    if (!currentImages.length) return;
    currentIndex = (currentIndex + dir + currentImages.length) % currentImages.length;
    // Fade transition
    img.style.opacity = '0';
    setTimeout(() => {
      show();
      img.style.opacity = '1';
    }, 150);
  }

  // ─── Event listeners ─────────────────────────────────────────────────────
  if (closeBtn)  closeBtn.addEventListener('click',  window.Lightbox.close);
  if (backdrop)  backdrop.addEventListener('click',  window.Lightbox.close);
  if (prevBtn)   prevBtn.addEventListener('click',   () => navigate(-1));
  if (nextBtn)   nextBtn.addEventListener('click',   () => navigate(1));

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    switch (e.key) {
      case 'Escape':    window.Lightbox.close(); break;
      case 'ArrowLeft': navigate(-1); break;
      case 'ArrowRight':navigate(1);  break;
    }
    // Block save / print shortcuts
    if ((e.ctrlKey || e.metaKey) && ['s','p','u','a'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  ANTI-DOWNLOAD PROTECTIONS
  // ═══════════════════════════════════════════════════════════════════

  // 1. Block right-click on entire document (for images)
  document.addEventListener('contextmenu', (e) => {
    const tag = e.target.tagName;
    if (tag === 'IMG' || e.target.classList.contains('img-card__no-dl') || e.target.classList.contains('lightbox__no-dl')) {
      e.preventDefault();
    }
  });

  // 2. Block drag-start on images
  document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });

  // 3. Block common keyboard save/print shortcuts globally
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['s','p'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });

  // 4. Disable print (CSS print stylesheet hides images)
  const printStyle = document.createElement('style');
  printStyle.textContent = '@media print { img, .img-card, .lightbox { display: none !important; visibility: hidden !important; } }';
  document.head.appendChild(printStyle);

  // 5. Image transition style
  img.style.transition = 'opacity 0.15s ease';

})();
