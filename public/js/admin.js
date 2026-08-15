/**
 * admin.js
 * Admin panel logic: login, dashboard, image/actress/category management.
 */

(function () {
  'use strict';

  // ─── Element shortcuts ────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ─── State ───────────────────────────────────────────────────────────────
  const state = {
    actresses:  [],
    categories: [],
    images:     [],
    editActressId: null,
    editCategoryId: null,
    deleteCallback: null,
  };

  // ─── Toast ───────────────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 4000) {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toast-out 0.3s ease forwards';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // ─── HTML escape ─────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
  }

  // ─── API fetch helper ─────────────────────────────────────────────────────
  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      credentials: 'include',
      ...options,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function apiForm(url, formData, method = 'POST') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(url, { method, body: formData, credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Upload timed out. Please try uploading smaller images.');
      throw err;
    }
  }

  function compressImage(file, maxDimension = 1920, quality = 0.82) {
    return new Promise((resolve) => {
      if (!file || file.size < 350 * 1024) return resolve(file);
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) return resolve(file);
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = url;
    });
  }


  // ─── Modal helpers ────────────────────────────────────────────────────────
  function openModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // Wire up all [data-close-modal] buttons/backdrops
  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.closeModal));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['upload-modal','actress-modal','category-modal','confirm-modal'].forEach(closeModal);
    }
  });

  // ─── Set button loading state ─────────────────────────────────────────────
  function setLoading(btnId, on) {
    const btn = $(btnId);
    if (!btn) return;
    btn.classList.toggle('is-loading', on);
    btn.disabled = on;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  AUTH CHECK
  // ═══════════════════════════════════════════════════════════════════
  async function checkAuth() {
    try {
      await api('/api/admin/verify');
      showDashboard();
    } catch (_) {
      showLogin();
    }
  }

  function showLogin() {
    $('login-screen').style.display = '';
    $('admin-app').style.display = 'none';
  }

  function showDashboard() {
    $('login-screen').style.display = 'none';
    $('admin-app').style.display = 'grid';
    loadStats();
    loadActresses();
    loadCategories();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  LOGIN
  // ═══════════════════════════════════════════════════════════════════
  const loginForm = $('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = $('login-error');
      errorEl.style.display = 'none';
      setLoading('login-submit', true);

      const username = $('login-username').value.trim();
      const password = $('login-password').value;

      try {
        await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ username, password, captchaToken: 'dev' }),
        });
        toast('Login successful!', 'success');
        showDashboard();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = '';
      } finally {
        setLoading('login-submit', false);
      }
    });
  }

  // Toggle password visibility
  const pwToggle = $('pw-toggle');
  if (pwToggle) {
    pwToggle.addEventListener('click', () => {
      const input = $('login-password');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await api('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) });
      } catch (_) {}
      showLogin();
      toast('Signed out.', 'info');
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════════════
  const sections = {
    dashboard:  'section-dashboard',
    images:     'section-images',
    actresses:  'section-actresses',
    categories: 'section-categories',
    settings:   'section-settings',
  };

  function showSection(name) {
    Object.entries(sections).forEach(([key, id]) => {
      const el = $(id);
      if (el) el.style.display = key === name ? '' : 'none';
    });
    document.querySelectorAll('.admin-nav__item').forEach(btn => {
      btn.classList.toggle('admin-nav__item--active', btn.dataset.section === name);
    });
    // Load section data
    if (name === 'images')     loadImages();
    if (name === 'actresses')  loadActresses();
    if (name === 'categories') loadCategories();
    if (name === 'settings')   loadSettings();
  }

  document.querySelectorAll('.admin-nav__item').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // Dashboard shortcuts
  const dashUpload  = $('dash-upload');
  const dashActress = $('dash-actress');
  if (dashUpload)  dashUpload.addEventListener('click',  () => { showSection('images'); openUploadModal(); });
  if (dashActress) dashActress.addEventListener('click', () => { showSection('actresses'); openActressModal(); });

  // ═══════════════════════════════════════════════════════════════════
  //  STATS
  // ═══════════════════════════════════════════════════════════════════
  async function loadStats() {
    try {
      const { data } = await api('/api/admin/stats');
      animateCount('stat-images',     data.images);
      animateCount('stat-actresses',  data.actresses);
      animateCount('stat-categories', data.categories);
    } catch (_) {}
  }

  function animateCount(id, target) {
    const el = $(id);
    if (!el) return;
    let current = 0;
    const step = Math.ceil(target / 30);
    const interval = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current;
      if (current >= target) clearInterval(interval);
    }, 30);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  IMAGES
  // ═══════════════════════════════════════════════════════════════════
  async function loadImages() {
    const tbody = $('images-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading…</td></tr>';
    try {
      const { data } = await api('/api/admin/images');
      state.images = data || [];
      renderImagesTable(state.images);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-loading" style="color:var(--danger)">${esc(err.message)}</td></tr>`;
    }
  }

  function renderImagesTable(images) {
    const tbody = $('images-tbody');
    if (!images.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-loading">No images uploaded yet.</td></tr>';
      return;
    }
    tbody.innerHTML = images.map(img => `
      <tr data-id="${img.id}">
        <td>
          <img class="table-thumb" src="${esc(img.url)}" alt="Preview" loading="lazy" />
        </td>
        <td>${esc(img.actress_name || '—')}</td>
        <td>${esc(img.category_name || '—')}</td>
        <td title="${esc(img.caption)}">${esc(img.caption ? img.caption.slice(0,40) + (img.caption.length>40?'…':'') : '—')}</td>
        <td>${esc(img.sort_order)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn--sm btn--danger" data-delete-image="${img.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Wire delete buttons
    tbody.querySelectorAll('[data-delete-image]').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteImage(btn.dataset.deleteImage));
    });
  }

  function confirmDeleteImage(id) {
    $('confirm-text').textContent = 'Delete this image? This cannot be undone.';
    state.deleteCallback = () => deleteImage(id);
    openModal('confirm-modal');
  }

  async function deleteImage(id) {
    try {
      await api(`/api/admin/images/${id}`, { method: 'DELETE', body: '{}' });
      toast('Image deleted.', 'success');
      loadImages();
      loadStats();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Confirm delete button
  const confirmDeleteBtn = $('confirm-delete-btn');
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      closeModal('confirm-modal');
      if (state.deleteCallback) await state.deleteCallback();
    });
  }

  // ─── Upload Carousel ──────────────────────────────────────────────────────
  const MAX_FILES = 10;

  // carousel state
  const carousel = {
    files:    [],   // File objects
    captions: [],   // per-slide caption strings
    current:  0,
  };

  function openUploadModal() {
    resetCarousel();
    populateSelect('upload-actress',  state.actresses,  'Select Actress');
    populateSelect('upload-category', state.categories, 'Select Category');
    openModal('upload-modal');
  }

  $('open-upload-modal')?.addEventListener('click', openUploadModal);

  function resetCarousel() {
    // Revoke any old object URLs
    carousel.files.forEach((_, i) => {
      const slide = $(`carousel-slide-${i}`);
      if (slide) {
        const img = slide.querySelector('img');
        if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      }
    });
    carousel.files    = [];
    carousel.captions = [];
    carousel.current  = 0;

    const el = id => document.getElementById(id);

    const stepDrop = el('upload-step-drop');
    if (stepDrop) stepDrop.style.display = '';
    const stepCar = el('upload-step-carousel');
    if (stepCar) stepCar.style.display = 'none';
    const globalF = el('upload-global-fields');
    if (globalF) globalF.style.display = 'none';
    const submitBtn = el('upload-submit');
    if (submitBtn) submitBtn.style.display = 'none';
    const progWrap = el('upload-progress-wrap');
    if (progWrap) progWrap.style.display = 'none';
    const countLbl = el('upload-count-label');
    if (countLbl) countLbl.textContent = '';
    const track = el('carousel-track');
    if (track) track.innerHTML = '';
    const dots = el('carousel-dots');
    if (dots) dots.innerHTML = '';
    // Reset progress bar colour
    const fill = el('upload-progress-fill');
    if (fill) { fill.style.width = '0%'; fill.style.background = ''; }
    const fileInput = el('image-file');
    if (fileInput) fileInput.value = '';
  }

  // ── Drop zone ─────────────────────────────────────────────────────
  const dropZone  = $('drop-zone');
  const imageFile = $('image-file');

  if (dropZone) {
    ['dragover','dragenter'].forEach(evt => {
      dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('is-dragover'); });
    });
    ['dragleave','drop'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('is-dragover'));
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    });
  }

  if (imageFile) {
    imageFile.addEventListener('change', () => {
      addFiles(Array.from(imageFile.files));
    });
  }

  $('upload-clear')?.addEventListener('click', resetCarousel);

  function addFiles(newFiles) {
    const valid = newFiles.filter(f => ['image/jpeg','image/png','image/webp'].includes(f.type));
    const invalid = newFiles.length - valid.length;
    if (invalid) toast(`${invalid} file(s) skipped — only JPEG, PNG, WebP allowed.`, 'error');

    const remaining = MAX_FILES - carousel.files.length;
    const toAdd = valid.slice(0, remaining);
    if (valid.length > remaining) toast(`Only ${remaining} more slot(s) available. ${valid.length - remaining} file(s) skipped.`, 'info');
    if (!toAdd.length) return;

    toAdd.forEach(file => {
      carousel.captions.push('');
      const idx = carousel.files.length;
      carousel.files.push(file);
      buildSlide(file, idx);
    });

    // Show carousel BEFORE syncing so DOM is visible when we set transform
    $('upload-step-drop').style.display     = 'none';
    $('upload-step-carousel').style.display = '';
    $('upload-global-fields').style.display = '';
    $('upload-submit').style.display        = '';

    syncCarousel();
  }

  // ── Build one carousel slide ──────────────────────────────────────
  function buildSlide(file, idx) {
    const track = $('carousel-track');
    const url   = URL.createObjectURL(file);
    const slide = document.createElement('div');
    slide.className   = 'carousel-slide';
    slide.id          = `carousel-slide-${idx}`;
    slide.dataset.idx = idx;

    slide.innerHTML = `
      <span class="carousel-slide__badge">${idx + 1} / ${carousel.files.length}</span>
      <button type="button" class="carousel-slide__remove" data-remove="${idx}" aria-label="Remove">✕</button>
      <img class="carousel-slide__img" src="${url}" alt="Preview ${idx + 1}" />
      <div class="carousel-slide__caption">
        <input
          type="text"
          id="caption-${idx}"
          placeholder="Caption for this photo (optional)…"
          maxlength="500"
          autocomplete="off"
          value="${esc(carousel.captions[idx] || '')}"
        />
      </div>
    `;

    // Sync caption input → carousel.captions
    const input = slide.querySelector(`#caption-${idx}`);
    input.addEventListener('input', () => { carousel.captions[idx] = input.value; });

    // Remove slide
    slide.querySelector('[data-remove]').addEventListener('click', () => removeSlide(idx));

    track.appendChild(slide);
  }

  function removeSlide(idx) {
    // Revoke URL
    const slide = $(`carousel-slide-${idx}`);
    if (slide) {
      const img = slide.querySelector('img');
      if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      slide.remove();
    }
    carousel.files.splice(idx, 1);
    carousel.captions.splice(idx, 1);

    if (!carousel.files.length) { resetCarousel(); return; }

    // Rebuild all slides (re-index)
    $('carousel-track').innerHTML = '';
    carousel.files.forEach((f, i) => buildSlide(f, i));
    carousel.current = Math.min(carousel.current, carousel.files.length - 1);
    syncCarousel();
  }

  // ── Navigation ───────────────────────────────────────────────────
  function goTo(idx) {
    carousel.current = Math.max(0, Math.min(idx, carousel.files.length - 1));
    syncCarousel();
  }

  $('carousel-prev')?.addEventListener('click', () => goTo(carousel.current - 1));
  $('carousel-next')?.addEventListener('click', () => goTo(carousel.current + 1));

  function syncCarousel() {
    const n = carousel.files.length;
    const c = carousel.current;

    // Slide track
    $('carousel-track').style.transform = `translateX(-${c * 100}%)`;

    // Prev / next buttons
    const prevBtn = $('carousel-prev');
    const nextBtn = $('carousel-next');
    if (prevBtn) prevBtn.disabled = c === 0;
    if (nextBtn) nextBtn.disabled = c === n - 1;

    // Dots
    const dotsEl = $('carousel-dots');
    dotsEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `carousel-dot${i === c ? ' is-active' : ''}`;
      dot.setAttribute('aria-label', `Go to image ${i + 1}`);
      dot.addEventListener('click', () => goTo(i));
      dotsEl.appendChild(dot);
    }

    // Update all slide badges
    $('carousel-track').querySelectorAll('.carousel-slide__badge').forEach((badge, i) => {
      badge.textContent = `${i + 1} / ${n}`;
    });

    // Header count label
    $('upload-count-label').textContent = `(${n} / ${MAX_FILES})`;

    // Upload button label
    const submitBtn = $('upload-submit');
    if (submitBtn) {
      const labelEl = submitBtn.querySelector('.btn__text');
      if (labelEl) labelEl.textContent = `Upload ${n} Image${n !== 1 ? 's' : ''}`;
    }
  }

  // ── Submit ───────────────────────────────────────────────────────
  const uploadForm = $('upload-form');
  if (uploadForm) {
    uploadForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!carousel.files.length) { toast('Please select at least one image.', 'error'); return; }

      setLoading('upload-submit', true);
      $('upload-progress-wrap').style.display = '';
      $('upload-progress-fill').style.width   = '5%';
      $('upload-progress-label').textContent  = `Optimizing ${carousel.files.length} image(s)…`;

      try {
        const compressedFiles = await Promise.all(carousel.files.map(f => compressImage(f)));
        $('upload-progress-fill').style.width   = '20%';
        $('upload-progress-label').textContent  = `Uploading ${compressedFiles.length} image(s)…`;

        const fd = new FormData();
        compressedFiles.forEach(f => fd.append('images', f));
        fd.append('captions_json', JSON.stringify(carousel.captions));

        const actressId  = $('upload-actress')?.value  || '';
        const categoryId = $('upload-category')?.value || '';
        if (actressId)  fd.append('actress_id',  actressId);
        if (categoryId) fd.append('category_id', categoryId);

        let fakeProgress = 20;
        const progressTimer = setInterval(() => {
          fakeProgress = Math.min(fakeProgress + 8, 85);
          $('upload-progress-fill').style.width = `${fakeProgress}%`;
        }, 200);

        const json = await apiForm('/api/admin/images', fd);
        clearInterval(progressTimer);
        $('upload-progress-fill').style.width  = '100%';
        $('upload-progress-label').textContent = json.message;

        setTimeout(() => {
          closeModal('upload-modal');
          toast(json.message, json.failed?.length ? 'info' : 'success');
          resetCarousel();
          setLoading('upload-submit', false);
          loadImages();
          loadStats();
        }, 600);
      } catch (err) {
        const fill = $('upload-progress-fill');
        if (fill) { fill.style.width = '100%'; fill.style.background = 'var(--danger)'; }
        const label = $('upload-progress-label');
        if (label) label.textContent = `Error: ${err.message}`;
        toast(err.message, 'error');
        setLoading('upload-submit', false);
      }
    });
  }


  // ═══════════════════════════════════════════════════════════════════
  //  ACTRESSES
  // ═══════════════════════════════════════════════════════════════════
  async function loadActresses() {
    const tbody = $('actresses-tbody');
    try {
      const { data } = await api('/api/admin/actresses');
      state.actresses = data || [];
      if (tbody) renderActressesTable(state.actresses);
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="table-loading" style="color:var(--danger)">${esc(err.message)}</td></tr>`;
    }
  }

  function renderActressesTable(actresses) {
    const tbody = $('actresses-tbody');
    if (!actresses.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-loading">No actresses added yet.</td></tr>';
      return;
    }
    tbody.innerHTML = actresses.map(a => `
      <tr data-id="${a.id}">
        <td>
          ${a.face_url
            ? `<img class="table-face" src="${esc(a.face_url)}" alt="${esc(a.name)}" loading="lazy" />`
            : `<div class="table-face" style="background:var(--bg-card);border:1px solid var(--neon-border);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">◉</div>`
          }
        </td>
        <td>${esc(a.name)}</td>
        <td>${a.instagram_url ? `<a href="${esc(a.instagram_url)}" target="_blank" rel="noopener" class="link" style="font-size:0.8rem">↗ IG</a>` : '—'}</td>
        <td><span class="table-badge ${a.is_active ? 'table-badge--active' : 'table-badge--inactive'}">${a.is_active ? 'Active' : 'Hidden'}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn btn--sm btn--ghost" data-edit-actress="${a.id}">Edit</button>
            <button class="btn btn--sm btn--danger" data-delete-actress="${a.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-actress]').forEach(btn => {
      btn.addEventListener('click', () => openActressModal(btn.dataset.editActress));
    });
    tbody.querySelectorAll('[data-delete-actress]').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteActress(btn.dataset.deleteActress));
    });
  }

  function openActressModal(id = null) {
    const form = $('actress-form');
    form?.reset();
    $('face-preview').style.display = 'none';
    $('face-drop-zone').style.display = '';
    state.editActressId = id;
    $('actress-modal-title').textContent = id ? 'Edit Actress' : 'Add Actress';

    if (id) {
      const actress = state.actresses.find(a => a.id == id);
      if (actress) {
        $('actress-name').value  = actress.name || '';
        $('actress-ig').value    = actress.instagram_url || '';
        $('actress-bio').value   = actress.bio || '';
        $('actress-order').value = actress.sort_order || 0;
        if (actress.face_url) {
          const previewImg = $('face-preview-img');
          if (previewImg) previewImg.src = actress.face_url;
          $('face-preview').style.display = '';
          $('face-drop-zone').style.display = 'none';
        }
      }
    }
    openModal('actress-modal');
  }

  $('open-actress-modal')?.addEventListener('click', () => openActressModal());

  // Face drop zone
  const faceFile    = $('face-file');
  const facePreview = $('face-preview');
  const facePrevImg = $('face-preview-img');
  const faceRemove  = $('face-remove');

  if (faceFile) {
    faceFile.addEventListener('change', () => {
      if (faceFile.files[0]) {
        facePrevImg.src = URL.createObjectURL(faceFile.files[0]);
        facePreview.style.display = '';
        $('face-drop-zone').style.display = 'none';
      }
    });
  }
  if (faceRemove) {
    faceRemove.addEventListener('click', () => {
      if (faceFile) faceFile.value = '';
      if (facePrevImg) facePrevImg.src = '';
      if (facePreview) facePreview.style.display = 'none';
      $('face-drop-zone').style.display = '';
    });
  }

  // Actress form submit
  const actressForm = $('actress-form');
  if (actressForm) {
    actressForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('actress-name').value.trim();
      if (!name) { toast('Name is required.', 'error'); return; }
      setLoading('actress-submit', true);
      const fd = new FormData(actressForm);
      fd.delete('id');
      try {
        if (state.editActressId) {
          await apiForm(`/api/admin/actresses/${state.editActressId}`, fd, 'PUT');
          toast('Actress updated!', 'success');
        } else {
          await apiForm('/api/admin/actresses', fd);
          toast('Actress added!', 'success');
        }
        closeModal('actress-modal');
        await loadActresses();
        loadStats();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading('actress-submit', false);
      }
    });
  }

  function confirmDeleteActress(id) {
    const a = state.actresses.find(a => a.id == id);
    $('confirm-text').textContent = `Delete actress "${a?.name || id}"? This cannot be undone.`;
    state.deleteCallback = () => deleteActress(id);
    openModal('confirm-modal');
  }

  async function deleteActress(id) {
    try {
      await api(`/api/admin/actresses/${id}`, { method: 'DELETE', body: '{}' });
      toast('Actress deleted.', 'success');
      loadActresses();
      loadStats();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORIES
  // ═══════════════════════════════════════════════════════════════════
  async function loadCategories() {
    const tbody = $('categories-tbody');
    try {
      const { data } = await api('/api/categories');
      state.categories = data || [];
      if (tbody) renderCategoriesTable(state.categories);
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="table-loading">${esc(err.message)}</td></tr>`;
    }
  }

  function renderCategoriesTable(cats) {
    const tbody = $('categories-tbody');
    if (!cats.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-loading">No categories yet.</td></tr>';
      return;
    }
    tbody.innerHTML = cats.map(c => `
      <tr data-id="${c.id}">
        <td>${esc(c.name)}</td>
        <td><code style="font-size:0.8rem;color:var(--neon-dim)">${esc(c.slug)}</code></td>
        <td>${esc(c.description || '—')}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn--sm btn--ghost" data-edit-cat="${c.id}">Edit</button>
            <button class="btn btn--sm btn--danger" data-delete-cat="${c.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-cat]').forEach(btn => {
      btn.addEventListener('click', () => openCategoryModal(btn.dataset.editCat));
    });
    tbody.querySelectorAll('[data-delete-cat]').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteCategory(btn.dataset.deleteCat));
    });
  }

  function openCategoryModal(id = null) {
    const form = $('category-form');
    form?.reset();
    state.editCategoryId = id;
    $('category-modal-title').textContent = id ? 'Edit Category' : 'Add Category';

    if (id) {
      const cat = state.categories.find(c => c.id == id);
      if (cat) {
        $('cat-name').value        = cat.name || '';
        $('cat-description').value = cat.description || '';
        $('cat-order').value       = cat.sort_order || 0;
      }
    }
    openModal('category-modal');
  }

  $('open-category-modal')?.addEventListener('click', () => openCategoryModal());

  const categoryForm = $('category-form');
  if (categoryForm) {
    categoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('cat-name').value.trim();
      if (!name) { toast('Name is required.', 'error'); return; }
      setLoading('category-submit', true);
      const body = {
        name,
        description: $('cat-description').value.trim(),
        sort_order:  parseInt($('cat-order').value || '0', 10),
      };
      try {
        if (state.editCategoryId) {
          await api(`/api/admin/categories/${state.editCategoryId}`, { method: 'PUT', body: JSON.stringify(body) });
          toast('Category updated!', 'success');
        } else {
          await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(body) });
          toast('Category added!', 'success');
        }
        closeModal('category-modal');
        loadCategories();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading('category-submit', false);
      }
    });
  }

  function confirmDeleteCategory(id) {
    const cat = state.categories.find(c => c.id == id);
    $('confirm-text').textContent = `Delete category "${cat?.name || id}"?`;
    state.deleteCallback = () => deleteCategory(id);
    openModal('confirm-modal');
  }

  async function deleteCategory(id) {
    try {
      await api(`/api/admin/categories/${id}`, { method: 'DELETE', body: '{}' });
      toast('Category deleted.', 'success');
      loadCategories();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SETTINGS
  // ═══════════════════════════════════════════════════════════════════
  async function loadSettings() {
    try {
      const { data } = await api('/api/admin/settings');
      $('s-site-name').value  = data.site_name || '';
      $('s-tagline').value    = data.site_tagline || '';
      $('s-ig-handle').value  = data.instagram_handle || '';
      $('s-ig-url').value     = data.instagram_url || '';
    } catch (_) {}
  }

  const settingsForm = $('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        site_name:        $('s-site-name').value.trim(),
        site_tagline:     $('s-tagline').value.trim(),
        instagram_handle: $('s-ig-handle').value.trim(),
        instagram_url:    $('s-ig-url').value.trim(),
      };
      try {
        await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
        toast('Settings saved!', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ─── Utility: populate select ──────────────────────────────────────────────
  function populateSelect(selectId, items, placeholder) {
    const sel = $(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">— ${esc(placeholder)} —</option>`;
    items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      sel.appendChild(opt);
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  checkAuth();

})();
