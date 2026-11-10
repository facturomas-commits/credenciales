/* =========================================================
   Pequeños pasos, grandes trayectorias
   Visor interactivo de diapositivas — vanilla JS, sin build.
   ========================================================= */
(function () {
  'use strict';

  var DECK = window.DECK;
  if (!DECK || !DECK.slides || !DECK.slides.length) return;

  document.documentElement.classList.remove('no-js');

  var slides = DECK.slides;
  var total = slides.length;
  var chapters = DECK.chapters;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SLIDE_MS = 620;
  var AUTOPLAY_MS = 6500;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function setHash(hash, push) {
    try {
      if (push) history.pushState(null, '', hash);
      else history.replaceState(null, '', hash);
    } catch (e) { /* algunos navegadores bloquean history en file:// */ }
  }

  function slideSrc(n) { return 'assets/slides/' + pad(n) + '.webp'; }
  function slideThumb(n) { return 'assets/slides/thumbs/' + pad(n) + '.webp'; }
  function slideAura(n) { return 'assets/slides/aura/' + pad(n) + '.webp'; }

  var el = {
    cover: $('#cover'),
    coverHelpBtn: $('#coverHelpBtn'),
    startBtn: $('#startBtn'),
    coverGridBtn: $('#coverGridBtn'),
    coverCard: $('#coverCard'),
    deckstack: $('#deckstack'),

    viewer: $('#viewer'),
    stage: $('#stage'),
    pages: $('#pages'),
    imgA: $('#imgA'),
    imgB: $('#imgB'),
    ambientA: $('#ambientA'),
    ambientB: $('#ambientB'),

    backBtn: $('#backBtn'),
    chapterChip: $('#chapterChip'),
    chapterNum: $('#chapterNum'),
    chapterName: $('#chapterName'),
    shareBtn: $('#shareBtn'),
    soundBtn: $('#soundBtn'),
    fsBtn: $('#fsBtn'),
    helpBtn: $('#helpBtn'),
    closeBtn: $('#closeBtn'),

    edgePrev: $('#edgePrev'),
    edgeNext: $('#edgeNext'),
    prevBtn: $('#prevBtn'),
    nextBtn: $('#nextBtn'),
    curNum: $('#curNum'),
    totalNum: $('#totalNum'),
    progress: $('#progress'),
    playBtn: $('#playBtn'),
    playIcon: $('#playIcon'),
    filmBtn: $('#filmBtn'),
    gridBtnViewer: $('#gridBtnViewer'),
    console: $('#console'),
    autoplayBar: $('#autoplayBar'),

    filmstrip: $('#filmstrip'),
    filmTrack: $('#filmTrack'),
    overview: $('#overview'),
    overviewBody: $('#overviewBody'),
    overviewClose: $('#overviewClose'),
    helpModal: $('#helpModal'),
    videoModal: $('#videoModal'),
    cierreVideo: $('#cierreVideo'),
    videoPill: $('#videoPill'),
    stageCaption: $('.stage-caption'),
    captionChapter: $('#captionChapter'),
    captionTitle: $('#captionTitle'),
    toast: $('#toast'),
    live: $('#live'),
    stageHint: $('#stageHint'),
    boot: $('#boot'),
    bootBar: $('#bootBar'),
    bootHint: $('#bootHint')
  };

  var pages = [
    { root: el.pages.children[0], img: el.imgA, index: -1, token: 0 },
    { root: el.pages.children[1], img: el.imgB, index: -1, token: 0 }
  ];
  var active = pages[0];
  var standby = pages[1];

  var state = {
    started: false,
    index: 0,
    animating: false,
    pending: null,
    autoplay: false,
    filmstrip: false,
    overview: false,
    zoomed: false,
    sound: false,
    dragging: null,
    lastChapter: -1,
    interacted: false
  };

  var ambientLayer = el.ambientA;
  var segments = [];
  var autoTimer = null;
  var autoAnim = null;
  var idleTimer = null;
  var lastPoke = 0;
  var toastTimer = null;
  var chapterTimer = null;
  var wheelLock = false;
  var zoom = { scale: 1, tx: 0, ty: 0 };
  var preloaded = {};
  var baseTitle = document.title;

  /* ---------------------------------------------------------
     Preferencias
     --------------------------------------------------------- */
  try {
    state.sound = localStorage.getItem('pp-sound') === '1';
    if (localStorage.getItem('pp-hint') === '1') el.stageHint.dataset.seen = '1';
  } catch (e) { /* modo privado */ }

  /* ---------------------------------------------------------
     Ambiente (fondo desenfocado que sigue a la diapositiva)
     --------------------------------------------------------- */
  function setAmbient(n) {
    var next = ambientLayer === el.ambientA ? el.ambientB : el.ambientA;
    next.style.backgroundImage = 'url("' + slideAura(n) + '")';
    next.classList.add('is-on');
    ambientLayer.classList.remove('is-on');
    ambientLayer = next;
  }

  /* ---------------------------------------------------------
     Carga de imágenes
     --------------------------------------------------------- */
  function loadInto(page, i) {
    var token = ++page.token;
    var slide = slides[i];
    var loader = page.root.querySelector('[data-loader]');
    loader.classList.remove('is-done');

    return new Promise(function (resolve) {
      var img = page.img;
      var settled = false;

      function done() {
        if (settled || token !== page.token) return;
        settled = true;
        loader.classList.add('is-done');
        page.index = i;
        resolve();
      }

      function fail() {
        if (settled || token !== page.token) return;
        settled = true;
        loader.classList.add('is-done');
        page.index = i;
        resolve();
      }

      img.onload = done;
      img.onerror = fail;
      img.src = slideSrc(slide.n);
      img.alt = 'Diapositiva ' + slide.n + ': ' + slide.title + '. ' + slide.sub;

      if (img.complete && img.naturalWidth) done();
      setTimeout(fail, 4500);
    });
  }

  function preload(i) {
    if (i < 0 || i >= total || preloaded[i]) return;
    preloaded[i] = true;
    var im = new Image();
    im.src = slideSrc(slides[i].n);
  }

  function prime(i) {
    preload(i - 1);
    preload(i + 1);
    preload(i + 2);
  }

  /* ---------------------------------------------------------
     Tamaño del "papel"
     --------------------------------------------------------- */
  function sizePages() {
    var stage = el.stage;
    var cs = getComputedStyle(stage);
    var capH = 0;
    if (el.stageCaption && getComputedStyle(el.stageCaption).display !== 'none') {
      capH = el.stageCaption.offsetHeight + 14;
    }
    var availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
    var availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4 - capH;
    if (availW <= 0 || availH <= 0) return;

    var w = Math.min(availW, availH * (16 / 9), 1920);
    var h = w * (9 / 16);

    el.pages.style.setProperty('--pw', w + 'px');
    el.pages.style.setProperty('--ph', h + 'px');
  }

  /* ---------------------------------------------------------
     Interfaz: segmentos, miniaturas, vista general
     --------------------------------------------------------- */
  function buildProgress() {
    var frag = document.createDocumentFragment();
    slides.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'seg';
      b.type = 'button';
      b.setAttribute('aria-label', 'Ir a la diapositiva ' + s.n + ': ' + s.title);
      b.title = pad(s.n) + ' · ' + s.title;
      b.addEventListener('click', function () { goTo(i); });
      segments.push(b);
      frag.appendChild(b);
    });
    el.progress.appendChild(frag);
  }

  function hydrateThumbs(root) {
    var imgs = root.querySelectorAll('img[data-src]');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].src = imgs[i].getAttribute('data-src');
      imgs[i].removeAttribute('data-src');
    }
  }

  function buildFilmstrip() {
    var frag = document.createDocumentFragment();
    slides.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'filmcard';
      b.type = 'button';
      b.dataset.index = String(i);
      b.setAttribute('aria-label', 'Ir a la diapositiva ' + s.n);
      b.innerHTML = '<img loading="lazy" data-src="' + slideThumb(s.n) + '" alt="" width="520" height="292">' +
        '<span>' + pad(s.n) + '</span>';
      b.addEventListener('click', function () {
        closeFilmstrip();
        goTo(i);
      });
      frag.appendChild(b);
    });
    el.filmTrack.appendChild(frag);
  }

  function buildOverview() {
    var html = '';
    chapters.forEach(function (ch, ci) {
      var items = slides.filter(function (s) { return s.chapter === ci; });
      if (!items.length) return;
      html += '<section class="ovchapter">';
      html += '<div class="overview__chapter"><span>' + pad(ci + 1) + '</span><h3>' + ch.name + '</h3>' +
        '<span>' + items.length + (items.length === 1 ? ' diapositiva' : ' diapositivas') + '</span></div>';
      html += '<div class="ovgrid">';
      items.forEach(function (s) {
        var i = s.n - 1;
        html += '<button class="ovcard" type="button" data-index="' + i + '" aria-label="Ir a la diapositiva ' + s.n + ': ' + s.title + '">' +
          '<span class="ovcard__thumb"><img loading="lazy" data-src="' + slideThumb(s.n) + '" alt="" width="520" height="292">' +
          '<span class="ovcard__num">' + pad(s.n) + '</span></span>' +
          '<span class="ovcard__title">' + s.title + '</span></button>';
      });
      html += '</div></section>';
    });
    el.overviewBody.innerHTML = html;
  }

  function updateOverviewActive() {
    var cards = el.overviewBody.querySelectorAll('.ovcard');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('is-active', Number(cards[i].dataset.index) === state.index);
    }
  }

  function updateFilmstripActive(center) {
    var items = el.filmTrack.children;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', i === state.index);
    }
    if (center && state.filmstrip && items[state.index]) {
      var item = items[state.index];
      var left = item.offsetLeft - el.filmTrack.clientWidth / 2 + item.clientWidth / 2;
      el.filmTrack.scrollTo({ left: left, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  /* ---------------------------------------------------------
     Actualizar todo lo visible
     --------------------------------------------------------- */
  function updateUI() {
    var s = slides[state.index];

    el.curNum.textContent = pad(s.n);
    el.chapterNum.textContent = pad(s.chapter + 1);
    el.chapterName.textContent = chapters[s.chapter].name;

    segments.forEach(function (seg, i) {
      seg.classList.toggle('is-done', i < state.index);
      seg.classList.toggle('is-current', i === state.index);
      if (i === state.index) seg.setAttribute('aria-current', 'true');
      else seg.removeAttribute('aria-current');
    });

    var first = state.index === 0;
    var last = state.index === total - 1;
    el.prevBtn.disabled = first;
    el.nextBtn.disabled = last;
    el.edgePrev.disabled = first;
    el.edgeNext.disabled = last;
    el.prevBtn.style.opacity = first ? '0.4' : '';
    el.nextBtn.style.opacity = last ? '0.4' : '';
    el.videoPill.hidden = s.n !== 34;

    el.live.textContent = 'Diapositiva ' + s.n + ' de ' + total + ': ' + s.title + '. ' + s.sub;
    document.title = pad(s.n) + '/' + total + ' · ' + s.title + ' — ' + DECK.meta.title;

    if (state.started) {
      var h = '#/d' + s.n;
      if (location.hash !== h) setHash(h, false);
    }

    if (el.captionTitle) {
      el.captionTitle.textContent = s.title;
      el.captionChapter.textContent = chapters[s.chapter].name;
    }

    setAmbient(s.n);
    updateFilmstripActive(true);
    if (state.overview) updateOverviewActive();

    if (s.chapter !== state.lastChapter) {
      state.lastChapter = s.chapter;
      el.chapterChip.classList.add('is-new');
      clearTimeout(chapterTimer);
      chapterTimer = setTimeout(function () { el.chapterChip.classList.remove('is-new'); }, 1800);
    }

    prime(state.index);
  }

  /* ---------------------------------------------------------
     Navegación
     --------------------------------------------------------- */
  function springBack() {
    var page = active;
    var fromOpacity = page.root.style.opacity || '1';
    var fromTransform = page.root.style.transform || 'none';
    var anim = page.root.animate(
      [
        { transform: fromTransform, opacity: fromOpacity },
        { transform: 'none', opacity: 1 }
      ],
      { duration: reduced ? 1 : 420, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
    anim.onfinish = function () {
      page.root.style.transform = '';
      page.root.style.opacity = '';
      page.root.style.transition = '';
    };
  }

  function goTo(i) {
    if (i === state.index) return;
    navigate(i, {});
  }

  async function navigate(target, opts) {
    opts = opts || {};
    if (target < 0 || target >= total) return;

    if (state.animating) {
      state.pending = { target: target, opts: opts };
      return;
    }
    if (target === state.index) return;

    var dir = opts.dir || (target > state.index ? 1 : -1);
    var outgoing = active;
    var incoming = standby;
    var fromDrag = typeof opts.dragFrom === 'number';

    state.animating = true;
    clearTimeout(autoTimer);
    if (autoAnim) { autoAnim.cancel(); autoAnim = null; }

    if (state.zoomed) resetZoom(true);

    var loaded = loadInto(incoming, target);
    if (incoming.index !== target) incoming.index = target;

    incoming.root.classList.remove('is-active');
    incoming.root.classList.add('is-standby');
    incoming.root.style.zIndex = '2';
    outgoing.root.style.zIndex = '1';
    incoming.root.style.transform = '';
    incoming.root.style.opacity = '';

    if (state.sound) whoosh();

    await Promise.race([loaded, wait(reduced ? 40 : 700)]);

    var outFrom = { transform: 'none', opacity: 1 };
    if (fromDrag) {
      outFrom.transform = outgoing.root.style.transform || 'none';
      outFrom.opacity = outgoing.root.style.opacity || '1';
    }

    var duration = reduced ? 1 : SLIDE_MS;
    var outAnim = outgoing.root.animate(
      [
        outFrom,
        { transform: 'translateX(' + (-105 * dir) + '%) rotateY(' + (10 * dir) + 'deg) scale(.94)', opacity: 0 }
      ],
      { duration: duration, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' }
    );

    var inAnim = incoming.root.animate(
      [
        { transform: 'translateX(' + (24 * dir) + '%) rotateY(' + (-7 * dir) + 'deg) scale(.97)', opacity: 0 },
        { transform: 'none', opacity: 1 }
      ],
      { duration: reduced ? 1 : duration + 60, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' }
    );

    outgoing.root.style.transform = '';
    outgoing.root.style.opacity = '';
    outgoing.root.style.transition = '';

    state.index = target;
    updateUI();
    setTimeout(poke, 0);

    await Promise.all([outAnim.finished.catch(function () {}), inAnim.finished.catch(function () {})]);

    incoming.root.classList.add('is-active');
    incoming.root.classList.remove('is-standby');
    outgoing.root.classList.add('is-standby');
    outgoing.root.classList.remove('is-active');

    outAnim.cancel();
    inAnim.cancel();
    incoming.root.style.transform = '';
    incoming.root.style.opacity = '';
    incoming.root.style.zIndex = '';
    outgoing.root.style.zIndex = '';
    outgoing.root.style.transform = '';
    outgoing.root.style.opacity = '';

    var tmp = active;
    active = incoming;
    standby = tmp;
    standby.index = -1;

    state.animating = false;

    if (state.autoplay) scheduleAuto();

    var pending = state.pending;
    state.pending = null;
    if (pending) navigate(pending.target, pending.opts);
  }

  function next() { if (!el.nextBtn.disabled) navigate(state.index + 1, {}); }
  function prev() { if (!el.prevBtn.disabled) navigate(state.index - 1, {}); }

  /* ---------------------------------------------------------
     Reproducción automática
     --------------------------------------------------------- */
  function setPlayingUI(on) {
    el.playBtn.classList.toggle('is-on', on);
    el.playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.console.classList.toggle('is-playing', on);
    el.playIcon.innerHTML = '<use href="#' + (on ? 'i-pause' : 'i-play') + '"/>';
    el.playBtn.querySelector('.cbtn__label').textContent = on ? 'Pausa' : 'Auto';
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (autoAnim) { autoAnim.cancel(); autoAnim = null; }
    if (!state.autoplay) return;

    el.autoplayBar.style.transform = 'scaleX(0)';
    autoAnim = el.autoplayBar.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: AUTOPLAY_MS, easing: 'linear', fill: 'forwards' }
    );

    autoTimer = setTimeout(function () {
      if (!state.autoplay) return;
      if (state.index >= total - 1) {
        stopAutoplay();
        toast('Fin de la presentación · ¡gracias por hojear!');
        poke();
        return;
      }
      navigate(state.index + 1, { dir: 1, auto: true });
    }, AUTOPLAY_MS);
  }

  function startAutoplay() {
    state.autoplay = true;
    setPlayingUI(true);
    scheduleAuto();
    poke();
  }

  function stopAutoplay() {
    state.autoplay = false;
    clearTimeout(autoTimer);
    if (autoAnim) { autoAnim.cancel(); autoAnim = null; }
    el.autoplayBar.style.transform = 'scaleX(0)';
    setPlayingUI(false);
  }

  function toggleAutoplay() {
    if (state.autoplay) stopAutoplay();
    else startAutoplay();
  }

  /* ---------------------------------------------------------
     Zoom
     --------------------------------------------------------- */
  function resetZoom(silent) {
    var root = active.root;
    var img = active.img;
    img.style.transform = '';
    img.style.transformOrigin = '';
    root.classList.remove('is-zoomed');
    zoom = { scale: 1, tx: 0, ty: 0 };
    state.zoomed = false;
    if (!silent) toast('Zoom desactivado');
  }

  function toggleZoom(e) {
    if (state.overview || anyOverlay() || state.animating) return;
    if (state.zoomed) { resetZoom(); return; }

    var root = active.root;
    var rect = root.getBoundingClientRect();
    var x = e ? clamp(((e.clientX - rect.left) / rect.width) * 100, 8, 92) : 50;
    var y = e ? clamp(((e.clientY - rect.top) / rect.height) * 100, 8, 92) : 50;
    var scale = 2.2;

    active.img.style.transformOrigin = x + '% ' + y + '%';
    active.img.style.transform = 'scale(' + scale + ')';
    root.classList.add('is-zoomed');
    zoom = { scale: scale, tx: 0, ty: 0 };
    state.zoomed = true;
    toast('Zoom · arrastrá para mover · Esc para salir');
  }

  function panZoom(tx, ty) {
    var rect = active.root.getBoundingClientRect();
    var maxX = rect.width * (zoom.scale - 1) * 0.5;
    var maxY = rect.height * (zoom.scale - 1) * 0.5;
    zoom.tx = clamp(tx, -maxX, maxX);
    zoom.ty = clamp(ty, -maxY, maxY);
    active.img.style.transform = 'translate(' + zoom.tx + 'px,' + zoom.ty + 'px) scale(' + zoom.scale + ')';
  }

  /* ---------------------------------------------------------
     Arrastrar para hojear
     --------------------------------------------------------- */
  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, a, video')) return;
    if (!state.started || state.overview || anyOverlay() || state.animating) return;

    if (state.zoomed) {
      state.dragging = {
        mode: 'pan',
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        tx: zoom.tx,
        ty: zoom.ty,
        moved: false
      };
      el.stage.setPointerCapture(e.pointerId);
      return;
    }

    state.dragging = {
      mode: 'slide',
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
      dx: 0,
      active: false
    };
    el.stage.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    var d = state.dragging;
    if (!d || d.id !== e.pointerId) return;

    if (d.mode === 'pan') {
      e.preventDefault();
      panZoom(d.tx + (e.clientX - d.x), d.ty + (e.clientY - d.y));
      return;
    }

    var dx = e.clientX - d.x;
    var dy = e.clientY - d.y;

    if (!d.active) {
      if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy)) {
        d.active = true;
        el.stage.classList.add('is-dragging');
        active.root.style.transition = 'none';
        if (navigator.vibrate) navigator.vibrate(4);
      } else if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
        state.dragging = null;
        return;
      }
    }

    if (d.active) {
      e.preventDefault();
      d.dx = dx;
      var w = el.pages.clientWidth || 1;
      var damped = Math.sign(dx) * Math.min(Math.abs(dx) * 0.82, w * 0.55);
      active.root.style.transform = 'translateX(' + damped + 'px) rotateY(' + (damped * -0.012) + 'deg)';
      active.root.style.opacity = String(1 - Math.min(Math.abs(damped) / w, 0.3));
    }
  }

  function onPointerUp(e) {
    var d = state.dragging;
    if (!d || d.id !== e.pointerId) return;
    state.dragging = null;
    el.stage.classList.remove('is-dragging');

    if (d.mode === 'pan') return;
    if (!d.active) return;

    var dx = d.dx;
    var dt = Date.now() - d.time;
    var w = el.pages.clientWidth || 1;
    var threshold = Math.min(130, w * 0.12);
    var flick = Math.abs(dx) > 45 && dt < 320;

    active.root.style.transition = '';

    if ((Math.abs(dx) > threshold || flick) && Math.abs(dx) > 30) {
      var dir = dx < 0 ? 1 : -1;
      var target = state.index + dir;
      if (target < 0 || target >= total) {
        springBack();
        return;
      }
      navigate(target, { dir: dir, dragFrom: dx });
    } else {
      springBack();
    }
  }

  /* ---------------------------------------------------------
     Vista general / tira de miniaturas
     --------------------------------------------------------- */
  function openOverview() {
    if (!state.started || state.overview) return;
    if (state.autoplay) stopAutoplay();
    closeFilmstrip(true);
    state.overview = true;
    el.overview.hidden = false;
    hydrateThumbs(el.overviewBody);
    el.viewer.classList.add('is-overlay');
    el.toast.classList.remove('is-visible');
    requestAnimationFrame(function () {
      el.overview.classList.add('is-open');
    });
    updateOverviewActive();
    var current = el.overviewBody.querySelector('.ovcard.is-active');
    var section = current ? current.closest('.ovchapter') : null;
    var heading = section ? section.querySelector('.overview__chapter') : null;
    if (heading) {
      setTimeout(function () {
        heading.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      }, 80);
    }
    el.overviewClose.focus({ preventScroll: true });
  }

  function closeOverview() {
    if (!state.overview) return;
    state.overview = false;
    el.overview.classList.remove('is-open');
    el.viewer.classList.remove('is-overlay');
    setTimeout(function () {
      if (!state.overview) el.overview.hidden = true;
    }, 350);
    poke();
  }

  function toggleOverview() {
    if (state.overview) closeOverview();
    else openOverview();
  }

  function openFilmstrip() {
    if (state.filmstrip || !state.started) return;
    if (state.autoplay) stopAutoplay();
    state.filmstrip = true;
    el.filmstrip.hidden = false;
    hydrateThumbs(el.filmTrack);
    el.filmBtn.classList.add('is-on');
    el.filmBtn.setAttribute('aria-pressed', 'true');
    requestAnimationFrame(function () {
      el.filmstrip.classList.add('is-open');
    });
    updateFilmstripActive(true);
    poke();
  }

  function closeFilmstrip(silent) {
    if (!state.filmstrip) return;
    state.filmstrip = false;
    el.filmstrip.classList.remove('is-open');
    el.filmBtn.classList.remove('is-on');
    el.filmBtn.setAttribute('aria-pressed', 'false');
    setTimeout(function () {
      if (!state.filmstrip) el.filmstrip.hidden = true;
    }, 350);
    if (!silent) poke();
  }

  function toggleFilmstrip() {
    if (state.filmstrip) closeFilmstrip();
    else openFilmstrip();
  }

  /* ---------------------------------------------------------
     Modales
     --------------------------------------------------------- */
  var openModalEl = null;
  var lastFocus = null;

  function openModal(node, onOpen) {
    if (openModalEl) closeModal(true);
    lastFocus = document.activeElement;
    openModalEl = node;
    node.hidden = false;
    requestAnimationFrame(function () { node.classList.add('is-open'); });
    el.viewer.classList.add('is-overlay');
    var focusTarget = node.querySelector('[data-close-modal], button, video');
    if (focusTarget) setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, 120);
    if (onOpen) onOpen();
  }

  function closeModal(instant) {
    if (!openModalEl) return;
    var node = openModalEl;
    openModalEl = null;
    node.classList.remove('is-open');
    el.viewer.classList.remove('is-overlay');
    if (!instant) {
      setTimeout(function () {
        if (!openModalEl) node.hidden = true;
      }, 300);
    } else {
      node.hidden = true;
    }
    if (el.cierreVideo) {
      try { el.cierreVideo.pause(); } catch (e) { /* noop */ }
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    poke();
  }

  function anyOverlay() {
    return !!(openModalEl || state.overview);
  }

  function openHelp() {
    if (state.started) { stopAutoplay(); }
    openModal(el.helpModal);
  }

  function openVideo() {
    if (state.autoplay) stopAutoplay();
    openModal(el.videoModal, function () {
      try {
        el.cierreVideo.currentTime = 0;
        var p = el.cierreVideo.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* noop */ }
    });
  }

  /* ---------------------------------------------------------
     Arrancar / volver a la portada
     --------------------------------------------------------- */
  async function start(index, opts) {
    opts = opts || {};
    if (state.started) {
      if (typeof index === 'number' && index !== state.index) navigate(index, {});
      return;
    }

    index = clamp(index || 0, 0, total - 1);
    state.started = true;
    state.lastChapter = -1;

    el.cover.classList.add('is-leaving');
    el.viewer.hidden = false;
    sizePages();

    var ready = loadInto(active, index);
    if (!opts.instant) await Promise.race([ready, wait(420)]);

    state.index = index;
    active.root.classList.add('is-active');
    active.root.classList.remove('is-standby');
    standby.root.classList.add('is-standby');
    standby.root.classList.remove('is-active');

    // historial
    var hash = '#/d' + slides[index].n;
    if (opts.instant || location.hash === hash) setHash(hash, false);
    else setHash(hash, true);

    updateUI();
    void el.viewer.offsetWidth;
    el.viewer.classList.add('is-active');

    setTimeout(function () {
      if (state.started) el.cover.style.visibility = 'hidden';
    }, 600);

    poke();
    showHintOnce();
    preload(index + 1);
    preload(index + 2);
  }

  function showCover() {
    if (!state.started) return;
    stopAutoplay();
    resetZoom(true);
    closeOverview();
    closeFilmstrip(true);
    closeModal(true);
    state.started = false;

    el.viewer.classList.remove('is-active');
    el.cover.style.visibility = '';
    el.cover.classList.remove('is-leaving');
    setTimeout(function () {
      if (!state.started) el.viewer.hidden = true;
    }, 650);

    el.viewer.classList.remove('is-idle');
    document.title = baseTitle;

    if (location.hash) setHash(location.pathname + location.search, false);
  }

  /* ---------------------------------------------------------
     Utilidades de interfaz
     --------------------------------------------------------- */
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-visible'); }, 2600);
  }

  function showHintOnce() {
    if (el.stageHint.dataset.seen === '1') return;
    el.stageHint.dataset.seen = '1';
    try { localStorage.setItem('pp-hint', '1'); } catch (e) { /* noop */ }
    setTimeout(function () { el.stageHint.classList.add('is-visible'); }, 900);
    setTimeout(function () { el.stageHint.classList.remove('is-visible'); }, 6200);
  }

  function poke() {
    if (!state.started) return;
    var now = Date.now();
    if (now - lastPoke < 90) return;
    lastPoke = now;
    el.viewer.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (!state.interacted && !state.autoplay) return;
    idleTimer = setTimeout(function () {
      if (!state.started) return;
      if (anyOverlay() || state.filmstrip) return;
      el.viewer.classList.add('is-idle');
    }, state.autoplay ? 2600 : 3400);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      var req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      if (req) {
        var p = req.call(document.documentElement);
        if (p && p.catch) p.catch(function () { toast('Tu navegador no permite pantalla completa'); });
      } else {
        toast('Tu navegador no permite pantalla completa');
      }
    } else {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  }

  function updateFullscreenUI() {
    var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    el.fsBtn.classList.toggle('is-on', isFs);
    el.fsBtn.innerHTML = '<svg class="icon"><use href="#' + (isFs ? 'i-compress' : 'i-expand') + '"/></svg>';
  }

  function toggleSound() {
    state.sound = !state.sound;
    el.soundBtn.classList.toggle('is-on', state.sound);
    el.soundBtn.setAttribute('aria-pressed', state.sound ? 'true' : 'false');
    el.soundBtn.innerHTML = '<svg class="icon"><use href="#' + (state.sound ? 'i-volume' : 'i-mute') + '"/></svg>';
    try { localStorage.setItem('pp-sound', state.sound ? '1' : '0'); } catch (e) { /* noop */ }
    if (state.sound) {
      initAudio();
      whoosh();
      toast('Sonido de página activado');
    } else {
      toast('Sonido desactivado');
    }
  }

  var audioCtx = null;
  function initAudio() {
    if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
  }

  function whoosh() {
    if (!state.sound) return;
    initAudio();
    if (!audioCtx) return;
    var dur = 0.34;
    var rate = audioCtx.sampleRate;
    var buffer = audioCtx.createBuffer(1, Math.floor(dur * rate), rate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      var t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * 0.55;
    }
    var src = audioCtx.createBufferSource();
    src.buffer = buffer;
    var filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(700, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2600, audioCtx.currentTime + dur);
    var gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, audioCtx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start();
  }

  function copyLink() {
    var url = location.href.split('#')[0] + '#/d' + slides[state.index].n;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        toast('Enlace copiado');
      }).catch(function () {
        window.prompt('Copiá el enlace a esta diapositiva:', url);
      });
    } else {
      window.prompt('Copiá el enlace a esta diapositiva:', url);
    }
  }

  /* ---------------------------------------------------------
     Eventos
     --------------------------------------------------------- */
  function bind() {
    el.startBtn.addEventListener('click', function () { start(0); });
    el.coverCard.addEventListener('click', function () { start(0); });
    el.coverGridBtn.addEventListener('click', function () { start(0).then(function () { openOverview(); }); });
    el.coverHelpBtn.addEventListener('click', openHelp);
    $('#coverBrand').addEventListener('click', function (e) { e.preventDefault(); });

    el.backBtn.addEventListener('click', showCover);
    el.closeBtn.addEventListener('click', showCover);
    el.prevBtn.addEventListener('click', prev);
    el.nextBtn.addEventListener('click', next);
    el.edgePrev.addEventListener('click', prev);
    el.edgeNext.addEventListener('click', next);
    el.playBtn.addEventListener('click', toggleAutoplay);
    el.filmBtn.addEventListener('click', toggleFilmstrip);
    el.gridBtnViewer.addEventListener('click', toggleOverview);
    el.chapterChip.addEventListener('click', toggleOverview);
    el.shareBtn.addEventListener('click', copyLink);
    el.soundBtn.addEventListener('click', toggleSound);
    el.fsBtn.addEventListener('click', toggleFullscreen);
    el.helpBtn.addEventListener('click', openHelp);
    el.videoPill.addEventListener('click', openVideo);
    el.overviewClose.addEventListener('click', closeOverview);

    el.overviewBody.addEventListener('click', function (e) {
      var card = e.target.closest('.ovcard');
      if (!card) return;
      var i = Number(card.dataset.index);
      closeOverview();
      if (i === state.index) return;
      setTimeout(function () { navigate(i, {}); }, 60);
    });

    document.querySelectorAll('[data-close-modal]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(); });
    });

    [el.helpModal, el.videoModal].forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m) closeModal();
      });
    });

    // pointer / drag
    el.stage.addEventListener('pointerdown', onPointerDown);
    el.stage.addEventListener('pointermove', onPointerMove);
    el.stage.addEventListener('pointerup', onPointerUp);
    el.stage.addEventListener('pointercancel', onPointerUp);

    el.stage.addEventListener('dblclick', function (e) {
      if (e.target.closest('button')) return;
      e.preventDefault();
      toggleZoom(e);
    });

    // wheel
    el.stage.addEventListener('wheel', function (e) {
      if (state.overview || anyOverlay() || state.zoomed) return;
      if (Math.abs(e.deltaY) < 10) return;
      e.preventDefault();
      if (wheelLock || state.animating) return;
      wheelLock = true;
      setTimeout(function () { wheelLock = false; }, 420);
      if (e.deltaY > 0) next();
      else prev();
    }, { passive: false });

    // teclado
    document.addEventListener('keydown', onKey);

    // idle
    document.addEventListener('pointermove', function () {
      if (!state.started) return;
      state.interacted = true;
      poke();
    }, { passive: true });
    document.addEventListener('pointerdown', function () { state.interacted = true; }, true);
    document.addEventListener('keydown', function () {
      state.interacted = true;
      if (state.started) poke();
    }, true);
    document.addEventListener('pointerleave', function () {
      if (state.started && !anyOverlay() && !state.filmstrip) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { el.viewer.classList.add('is-idle'); }, 1200);
      }
    });

    // fullscreen
    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

    // historial
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', function () {
      var i = parseHash();
      if (i === null) return;
      if (!state.started) start(i, { instant: true });
      else if (i !== state.index) navigate(i, { dir: i > state.index ? 1 : -1 });
    });

    // resize
    var resizeRaf = null;
    window.addEventListener('resize', function () {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(function () {
        sizePages();
        if (state.zoomed) resetZoom(true);
      });
    });

    // pausar autoplay si la pestaña queda oculta
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.autoplay) {
        clearTimeout(autoTimer);
        if (autoAnim) autoAnim.pause();
      } else if (!document.hidden && state.autoplay) {
        if (autoAnim) autoAnim.play();
        clearTimeout(autoTimer);
        autoTimer = setTimeout(function () {
          if (state.index >= total - 1) { stopAutoplay(); return; }
          navigate(state.index + 1, { dir: 1, auto: true });
        }, Math.max(800, AUTOPLAY_MS * 0.4));
      }
    });

    el.cierreVideo.addEventListener('ended', function () { closeModal(); });

    window.addEventListener('beforeunload', function () {
      if (openModalEl) closeModal(true);
    });
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var isTyping = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '');
    if (isTyping) return;

    var key = e.key;
    var onButton = !!(e.target.closest && e.target.closest('button, a'));

    if (openModalEl) {
      if (key === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }

    if (!state.started) {
      if (key === 'Enter' || key === ' ' || key === 'ArrowRight') {
        if (onButton && (key === 'Enter' || key === ' ')) return;
        e.preventDefault();
        start(0);
      } else if (key === '?' || key === 'h' || key === 'H') {
        e.preventDefault();
        openHelp();
      } else if (key === 'g' || key === 'G') {
        e.preventDefault();
        start(0).then(function () { openOverview(); });
      }
      return;
    }

    if (state.overview) {
      if (key === 'Escape' || key === 'g' || key === 'G') { e.preventDefault(); closeOverview(); }
      return;
    }

    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        if (key === ' ' && onButton) return;
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        prev();
        break;
      case 'Home':
        e.preventDefault();
        navigate(0, { dir: -1 });
        break;
      case 'End':
        e.preventDefault();
        navigate(total - 1, { dir: 1 });
        break;
      case 'Escape':
        e.preventDefault();
        if (state.zoomed) resetZoom();
        else if (state.filmstrip) closeFilmstrip();
        else showCover();
        break;
      case 'g':
      case 'G':
        e.preventDefault();
        toggleOverview();
        break;
      case 't':
      case 'T':
        e.preventDefault();
        toggleFilmstrip();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'p':
      case 'P':
        e.preventDefault();
        toggleAutoplay();
        break;
      case 'z':
      case 'Z':
        e.preventDefault();
        toggleZoom(null);
        break;
      case '?':
      case 'h':
      case 'H':
        e.preventDefault();
        openHelp();
        break;
      default:
        break;
    }
  }

  function parseHash() {
    var m = /^#\/d(\d{1,2})$/.exec(location.hash);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (n < 1 || n > total) return null;
    return n - 1;
  }

  function onPopState() {
    var i = parseHash();
    if (i === null) {
      if (state.started) showCover();
      return;
    }
    if (!state.started) start(i, { instant: true });
    else if (i !== state.index) navigate(i, { dir: i > state.index ? 1 : -1 });
  }

  /* ---------------------------------------------------------
     Arranque
     --------------------------------------------------------- */
  function boot() {
    el.totalNum.textContent = String(total);
    buildProgress();
    buildFilmstrip();
    buildOverview();
    bind();
    sizePages();
    updateFullscreenUI();

    el.soundBtn.classList.toggle('is-on', state.sound);
    el.soundBtn.setAttribute('aria-pressed', state.sound ? 'true' : 'false');
    if (state.sound) el.soundBtn.innerHTML = '<svg class="icon"><use href="#i-volume"/></svg>';

    // fondo inicial + primera diapositiva lista
    setAmbient(slides[0].n);
    loadInto(active, 0);
    preload(1);
    preload(2);

    var progress = 20;
    el.bootBar.style.width = progress + '%';
    document.fonts && document.fonts.ready.then(function () {
      progress = 55;
      el.bootBar.style.width = progress + '%';
    });

    window.addEventListener('load', function () {
      el.bootBar.style.width = '100%';
      setTimeout(finishBoot, 380);
    });

    setTimeout(function () {
      el.bootBar.style.width = '100%';
      finishBoot();
    }, 2600);

    function finishBoot() {
      if (el.boot.classList.contains('is-done')) return;
      el.boot.classList.add('is-done');
      el.boot.setAttribute('aria-hidden', 'true');
      var i = parseHash();
      if (i !== null) start(i, { instant: true });
      idlePreload();
    }
  }

  function idlePreload() {
    var i = 3;
    var runner = function (deadline) {
      var guard = 0;
      while (i < total && guard < 4) {
        if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 4) break;
        var j = i++;
        preloaded[j] = true;
        var im = new Image();
        im.src = slideSrc(slides[j].n);
        guard++;
      }
      if (i < total) {
        if (window.requestIdleCallback) requestIdleCallback(runner, { timeout: 1800 });
        else setTimeout(function () { runner(null); }, 400);
      }
    };
    if (window.requestIdleCallback) requestIdleCallback(runner, { timeout: 1500 });
    else setTimeout(function () { runner(null); }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
