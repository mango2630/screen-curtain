/*
 * 幕帘 · content script
 * 在页面中创建 Shadow DOM 遮罩层，负责渲染、拖动、缩放与状态同步。
 */
(function () {
  'use strict';

  if (window.__screenCurtainLoaded) return;
  window.__screenCurtainLoaded = true;

  var C = window.CURTAIN;
  if (!C) return;

  var HOSTNAME = location.hostname || 'local';
  var SNAP_PX = 8;
  var GRIP_SAFE_TOP = 84;
  var MEDIA_TAGS = { VIDEO: 1, AUDIO: 1, IMG: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1 };

  var site = C.defaultSite();
  var persisted = false;
  var editMode = false;
  var practiceMode = false;
  var peekMode = false;
  var selectedId = null;
  var lastSavedJSON = '';
  var clearArmed = false;
  var clearTimer = null;
  var seekToastTimer = null;
  var mediaCache = { el: null, at: 0 };
  var inkPaletteOpen = false;
  var inkSelection = null;
  var savedPracticeRange = null;

  var INK_COLORS = [
    { color: 'auto', label: '自动（跟随遮罩对比色）' },
    { color: '#ef4444', label: '红色' },
    { color: '#f97316', label: '橙色' },
    { color: '#eab308', label: '黄色' },
    { color: '#22c55e', label: '绿色' },
    { color: '#3b82f6', label: '蓝色' },
    { color: '#a855f7', label: '紫色' },
    { color: '#ec4899', label: '粉色' }
  ];

  var root = null;
  var shadow = null;
  var layer = null;
  var sheet = null;
  var drag = null;
  var saveTimer = null;
  var resizeTimer = null;
  var mountTimer = null;
  var bootPromise = null;

  var CSS = [
    ':host { all: initial; }',
    '.layer {',
    '  position: absolute; inset: 0; pointer-events: none;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;',
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '.mask { position: absolute; box-sizing: border-box; pointer-events: none; z-index: 2; transition: opacity 140ms ease; }',
    '.mask.is-editing { pointer-events: auto; cursor: move; touch-action: none; }',
    '.mask.is-selected { z-index: 3; }',
    '.surface {',
    '  position: absolute; inset: 0; box-sizing: border-box;',
    '  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;',
    '  transition: box-shadow 120ms ease;',
    '}',
    '.mask.is-editing .surface { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.32); }',
    '.mask.is-editing.is-selected .surface {',
    '  box-shadow: 0 0 0 1.5px #a78bfa, 0 0 0 4px rgba(124, 92, 255, 0.22), 0 10px 30px rgba(0, 0, 0, 0.35);',
    '}',
    '.mask.is-dragging .surface { box-shadow: 0 0 0 1.5px #c4b5fd, 0 0 0 6px rgba(124, 92, 255, 0.18); }',
    '.handle {',
    '  position: absolute; display: none; width: 12px; height: 12px; box-sizing: border-box;',
    '  background: #ffffff; border: 1.5px solid #7c5cff; border-radius: 3px;',
    '  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); z-index: 4; touch-action: none;',
    '}',
    '.mask.is-editing.is-selected .handle { display: block; }',
    '.handle[data-dir="n"] { top: -6px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }',
    '.handle[data-dir="s"] { bottom: -6px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }',
    '.handle[data-dir="e"] { right: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }',
    '.handle[data-dir="w"] { left: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }',
    '.handle[data-dir="ne"] { top: -6px; right: -6px; cursor: nesw-resize; }',
    '.handle[data-dir="nw"] { top: -6px; left: -6px; cursor: nwse-resize; }',
    '.handle[data-dir="se"] { bottom: -6px; right: -6px; cursor: nwse-resize; }',
    '.handle[data-dir="sw"] { bottom: -6px; left: -6px; cursor: nesw-resize; }',
    '.mask.flush-left .handle[data-dir="w"], .mask.flush-left .handle[data-dir="nw"], .mask.flush-left .handle[data-dir="sw"] { left: 0; }',
    '.mask.flush-right .handle[data-dir="e"], .mask.flush-right .handle[data-dir="ne"], .mask.flush-right .handle[data-dir="se"] { right: 0; }',
    '.mask.flush-top .handle[data-dir="n"], .mask.flush-top .handle[data-dir="nw"], .mask.flush-top .handle[data-dir="ne"] { top: 0; }',
    '.mask.flush-bottom .handle[data-dir="s"], .mask.flush-bottom .handle[data-dir="sw"], .mask.flush-bottom .handle[data-dir="se"] { bottom: 0; }',
    '.badge {',
    '  position: absolute; top: 8px; left: 8px; display: none; align-items: center; gap: 5px;',
    '  height: 22px; padding: 0 8px; border-radius: 6px; box-sizing: border-box;',
    '  background: rgba(12, 13, 18, 0.86); color: #f4f5f7; border: 1px solid rgba(255, 255, 255, 0.14);',
    '  font-size: 11px; line-height: 1; letter-spacing: 0.2px; font-variant-numeric: tabular-nums;',
    '  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); pointer-events: none; white-space: nowrap; z-index: 5;',
    '}',
    '.mask.is-editing.is-selected .badge { display: flex; }',
    '.mask.is-practicing { pointer-events: auto; cursor: text; }',
    '.mask.is-practicing.is-selected .surface { box-shadow: 0 0 0 1px rgba(94, 234, 212, 0.42); }',
    '.mask.is-practicing:focus-within .surface { box-shadow: 0 0 0 1.5px #5eead4, 0 0 0 5px rgba(94, 234, 212, 0.13); }',
    '.layer.is-peeking .mask { opacity: 0; pointer-events: none; }',
    '.mask-input, .mask-text {',
    '  position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box;',
    '  margin: 0; border: 0; outline: 0; background: transparent;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;',
    '  line-height: 1.5; letter-spacing: 0.01em; text-align: left;',
    '  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;',
    '}',
    '.mask-input { display: block; overflow-x: hidden; overflow-y: auto; pointer-events: auto; z-index: 2; }',
    '.mask-input div, .mask-input p { margin: 0; padding: 0; }',
    '.mask-placeholder {',
    '  position: absolute; inset: 0; z-index: 1; box-sizing: border-box;',
    '  overflow: hidden; pointer-events: none; opacity: 0.34;',
    '  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;',
    '}',
    '.practice-grip {',
    '  position: absolute; top: -22px; left: 50%; transform: translateX(-50%);',
    '  display: none; grid-template-columns: repeat(3, 3px); grid-template-rows: repeat(2, 3px);',
    '  gap: 2px; place-content: center;',
    '  width: 46px; height: 18px; box-sizing: border-box; border-radius: 6px;',
    '  background: rgba(10, 13, 18, 0.9); border: 1px solid rgba(94, 234, 212, 0.3);',
    '  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.28); cursor: grab; touch-action: none;',
    '  z-index: 6; pointer-events: auto;',
    '}',
    '.practice-grip.is-inside { top: 4px; left: auto; right: 8px; transform: none; }',
    '.mask.is-practicing.is-selected .practice-grip { display: grid; }',
    '.practice-grip span { width: 3px; height: 3px; border-radius: 50%; background: rgba(255, 255, 255, 0.66); flex: none; }',
    '.practice-grip:hover { background: rgba(16, 22, 26, 0.96); border-color: rgba(94, 234, 212, 0.6); }',
    '.practice-grip:active, .mask.is-dragging .practice-grip { cursor: grabbing; }',
    '.mask.is-dragging .surface { box-shadow: 0 0 0 1.5px rgba(94, 234, 212, 0.85), 0 0 0 5px rgba(94, 234, 212, 0.12); }',
    '.mask-input::placeholder { color: currentColor; opacity: 0.34; }',
    '.mask-input::selection { background: rgba(94, 234, 212, 0.35); }',
    '.mask-input::-webkit-scrollbar { width: 6px; }',
    '.mask-input::-webkit-scrollbar-thumb { background: currentColor; opacity: 0.2; border-radius: 6px; }',
    '.mask-text { overflow: hidden; pointer-events: none; }',
    '.practice-bar {',
    '  position: absolute; top: 16px; left: 50%; transform: translateX(-50%);',
    '  display: flex; align-items: center; gap: 7px; padding: 7px 8px 7px 12px;',
    '  max-width: calc(100vw - 32px); box-sizing: border-box; border-radius: 999px;',
    '  background: rgba(10, 13, 18, 0.96); color: #e8f7f4;',
    '  border: 1px solid rgba(94, 234, 212, 0.24); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);',
    '  font-size: 12px; line-height: 1.2; pointer-events: auto; z-index: 70;',
    '  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);',
    '}',
    '.practice-dot { width: 7px; height: 7px; border-radius: 50%; background: #5eead4; box-shadow: 0 0 0 3px rgba(94, 234, 212, 0.14); flex: none; }',
    '.practice-label { white-space: nowrap; color: #d9f7f2; font-weight: 500; letter-spacing: 0.02em; }',
    '.practice-seek { white-space: nowrap; color: #71908b; font-size: 10.5px; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }',
    '.practice-bar button {',
    '  appearance: none; -webkit-appearance: none; height: 24px; padding: 0 10px;',
    '  border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 999px;',
    '  background: rgba(255, 255, 255, 0.06); color: #ffffff; font: inherit; font-size: 12px;',
    '  cursor: pointer; white-space: nowrap; transition: background 120ms ease, border-color 120ms ease, color 120ms ease;',
    '}',
    '.practice-bar button:hover { background: rgba(255, 255, 255, 0.13); }',
    '.practice-bar button:focus-visible { outline: 2px solid #5eead4; outline-offset: 2px; }',
    '.practice-bar .practice-compare { background: rgba(94, 234, 212, 0.12); border-color: rgba(94, 234, 212, 0.3); color: #b9f6ea; }',
    '.practice-bar .practice-compare.is-active { background: #5eead4; border-color: #5eead4; color: #062a26; font-weight: 600; }',
    '.practice-bar .practice-clear.is-armed { color: #ffb4c0; border-color: rgba(255, 116, 136, 0.5); background: rgba(255, 116, 136, 0.1); }',
    '.practice-bar .practice-clear:disabled { opacity: 0.38; cursor: default; }',
    '.practice-ink { display: inline-flex; align-items: center; gap: 5px; }',
    '.ink-dot { width: 10px; height: 10px; flex: none; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.45); box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.12); }',
    '.ink-dot.is-auto { background: linear-gradient(135deg, #ffffff 0 48%, #0b0d12 52% 100%); }',
    '.ink-palette {',
    '  position: absolute; top: 60px; left: 50%; transform: translateX(-50%);',
    '  display: flex; align-items: center; gap: 7px; padding: 8px 10px;',
    '  border-radius: 999px; box-sizing: border-box;',
    '  background: rgba(10, 13, 18, 0.97); border: 1px solid rgba(255, 255, 255, 0.14);',
    '  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.48); z-index: 85;',
    '  pointer-events: auto; -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);',
    '}',
    '.ink-palette-label { margin-right: 2px; white-space: nowrap; color: #8b93a6; font-size: 10px; letter-spacing: 0.04em; }',
    '.ink-swatch { width: 19px; height: 19px; flex: none; padding: 0; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.24); cursor: pointer; }',
    '.ink-swatch:hover { transform: translateY(-1px); }',
    '.ink-swatch:focus-visible { outline: 2px solid #5eead4; outline-offset: 2px; }',
    '.ink-swatch.is-active { box-shadow: 0 0 0 2px rgba(10, 13, 18, 0.95), 0 0 0 3.5px #5eead4; }',
    '.ink-swatch.is-auto { background: linear-gradient(135deg, #ffffff 0 48%, #0b0d12 52% 100%); }',
    '.peek-panel {',
    '  position: absolute; top: 64px; left: 50%; transform: translateX(-50%);',
    '  width: min(760px, calc(100vw - 56px)); max-height: 38vh; overflow-y: auto;',
    '  box-sizing: border-box; padding: 13px 18px 15px; border-radius: 14px;',
    '  background: rgba(12, 14, 20, 0.95); border: 1px solid rgba(94, 234, 212, 0.28);',
    '  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); color: #ffffff; z-index: 60;',
    '  pointer-events: auto; -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);',
    '}',
    '.peek-panel.at-bottom { top: auto; bottom: 64px; }',
    '.layer.is-peeking .ink-palette { display: none; }',
    '.peek-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }',
    '.peek-dot { width: 6px; height: 6px; border-radius: 50%; background: #8b7cff; flex: none; }',
    '.peek-count { letter-spacing: 0; opacity: 0.6; }',
    '.peek-tip { margin-left: auto; letter-spacing: 0; font-size: 10px; white-space: nowrap; opacity: 0.55; }',
    '.peek-text { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; font-size: 18px; line-height: 1.65; }',
    '.peek-text.is-empty { color: #7b8497; font-style: italic; font-size: 14px; }',
    '.peek-panel::-webkit-scrollbar { width: 8px; }',
    '.peek-panel::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }',
    '.seek-toast {',
    '  position: absolute; top: 66px; left: 50%; transform: translate(-50%, -4px);',
    '  padding: 6px 12px; border-radius: 999px; z-index: 80; pointer-events: none;',
    '  background: rgba(10, 13, 18, 0.92); border: 1px solid rgba(255, 255, 255, 0.14);',
    '  color: #eef2fa; font-size: 12px; line-height: 1.2; letter-spacing: 0.02em;',
    '  font-variant-numeric: tabular-nums; opacity: 0;',
    '  transition: opacity 140ms ease, transform 140ms ease;',
    '  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);',
    '}',
    '.seek-toast.show { opacity: 1; transform: translate(-50%, 0); }',
    '@media (max-width: 720px) { .practice-label, .practice-seek { display: none; } .practice-bar { gap: 6px; padding-left: 9px; } .peek-tip { display: none; } }',
    '@media (max-width: 480px) { .practice-ink .ink-label { display: none; } }',
    '.hint {',
    '  position: absolute; top: 16px; left: 50%; transform: translateX(-50%);',
    '  display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 12px;',
    '  max-width: calc(100vw - 32px); border-radius: 999px; box-sizing: border-box;',
    '  background: rgba(14, 15, 21, 0.95); color: #eceef6;',
    '  border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);',
    '  font-size: 12px; line-height: 1.2; pointer-events: auto; z-index: 50;',
    '  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);',
    '}',
    '.hint-dot { width: 7px; height: 7px; border-radius: 50%; background: #5eead4; box-shadow: 0 0 0 3px rgba(94, 234, 212, 0.14); flex: none; }',
    '.hint-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #c9cddb; }',
    '.hint kbd { font: inherit; color: #ffffff; background: rgba(255, 255, 255, 0.09); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 5px; padding: 2px 5px; font-size: 11px; }',
    '.hint button {',
    '  appearance: none; -webkit-appearance: none; border: 1px solid rgba(255, 255, 255, 0.14);',
    '  background: rgba(255, 255, 255, 0.07); color: #ffffff; height: 24px; padding: 0 10px;',
    '  border-radius: 999px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;',
    '  transition: background 120ms ease, border-color 120ms ease;',
    '}',
    '.hint button:hover { background: rgba(255, 255, 255, 0.14); }',
    '.hint button.done { background: #f4f5f7; color: #13141a; border-color: #f4f5f7; font-weight: 600; }',
    '.hint button.done:hover { background: #ffffff; }',
    '.hint button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }',
    '@media (max-width: 620px) { .hint-text { display: none; } }'
  ].join('\n');

  bootPromise = boot();

  function boot() {
    return C.loadSite(HOSTNAME).then(function (result) {
      if (result.site) {
        site = result.site;
        persisted = true;
        lastSavedJSON = JSON.stringify(site);
      } else {
        site = C.defaultSite();
        persisted = false;
      }
      selectedId = site.masks.length ? site.masks[0].id : null;

      chrome.storage.onChanged.addListener(onStorageChanged);
      document.addEventListener('fullscreenchange', onFullscreenChange, true);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange, true);
      window.addEventListener('resize', onWindowResize);
      window.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('selectionchange', savePracticeSelection, true);
      window.addEventListener('pagehide', function () {
        flushSave();
      });

      if (site.enabled) render();
    });
  }

  /* ------------------------------------------------------------------ *
   * 基础设施
   * ------------------------------------------------------------------ */

  function ensureSheet() {
    if (sheet) return;
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
    } catch (error) {
      sheet = null;
    }
  }

  function ensureRoot() {
    if (root) return;
    ensureSheet();
    root = document.createElement('div');
    root.id = '__screen_curtain_root';
    root.style.cssText = [
      'position: fixed !important',
      'inset: 0 !important',
      'width: 100vw !important',
      'height: 100vh !important',
      'z-index: 2147483647 !important',
      'pointer-events: none !important',
      'display: block !important',
      'visibility: visible !important',
      'opacity: 1 !important',
      'margin: 0 !important',
      'padding: 0 !important',
      'border: 0 !important',
      'background: transparent !important',
      'transform: none !important',
      'filter: none !important',
      'clip-path: none !important',
      'overflow: visible !important'
    ].join(';');
    shadow = root.attachShadow({ mode: 'open' });
    if (sheet && 'adoptedStyleSheets' in shadow) {
      shadow.adoptedStyleSheets = [sheet];
    } else {
      var style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
    }
    layer = document.createElement('div');
    layer.className = 'layer';
    shadow.appendChild(layer);
    ensureParent();

    if (!mountTimer) {
      mountTimer = window.setInterval(ensureParent, 2000);
    }
  }

  function ensureParent() {
    if (!root) return;
    var fullscreen = document.fullscreenElement;
    var parent = document.documentElement;
    if (fullscreen && !MEDIA_TAGS[fullscreen.tagName]) {
      parent = fullscreen;
    }
    if (root.parentNode !== parent) {
      try {
        parent.appendChild(root);
      } catch (error) {
        try {
          document.documentElement.appendChild(root);
        } catch (ignored) {
          /* 页面处于特殊状态，忽略 */
        }
      }
    }
  }

  function unmount() {
    if (inkPaletteOpen) closeInkPalette();
    if (root) {
      root.remove();
      root = null;
      shadow = null;
      layer = null;
    }
    if (mountTimer) {
      window.clearInterval(mountTimer);
      mountTimer = null;
    }
    drag = null;
  }

  function layerSize() {
    if (!layer) return { w: window.innerWidth, h: window.innerHeight };
    var rect = layer.getBoundingClientRect();
    return {
      w: rect.width || window.innerWidth,
      h: rect.height || window.innerHeight
    };
  }

  function currentMask() {
    if (!selectedId) return null;
    return site.masks.find(function (mask) {
      return mask.id === selectedId;
    }) || null;
  }

  function maskRectPx(mask) {
    var size = layerSize();
    return {
      left: mask.x * size.w,
      top: mask.y * size.h,
      width: mask.w * size.w,
      height: mask.h * size.h
    };
  }

  function maskElement(id) {
    if (!shadow) return null;
    return shadow.querySelector('.mask[data-id="' + id + '"]');
  }

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  function render() {
    if (inkPaletteOpen) closeInkPalette();
    if (!site.enabled || !site.masks.length) {
      unmount();
      return;
    }
    ensureRoot();
    ensureParent();
    layer.classList.toggle('is-peeking', practiceMode && peekMode);
    layer.textContent = '';

    site.masks.forEach(function (mask) {
      layer.appendChild(buildMask(mask));
    });

    if (practiceMode) {
      layer.appendChild(buildPracticeBar());
      if (peekMode) {
        layer.appendChild(buildPeekPanel());
        updatePeekPanel();
      }
    } else if (editMode) {
      layer.appendChild(buildHint());
    }
  }

  function buildMask(mask) {
    var style = site.style;
    var el = document.createElement('div');
    el.className = 'mask';
    el.dataset.id = mask.id;
    if (editMode) el.classList.add('is-editing');
    if (practiceMode) el.classList.add('is-practicing');
    if (mask.id === selectedId) el.classList.add('is-selected');
    if (mask.x <= 0.002) el.classList.add('flush-left');
    if (mask.x + mask.w >= 0.998) el.classList.add('flush-right');
    if (mask.y <= 0.002) el.classList.add('flush-top');
    if (mask.y + mask.h >= 0.998) el.classList.add('flush-bottom');
    el.style.left = mask.x * 100 + '%';
    el.style.top = mask.y * 100 + '%';
    el.style.width = mask.w * 100 + '%';
    el.style.height = mask.h * 100 + '%';

    var surface = document.createElement('div');
    surface.className = 'surface';
    surface.style.backgroundColor = C.hexToRgba(style.color, style.opacity);
    surface.style.borderRadius = style.radius + 'px';
    if (style.blur > 0) {
      surface.style.webkitBackdropFilter = 'blur(' + style.blur + 'px)';
      surface.style.backdropFilter = 'blur(' + style.blur + 'px)';
    }
    if (style.feather > 0) {
      var size = layerSize();
      var feather = Math.min(style.feather, Math.max(2, (mask.h * size.h) / 2));
      var gradient =
        'linear-gradient(to bottom, transparent 0px, #000 ' +
        feather +
        'px, #000 calc(100% - ' +
        feather +
        'px), transparent 100%)';
      surface.style.webkitMaskImage = gradient;
      surface.style.maskImage = gradient;
    }
    el.appendChild(surface);

    if (practiceMode) {
      el.appendChild(buildMaskPlaceholder(mask));
      el.appendChild(buildMaskInput(mask));
      el.appendChild(buildPracticeGrip(mask));
    } else {
      if (mask.text) el.appendChild(buildMaskText(mask));
      if (editMode) {
        ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (dir) {
          var handle = document.createElement('div');
          handle.className = 'handle';
          handle.dataset.dir = dir;
          el.appendChild(handle);
        });

        var badge = document.createElement('div');
        badge.className = 'badge';
        var badgeSize = layerSize();
        badge.textContent =
          Math.round(mask.w * badgeSize.w) + ' × ' + Math.round(mask.h * badgeSize.h) + ' px';
        el.appendChild(badge);

        el.addEventListener('pointerdown', onMaskPointerDown);
      }
    }

    return el;
  }

  function applyTextStyle(node, mask) {
    var size = layerSize();
    var height = mask.h * size.h;
    var fontSize = Math.round(C.clamp(height * 0.2, 14, 30));
    var padY = Math.round(C.clamp(height * 0.14, 6, 18));
    var padX = Math.round(C.clamp(height * 0.2, 12, 24));
    node.style.fontSize = fontSize + 'px';
    node.style.padding = padY + 'px ' + padX + 'px';
    node.style.color = C.contrastColor(site.style.color);
    node.style.borderRadius = site.style.radius + 'px';
    if (node.classList && node.classList.contains('mask-input')) {
      node.style.caretColor = node.style.color;
    }
    return fontSize;
  }

  function cssColorToHex(value) {
    if (typeof value !== 'string') return null;
    var color = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    var match = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) return null;
    return (
      '#' +
      [1, 2, 3]
        .map(function (index) {
          return Number(match[index]).toString(16).padStart(2, '0');
        })
        .join('')
    );
  }

  function resolveInkColor(color) {
    return color === 'auto' ? C.contrastColor(site.style.color) : color;
  }

  function renderRunsInto(container, runs) {
    container.textContent = '';
    container.style.color = C.contrastColor(site.style.color);
    (runs || []).forEach(function (run) {
      if (!run || typeof run.text !== 'string' || !run.text) return;
      var parts = run.text.split('\n');
      parts.forEach(function (part, index) {
        if (index > 0) container.appendChild(document.createElement('br'));
        if (!part) return;
        if (run.color === 'auto') {
          container.appendChild(document.createTextNode(part));
        } else {
          var span = document.createElement('span');
          span.style.color = run.color;
          span.textContent = part;
          container.appendChild(span);
        }
      });
    });
  }

  function extractRuns(root) {
    var runs = [];
    var total = 0;
    var auto = C.contrastColor(site.style.color).toLowerCase();

    function push(text, color) {
      if (!text || total >= C.MAX_TEXT_LENGTH) return;
      text = String(text).replace(/\u200b/g, '');
      if (!text) return;
      var remaining = C.MAX_TEXT_LENGTH - total;
      if (text.length > remaining) text = text.slice(0, remaining);
      if (!text) return;
      var normalized = color === 'auto' ? 'auto' : color;
      if (normalized !== 'auto' && String(normalized).toLowerCase() === auto) {
        normalized = 'auto';
      }
      var last = runs[runs.length - 1];
      if (last && last.color === normalized) {
        last.text += text;
      } else {
        runs.push({ text: text, color: normalized });
      }
      total += text.length;
    }

    function walk(node, inherited) {
      if (node.nodeType === 3) {
        push(node.nodeValue, inherited);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === 'BR') {
        push('\n', inherited);
        return;
      }
      if (tag === 'SCRIPT' || tag === 'STYLE') return;

      var color = inherited;
      try {
        var computed = cssColorToHex(getComputedStyle(node).color);
        if (computed) color = computed;
      } catch (error) {
        /* 忽略 */
      }

      var block = tag === 'DIV' || tag === 'P' || tag === 'LI';
      if (block) {
        var previous = runs[runs.length - 1];
        if (runs.length && previous && previous.text.slice(-1) !== '\n') {
          push('\n', inherited);
        }
      }
      Array.prototype.forEach.call(node.childNodes, function (child) {
        walk(child, color);
      });
    }

    Array.prototype.forEach.call(root.childNodes, function (child) {
      walk(child, auto);
    });

    while (runs.length) {
      var lastRun = runs[runs.length - 1];
      lastRun.text = lastRun.text.replace(/\n+$/, '');
      if (lastRun.text) break;
      runs.pop();
    }
    return runs;
  }

  function buildMaskPlaceholder(mask) {
    var placeholder = document.createElement('div');
    placeholder.className = 'mask-placeholder';
    placeholder.textContent = '听一句，写一句…';
    applyTextStyle(placeholder, mask);
    placeholder.style.display = mask.id === selectedId && !mask.text ? '' : 'none';
    return placeholder;
  }

  function updateMaskPlaceholders() {
    if (!shadow) return;
    Array.prototype.forEach.call(shadow.querySelectorAll('.mask'), function (el) {
      var placeholder = el.querySelector('.mask-placeholder');
      if (!placeholder) return;
      var mask = site.masks.find(function (item) {
        return item.id === el.dataset.id;
      });
      placeholder.style.display =
        practiceMode && el.dataset.id === selectedId && (!mask || !mask.text) ? '' : 'none';
    });
  }

  function syncMaskText(mask, input) {
    var runs = extractRuns(input);
    var text = runs
      .map(function (run) {
        return run.text;
      })
      .join('');
    var live = site.masks.find(function (item) {
      return item.id === mask.id;
    });
    if (live) {
      live.runs = runs;
      live.text = text;
    }
    mask.runs = runs;
    mask.text = text;
    input.classList.toggle('is-empty', !text);
    updateMaskPlaceholders();
    if (clearArmed) disarmClear();
    updateClearButton();
    scheduleSave();
    updatePeekPanel();
    return { runs: runs, text: text };
  }

  function updateInkIndicators() {
    if (!shadow) return;
    var dot = shadow.querySelector('.practice-ink .ink-dot');
    if (dot) {
      dot.classList.toggle('is-auto', site.inkColor === 'auto');
      dot.style.background = site.inkColor === 'auto' ? '' : site.inkColor;
    }
    Array.prototype.forEach.call(shadow.querySelectorAll('.ink-swatch'), function (swatch) {
      swatch.classList.toggle('is-active', swatch.dataset.color === site.inkColor);
    });
  }

  function activePracticeInput() {
    if (!shadow) return null;
    var mask = currentMask();
    if (!mask) return null;
    var el = maskElement(mask.id);
    return el ? el.querySelector('.mask-input') : null;
  }

  function applyInkToInput(allowSelection) {
    var input = activePracticeInput();
    if (!input || shadow.activeElement !== input) return false;
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;
    var range = selection.getRangeAt(0);
    if (!input.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== input) {
      return false;
    }
    if (!allowSelection && !range.collapsed) return false;

    try {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, resolveInkColor(site.inkColor));
      if (!range.collapsed) {
        var mask = currentMask();
        if (mask) syncMaskText(mask, input);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  function onMaskInputKeyDown(event, mask, input) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      document.execCommand('insertLineBreak');
      syncMaskText(mask, input);
      applyInkToInput(false);
    }
  }

  function onMaskPaste(event, mask, input) {
    event.preventDefault();
    event.stopPropagation();
    var clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) return;
    var text = clipboard.getData('text/plain');
    if (!text) return;
    document.execCommand('insertText', false, text.slice(0, C.MAX_TEXT_LENGTH));
    syncMaskText(mask, input);
  }

  function buildMaskInput(mask) {
    var input = document.createElement('div');
    input.className = 'mask-input';
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-multiline', 'true');
    input.setAttribute('aria-label', '听写输入');
    input.spellcheck = false;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    applyTextStyle(input, mask);
    input.style.caretColor = resolveInkColor(site.inkColor);
    renderRunsInto(input, mask.runs);
    if (!mask.text) input.classList.add('is-empty');

    input.addEventListener('input', function () {
      syncMaskText(mask, input);
      savePracticeSelection();
    });
    input.addEventListener('focus', function () {
      if (selectedId !== mask.id) {
        selectedId = mask.id;
        updateSelectionClasses();
        updatePracticeBar();
        updatePeekPanel();
      }
      updateMaskPlaceholders();
    });
    input.addEventListener('blur', function () {
      flushSave();
    });
    input.addEventListener('keydown', function (event) {
      onMaskInputKeyDown(event, mask, input);
    });
    input.addEventListener('keyup', function (event) {
      event.stopPropagation();
      savePracticeSelection();
    });
    input.addEventListener('pointerdown', stopEvent);
    input.addEventListener('click', stopEvent);
    input.addEventListener('pointerup', function () {
      window.setTimeout(function () {
        applyInkToInput(false);
        savePracticeSelection();
      }, 0);
    });
    input.addEventListener('paste', function (event) {
      onMaskPaste(event, mask, input);
    });
    return input;
  }

  function buildMaskText(mask) {
    var node = document.createElement('div');
    node.className = 'mask-text';
    applyTextStyle(node, mask);
    renderRunsInto(node, mask.runs);
    return node;
  }

  function savePracticeSelection() {
    if (!shadow) return;
    var active = shadow.activeElement;
    if (!active || !active.classList.contains('mask-input')) return;
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    var range = selection.getRangeAt(0);
    if (!active.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== active) {
      return;
    }
    try {
      savedPracticeRange = { input: active, range: range.cloneRange() };
    } catch (error) {
      /* 忽略 */
    }
  }

  function capturePracticeSelection() {
    if (!shadow) return null;
    var active = shadow.activeElement;
    if (!active || !active.classList.contains('mask-input')) return null;

    var selection = window.getSelection();
    if (selection && selection.rangeCount) {
      var range = selection.getRangeAt(0);
      if (active.contains(range.commonAncestorContainer) || range.commonAncestorContainer === active) {
        return { input: active, range: range.cloneRange() };
      }
    }

    if (savedPracticeRange && savedPracticeRange.input === active && active.isConnected) {
      try {
        var saved = savedPracticeRange.range.cloneRange();
        if (
          active.contains(saved.startContainer) ||
          saved.startContainer === active ||
          active.contains(saved.endContainer) ||
          saved.endContainer === active
        ) {
          return { input: active, range: saved };
        }
      } catch (error) {
        /* 忽略失效的 range */
      }
    }
    return null;
  }

  function restorePracticeSelection(snapshotSelection) {
    if (!snapshotSelection) return;
    try {
      snapshotSelection.input.focus({ preventScroll: true });
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(snapshotSelection.range);
      savePracticeSelection();
    } catch (error) {
      /* 忽略 */
    }
  }

  function buildPracticeGrip(mask) {
    var grip = document.createElement('div');
    grip.className = 'practice-grip';
    grip.title = '拖动遮罩（不会移动听写光标）';
    grip.setAttribute('role', 'button');
    grip.setAttribute('aria-label', '拖动遮罩');
    for (var index = 0; index < 6; index++) grip.appendChild(document.createElement('span'));
    if (mask.y * layerSize().h < GRIP_SAFE_TOP) grip.classList.add('is-inside');
    grip.addEventListener('pointerdown', onGripPointerDown);
    return grip;
  }

  function onGripPointerDown(event) {
    if (!practiceMode || event.button !== 0) return;
    var grip = event.currentTarget;
    var el = grip.closest('.mask');
    if (!el) return;
    var mask = site.masks.find(function (item) {
      return item.id === el.dataset.id;
    });
    if (!mask) return;

    event.preventDefault();
    event.stopPropagation();
    if (selectedId !== mask.id) {
      selectedId = mask.id;
      updateSelectionClasses();
      updatePracticeBar();
    }

    var rect = maskRectPx(mask);
    var selection = capturePracticeSelection();
    try {
      grip.setPointerCapture(event.pointerId);
    } catch (error) {
      /* 忽略 */
    }
    el.classList.add('is-dragging');
    drag = {
      id: mask.id,
      el: el,
      dir: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: rect,
      last: null,
      grip: grip,
      selection: selection
    };
    grip.addEventListener('pointermove', onGripPointerMove);
    grip.addEventListener('pointerup', onGripPointerUp);
    grip.addEventListener('pointercancel', onGripPointerUp);
  }

  function onGripPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    var size = layerSize();
    var left = C.clamp(drag.rect.left + dx, 0, size.w - drag.rect.width);
    var top = C.clamp(drag.rect.top + dy, 0, size.h - drag.rect.height);
    if (Math.abs(left) < SNAP_PX) left = 0;
    if (Math.abs(left + drag.rect.width - size.w) < SNAP_PX) left = size.w - drag.rect.width;
    if (Math.abs(top) < SNAP_PX) top = 0;
    if (Math.abs(top + drag.rect.height - size.h) < SNAP_PX) top = size.h - drag.rect.height;
    drag.last = { left: left, top: top };
    drag.el.style.left = left + 'px';
    drag.el.style.top = top + 'px';
  }

  function onGripPointerUp(event) {
    if (!drag) return;
    var grip = drag.grip;
    var el = drag.el;
    var last = drag.last;
    var id = drag.id;
    var selection = drag.selection;

    grip.removeEventListener('pointermove', onGripPointerMove);
    grip.removeEventListener('pointerup', onGripPointerUp);
    grip.removeEventListener('pointercancel', onGripPointerUp);
    el.classList.remove('is-dragging');
    try {
      grip.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* 忽略 */
    }
    drag = null;

    if (last) {
      var mask = site.masks.find(function (item) {
        return item.id === id;
      });
      if (mask) {
        var size = layerSize();
        Object.assign(
          mask,
          C.normalizeMask({
            id: mask.id,
            x: last.left / size.w,
            y: last.top / size.h,
            w: mask.w,
            h: mask.h,
            text: mask.text,
            runs: mask.runs
          })
        );
        el.classList.toggle('flush-left', mask.x <= 0.002);
        el.classList.toggle('flush-right', mask.x + mask.w >= 0.998);
        el.classList.toggle('flush-top', mask.y <= 0.002);
        el.classList.toggle('flush-bottom', mask.y + mask.h >= 0.998);
        el.style.left = mask.x * 100 + '%';
        el.style.top = mask.y * 100 + '%';
        var gripEl = el.querySelector('.practice-grip');
        if (gripEl) gripEl.classList.toggle('is-inside', mask.y * size.h < GRIP_SAFE_TOP);
        scheduleSave();
      }
    }
    restorePracticeSelection(selection);
  }

  function stopEvent(event) {
    event.stopPropagation();
  }

  function buildPracticeBar() {
    var bar = document.createElement('div');
    bar.className = 'practice-bar';
    bar.title = '← / → 回退或前进 5 秒（按住微调）；Shift + 方向键仍可编辑文字';

    var dot = document.createElement('span');
    dot.className = 'practice-dot';

    var label = document.createElement('span');
    label.className = 'practice-label';
    label.textContent = '听写练习';

    var seekHint = document.createElement('span');
    seekHint.className = 'practice-seek';
    seekHint.textContent = '← / → 5s';

    var ink = document.createElement('button');
    ink.type = 'button';
    ink.className = 'practice-ink';
    ink.title = '新输入文字的颜色（选中文字可批量改色）';
    var inkDot = document.createElement('span');
    inkDot.className = 'ink-dot' + (site.inkColor === 'auto' ? ' is-auto' : '');
    if (site.inkColor !== 'auto') inkDot.style.background = site.inkColor;
    var inkLabel = document.createElement('span');
    inkLabel.className = 'ink-label';
    inkLabel.textContent = '字色';
    ink.appendChild(inkDot);
    ink.appendChild(inkLabel);
    ink.addEventListener('pointerdown', function (event) {
      inkSelection = capturePracticeSelection();
      event.preventDefault();
      event.stopPropagation();
    });
    ink.addEventListener('mousedown', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    ink.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleInkPalette();
    });

    var compare = document.createElement('button');
    compare.type = 'button';
    compare.className = 'practice-compare';
    compare.textContent = peekMode ? '返回听写' : '对照原文';
    compare.title = '对照原字幕（Ctrl / ⌘ + Enter）';
    if (peekMode) compare.classList.add('is-active');
    compare.addEventListener('click', function (event) {
      event.preventDefault();
      setPeek(!peekMode);
    });

    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'practice-clear';
    clear.title = '清空当前遮罩上的听写内容';
    clear.addEventListener('click', function (event) {
      event.preventDefault();
      onClearClick();
    });

    var end = document.createElement('button');
    end.type = 'button';
    end.className = 'practice-end';
    end.textContent = '结束练习';
    end.addEventListener('click', function (event) {
      event.preventDefault();
      setPractice(false);
    });

    bar.appendChild(dot);
    bar.appendChild(label);
    bar.appendChild(seekHint);
    bar.appendChild(ink);
    bar.appendChild(compare);
    bar.appendChild(clear);
    bar.appendChild(end);
    bar.addEventListener('pointerdown', stopEvent);
    bar.addEventListener('click', stopEvent);

    var mask = currentMask();
    clear.disabled = !(mask && mask.text);
    clear.textContent = clearArmed ? '确认清空' : '清空';
    if (clearArmed) clear.classList.add('is-armed');
    return bar;
  }


  function toggleInkPalette() {
    if (inkPaletteOpen) {
      closeInkPalette();
    } else {
      openInkPalette();
    }
  }

  function openInkPalette() {
    if (!shadow || !layer || !practiceMode) return;
    closeInkPalette(true);
    if (!inkSelection) inkSelection = capturePracticeSelection();

    var palette = document.createElement('div');
    palette.className = 'ink-palette';
    var label = document.createElement('span');
    label.className = 'ink-palette-label';
    label.textContent = '新字颜色';
    palette.appendChild(label);

    INK_COLORS.forEach(function (item) {
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'ink-swatch';
      swatch.dataset.color = item.color;
      swatch.title = item.label;
      swatch.setAttribute('aria-label', '字色 ' + item.label);
      if (item.color === 'auto') {
        swatch.classList.add('is-auto');
      } else {
        swatch.style.background = item.color;
      }
      if (site.inkColor === item.color) swatch.classList.add('is-active');
      swatch.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      swatch.addEventListener('mousedown', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      swatch.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setInkColor(item.color);
      });
      palette.appendChild(swatch);
    });

    palette.addEventListener('pointerdown', stopEvent);
    palette.addEventListener('click', stopEvent);
    layer.appendChild(palette);
    inkPaletteOpen = true;
    document.addEventListener('pointerdown', onInkOutside, true);
  }

  function closeInkPalette(keepSelection) {
    inkPaletteOpen = false;
    if (!keepSelection) inkSelection = null;
    document.removeEventListener('pointerdown', onInkOutside, true);
    if (shadow) {
      var palette = shadow.querySelector('.ink-palette');
      if (palette) palette.remove();
    }
  }

  function onInkOutside(event) {
    if (!shadow) {
      closeInkPalette();
      return;
    }
    var path = event.composedPath ? event.composedPath() : [];
    var palette = shadow.querySelector('.ink-palette');
    var trigger = shadow.querySelector('.practice-ink');
    if (palette && path.indexOf(palette) > -1) return;
    if (trigger && path.indexOf(trigger) > -1) return;
    closeInkPalette();
  }

  function setInkColor(color) {
    if (!inkSelection) inkSelection = capturePracticeSelection();
    restorePracticeSelection(inkSelection);
    site.inkColor = C.normalizeInkColor(color);
    var input = activePracticeInput();
    if (input) input.style.caretColor = resolveInkColor(site.inkColor);
    applyInkToInput(true);
    closeInkPalette();
    updateInkIndicators();
    scheduleSave();
    return Promise.resolve(snapshot());
  }

  function buildPeekPanel() {
    var panel = document.createElement('div');
    panel.className = 'peek-panel';

    var head = document.createElement('div');
    head.className = 'peek-head';
    var dot = document.createElement('span');
    dot.className = 'peek-dot';
    var title = document.createElement('span');
    title.textContent = '你的听写';
    var count = document.createElement('span');
    count.className = 'peek-count';
    var tip = document.createElement('span');
    tip.className = 'peek-tip';
    tip.textContent = '原文已显示 · Ctrl / ⌘ + Enter 返回';
    head.appendChild(dot);
    head.appendChild(title);
    head.appendChild(count);
    head.appendChild(tip);

    var text = document.createElement('div');
    text.className = 'peek-text';

    panel.appendChild(head);
    panel.appendChild(text);
    panel.addEventListener('pointerdown', stopEvent);
    panel.addEventListener('click', stopEvent);
    return panel;
  }

  function positionPeekPanel(panel) {
    var mask = currentMask();
    var center = mask ? mask.y + mask.h / 2 : 0.5;
    panel.classList.toggle('at-bottom', center < 0.5);
  }

  function updatePeekPanel() {
    if (!shadow) return;
    var panel = shadow.querySelector('.peek-panel');
    if (!panel) return;
    var mask = currentMask();
    var value = mask && mask.text ? mask.text : '';
    var autoColor = C.contrastColor(site.style.color);
    var text = panel.querySelector('.peek-text');
    var count = panel.querySelector('.peek-count');
    var head = panel.querySelector('.peek-head');

    panel.style.background = C.hexToRgba(site.style.color, 0.95);
    panel.style.color = autoColor;
    panel.style.borderColor = 'rgba(139, 124, 255, 0.4)';
    if (head) head.style.color = autoColor;

    if (text) {
      if (value) {
        text.classList.remove('is-empty');
        text.style.opacity = '1';
        renderRunsInto(text, mask.runs);
      } else {
        text.textContent = '还没有输入内容，先听一句再写下来。';
        text.classList.add('is-empty');
        text.style.color = autoColor;
        text.style.opacity = '0.55';
      }
    }
    if (count) count.textContent = value ? value.trim().length + ' 字符' : '';
    positionPeekPanel(panel);
  }

  function updatePracticeBar() {
    if (!shadow) return;
    var compare = shadow.querySelector('.practice-compare');
    if (compare) {
      compare.textContent = peekMode ? '返回听写' : '对照原文';
      compare.classList.toggle('is-active', peekMode);
    }
    updateClearButton();
    updateInkIndicators();
  }

  function updateClearButton() {
    if (!shadow) return;
    var clear = shadow.querySelector('.practice-clear');
    if (!clear) return;
    var mask = currentMask();
    clear.disabled = !(mask && mask.text);
    clear.textContent = clearArmed ? '确认清空' : '清空';
    clear.classList.toggle('is-armed', clearArmed);
  }

  function disarmClear() {
    clearArmed = false;
    if (clearTimer) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }
    updateClearButton();
  }

  function onClearClick() {
    var mask = currentMask();
    if (!mask || !mask.text) return;
    if (clearArmed) {
      clearSelectedText();
      return;
    }
    clearArmed = true;
    updateClearButton();
    if (clearTimer) window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(function () {
      clearTimer = null;
      clearArmed = false;
      updateClearButton();
    }, 2600);
  }

  function clearSelectedText() {
    disarmClear();
    var mask = currentMask();
    if (!mask) return;
    mask.text = '';
    mask.runs = [];
    var el = maskElement(mask.id);
    var input = el ? el.querySelector('.mask-input') : null;
    if (input) {
      input.textContent = '';
      input.classList.add('is-empty');
    }
    updateMaskPlaceholders();
    scheduleSave();
    updatePeekPanel();
    updatePracticeBar();
    if (!peekMode) focusPracticeInput();
  }

  function focusPracticeInput() {
    if (!practiceMode) return;
    window.requestAnimationFrame(function () {
      if (!shadow) return;
      var input = activePracticeInput();
      if (!input) return;
      try {
        input.focus({ preventScroll: true });
        var selection = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        applyInkToInput(false);
      } catch (error) {
        /* 忽略 */
      }
    });
  }

  function setPeek(on) {
    if (!practiceMode) return Promise.resolve(snapshot());
    if (inkPaletteOpen) closeInkPalette();
    peekMode = Boolean(on);
    if (!shadow) {
      render();
      return Promise.resolve(snapshot());
    }

    layer.classList.toggle('is-peeking', peekMode);
    var panel = shadow.querySelector('.peek-panel');
    if (peekMode && !panel) {
      panel = buildPeekPanel();
      layer.appendChild(panel);
    } else if (!peekMode && panel) {
      panel.remove();
    }
    updatePeekPanel();
    updatePracticeBar();
    if (!peekMode) focusPracticeInput();
    return Promise.resolve(snapshot());
  }

  function setPractice(on) {
    on = Boolean(on);
    if (on) {
      var mustPersist = !site.enabled;
      if (!site.enabled) site.enabled = true;
      if (!site.masks.length) {
        var mask = C.createMask({ x: 0, y: 0.8, w: 1, h: 0.13 });
        site.masks.push(mask);
        selectedId = mask.id;
        mustPersist = true;
      }
      if (!currentMask() && site.masks.length) selectedId = site.masks[0].id;
      practiceMode = true;
      editMode = false;
      peekMode = false;
      disarmClear();
      if (mustPersist) persisted = true;
      var ready = mustPersist ? commit() : (render(), Promise.resolve(snapshot()));
      return ready.then(function (result) {
        focusPracticeInput();
        return result;
      });
    }

    practiceMode = false;
    peekMode = false;
    disarmClear();
    render();
    return flushSave().then(snapshot);
  }

  function buildHint() {
    var hint = document.createElement('div');
    hint.className = 'hint';

    var dot = document.createElement('span');
    dot.className = 'hint-dot';

    var text = document.createElement('span');
    text.className = 'hint-text';
    text.innerHTML = '拖动移动 · 边缘缩放 · <kbd>方向键</kbd> 微调';

    var add = document.createElement('button');
    add.type = 'button';
    add.textContent = '＋ 添加';

    var done = document.createElement('button');
    done.type = 'button';
    done.className = 'done';
    done.textContent = '完成';

    add.addEventListener('click', function (event) {
      event.preventDefault();
      addMask();
    });
    done.addEventListener('click', function (event) {
      event.preventDefault();
      setEdit(false);
    });

    hint.appendChild(dot);
    hint.appendChild(text);
    hint.appendChild(add);
    hint.appendChild(done);
    return hint;
  }

  function updateSelectionClasses() {
    if (!shadow) return;
    Array.prototype.forEach.call(shadow.querySelectorAll('.mask'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === selectedId);
    });
    updateMaskPlaceholders();
  }

  function updateBadge(el, width, height) {
    if (!el) return;
    var badge = el.querySelector('.badge');
    if (badge) badge.textContent = Math.round(width) + ' × ' + Math.round(height) + ' px';
  }

  function togglePractice() {
    return setPractice(!practiceMode);
  }

  /* ------------------------------------------------------------------ *
   * 拖动与缩放
   * ------------------------------------------------------------------ */

  function onMaskPointerDown(event) {
    if (!editMode || event.button !== 0) return;
    var el = event.currentTarget;
    var mask = site.masks.find(function (item) {
      return item.id === el.dataset.id;
    });
    if (!mask) return;

    if (selectedId !== mask.id) {
      selectedId = mask.id;
      updateSelectionClasses();
    }

    var handle = event.target && event.target.closest ? event.target.closest('.handle') : null;
    var dir = handle && el.contains(handle) ? handle.dataset.dir : 'move';
    var rect = maskRectPx(mask);

    event.preventDefault();
    event.stopPropagation();
    try {
      el.setPointerCapture(event.pointerId);
    } catch (error) {
      /* 忽略 */
    }
    el.classList.add('is-dragging');
    updateBadge(el, rect.width, rect.height);

    drag = {
      id: mask.id,
      el: el,
      dir: dir,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: rect,
      last: null
    };

    el.addEventListener('pointermove', onMaskPointerMove);
    el.addEventListener('pointerup', onMaskPointerUp);
    el.addEventListener('pointercancel', onMaskPointerUp);
  }

  function onMaskPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;
    var size = layerSize();
    var start = drag.rect;
    var left = start.left;
    var top = start.top;
    var width = start.width;
    var height = start.height;
    var MIN = C.MIN_MASK_PX;

    if (drag.dir === 'move') {
      left = C.clamp(start.left + dx, 0, size.w - width);
      top = C.clamp(start.top + dy, 0, size.h - height);
      if (Math.abs(left) < SNAP_PX) left = 0;
      if (Math.abs(left + width - size.w) < SNAP_PX) left = size.w - width;
      if (Math.abs(top) < SNAP_PX) top = 0;
      if (Math.abs(top + height - size.h) < SNAP_PX) top = size.h - height;
    } else {
      var right = Math.min(start.left + start.width, size.w);
      var bottom = Math.min(start.top + start.height, size.h);

      if (drag.dir.indexOf('e') > -1) {
        width = C.clamp(start.width + dx, MIN, size.w - start.left);
        if (Math.abs(start.left + width - size.w) < SNAP_PX) width = size.w - start.left;
      }
      if (drag.dir.indexOf('s') > -1) {
        height = C.clamp(start.height + dy, MIN, size.h - start.top);
        if (Math.abs(start.top + height - size.h) < SNAP_PX) height = size.h - start.top;
      }
      if (drag.dir.indexOf('w') > -1) {
        left = C.clamp(start.left + dx, 0, right - MIN);
        if (left < SNAP_PX) left = 0;
        width = right - left;
      }
      if (drag.dir.indexOf('n') > -1) {
        top = C.clamp(start.top + dy, 0, bottom - MIN);
        if (top < SNAP_PX) top = 0;
        height = bottom - top;
      }
    }

    drag.last = { left: left, top: top, width: width, height: height };
    drag.el.style.left = left + 'px';
    drag.el.style.top = top + 'px';
    drag.el.style.width = width + 'px';
    drag.el.style.height = height + 'px';
    updateBadge(drag.el, width, height);
  }

  function onMaskPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    var el = drag.el;
    var last = drag.last;
    var id = drag.id;

    el.removeEventListener('pointermove', onMaskPointerMove);
    el.removeEventListener('pointerup', onMaskPointerUp);
    el.removeEventListener('pointercancel', onMaskPointerUp);
    el.classList.remove('is-dragging');
    try {
      el.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* 忽略 */
    }

    drag = null;
    if (!last) return;

    var mask = site.masks.find(function (item) {
      return item.id === id;
    });
    if (!mask) return;

    var size = layerSize();
    Object.assign(
      mask,
      C.normalizeMask({
        id: mask.id,
        x: last.left / size.w,
        y: last.top / size.h,
        w: last.width / size.w,
        h: last.height / size.h,
        text: mask.text,
        runs: mask.runs
      })
    );
    selectedId = mask.id;
    commit();
  }

  /* ------------------------------------------------------------------ *
   * 操作
   * ------------------------------------------------------------------ */

  function commit(options) {
    persisted = true;
    site = C.normalizeSite(site);
    lastSavedJSON = JSON.stringify(site);
    var renderNow = !options || options.render !== false;
    if (renderNow) render();
    return C.saveSite(HOSTNAME, site).then(function (saved) {
      site = saved;
      lastSavedJSON = JSON.stringify(saved);
      return snapshot();
    });
  }

  function scheduleSave() {
    persisted = true;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      saveSnapshot();
    }, 250);
  }

  /**
   * 保存时不要替换 site.masks 里的对象引用：练习中的 textarea 闭包依赖这些对象。
   */
  function saveSnapshot() {
    var payload = C.normalizeSite(site);
    lastSavedJSON = JSON.stringify(payload);
    return C.saveSite(HOSTNAME, payload);
  }

  function flushSave() {
    persisted = true;
    if (!saveTimer) return Promise.resolve(snapshot());
    window.clearTimeout(saveTimer);
    saveTimer = null;
    return saveSnapshot().then(function () {
      return snapshot();
    });
  }

  function toggleEnabled() {
    return setEnabled(!site.enabled);
  }

  function setEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled && !site.masks.length) {
      var mask = C.createMask({ x: 0, y: 0.8, w: 1, h: 0.13 });
      site.masks.push(mask);
      selectedId = mask.id;
    }
    site.enabled = enabled;
    if (!enabled) {
      editMode = false;
      practiceMode = false;
      peekMode = false;
      disarmClear();
    } else if (!persisted) {
      editMode = true;
      practiceMode = false;
      selectedId = site.masks.length ? site.masks[0].id : null;
    }
    return commit();
  }

  function setEdit(edit) {
    edit = Boolean(edit);
    if (edit) {
      practiceMode = false;
      peekMode = false;
      disarmClear();
    }
    var save = Promise.resolve();
    if (edit && !site.enabled) {
      site.enabled = true;
      if (!site.masks.length) site.masks.push(C.createMask({ x: 0, y: 0.8, w: 1, h: 0.13 }));
      persisted = true;
      save = C.saveSite(HOSTNAME, site).then(function (saved) {
        site = saved;
        lastSavedJSON = JSON.stringify(saved);
      });
    }
    editMode = edit;
    if (editMode && !currentMask() && site.masks.length) selectedId = site.masks[0].id;
    render();
    return save.then(snapshot);
  }

  function addMask() {
    if (site.masks.length >= C.MAX_MASKS) {
      return Promise.resolve({ ok: false, error: '最多支持 ' + C.MAX_MASKS + ' 个遮罩' });
    }
    var count = site.masks.length;
    var shift = Math.min(count * 0.035, 0.18);
    var mask = C.createMask({
      x: 0.16,
      y: 0.4 + shift,
      w: 0.68,
      h: 0.14
    });
    site.masks.push(mask);
    site.enabled = true;
    editMode = true;
    practiceMode = false;
    peekMode = false;
    disarmClear();
    selectedId = mask.id;
    return commit();
  }

  function duplicateMask(id) {
    var source = site.masks.find(function (mask) {
      return mask.id === id;
    });
    if (!source) return Promise.resolve(snapshot());
    if (site.masks.length >= C.MAX_MASKS) {
      return Promise.resolve({ ok: false, error: '最多支持 ' + C.MAX_MASKS + ' 个遮罩' });
    }
    var copy = C.normalizeMask({
      id: C.uid(),
      x: source.x + 0.03,
      y: source.y + 0.03,
      w: source.w,
      h: source.h,
      text: source.text,
      runs: source.runs
    });
    var index = site.masks.indexOf(source);
    site.masks.splice(index + 1, 0, copy);
    selectedId = copy.id;
    editMode = true;
    practiceMode = false;
    peekMode = false;
    disarmClear();
    return commit();
  }

  function removeMask(id) {
    site.masks = site.masks.filter(function (mask) {
      return mask.id !== id;
    });
    if (selectedId === id) {
      selectedId = site.masks.length ? site.masks[0].id : null;
    }
    if (!site.masks.length) {
      editMode = false;
      practiceMode = false;
      peekMode = false;
      disarmClear();
    }
    var result = commit();
    if (practiceMode) result.then(focusPracticeInput);
    return result;
  }

  function selectMask(id, enableEdit) {
    if (!site.masks.some(function (mask) {
      return mask.id === id;
    })) {
      return Promise.resolve(snapshot());
    }
    selectedId = id;
    if (enableEdit) {
      editMode = true;
      practiceMode = false;
      peekMode = false;
      disarmClear();
    }
    if (root) {
      updateSelectionClasses();
      if (enableEdit && !shadow.querySelector('.hint')) render();
    } else if (site.enabled) {
      render();
    }
    return Promise.resolve(snapshot());
  }

  function applyPreset(presetId) {
    var preset = C.presetById(presetId);
    if (!preset) return Promise.resolve(snapshot());
    site.enabled = true;
    var mask = currentMask() || site.masks[0];
    if (!mask) {
      mask = C.createMask(preset.mask);
      site.masks.push(mask);
    } else {
      var normalized = C.normalizeMask({
        id: mask.id,
        x: preset.mask.x,
        y: preset.mask.y,
        w: preset.mask.w,
        h: preset.mask.h,
        text: mask.text,
        runs: mask.runs
      });
      var index = site.masks.indexOf(mask);
      site.masks[index] = normalized;
      mask = normalized;
    }
    selectedId = mask.id;
    editMode = true;
    practiceMode = false;
    peekMode = false;
    disarmClear();
    return commit();
  }

  function resetSite() {
    site = C.defaultSite();
    site.enabled = true;
    persisted = true;
    editMode = true;
    practiceMode = false;
    peekMode = false;
    disarmClear();
    selectedId = site.masks.length ? site.masks[0].id : null;
    return commit();
  }

  function clearSite() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    return C.clearSite(HOSTNAME).then(function () {
      site = C.defaultSite();
      persisted = false;
      lastSavedJSON = '';
      editMode = false;
      practiceMode = false;
      peekMode = false;
      disarmClear();
      selectedId = null;
      unmount();
      return snapshot();
    });
  }

  function applyStylePatch(patch) {
    if (!patch || typeof patch !== 'object') return Promise.resolve(snapshot());
    site.style = C.normalizeStyle(Object.assign({}, site.style, patch));
    return commit();
  }

  function moveSelectedBy(dx, dy) {
    var mask = currentMask();
    if (!mask) return;
    var size = layerSize();
    var rect = maskRectPx(mask);
    var left = C.clamp(rect.left + dx, 0, size.w - rect.width);
    var top = C.clamp(rect.top + dy, 0, size.h - rect.height);
    mask.x = C.round(left / size.w);
    mask.y = C.round(top / size.h);
    var el = maskElement(mask.id);
    if (el) {
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.classList.toggle('flush-left', mask.x <= 0.002);
      el.classList.toggle('flush-right', mask.x + mask.w >= 0.998);
      el.classList.toggle('flush-top', mask.y <= 0.002);
      el.classList.toggle('flush-bottom', mask.y + mask.h >= 0.998);
      updateBadge(el, rect.width, rect.height);
    }
    scheduleSave();
  }

  /* ------------------------------------------------------------------ *
   * 事件
   * ------------------------------------------------------------------ */

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    var key = C.storageKey(HOSTNAME);
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return;

    var next = changes[key].newValue;
    if (!next) {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      site = C.defaultSite();
      persisted = false;
      editMode = false;
      practiceMode = false;
      peekMode = false;
      disarmClear();
      selectedId = null;
      lastSavedJSON = '';
      unmount();
      return;
    }
    var json = JSON.stringify(C.normalizeSite(next));
    if (json === lastSavedJSON) return;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    site = C.normalizeSite(next);
    persisted = true;
    lastSavedJSON = json;
    if (!site.enabled) {
      editMode = false;
      practiceMode = false;
      peekMode = false;
      disarmClear();
    }
    if (selectedId && !site.masks.some(function (mask) { return mask.id === selectedId; })) {
      selectedId = site.masks.length ? site.masks[0].id : null;
    }
    if (!drag) render();
  }

  function onFullscreenChange() {
    if (!root) return;
    ensureParent();
    if (!drag) {
      render();
      if (practiceMode) focusPracticeInput();
    }
  }

  function onWindowResize() {
    if (!root || drag) return;
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resizeTimer = null;
      if (!drag) render();
    }, 120);
  }

  function isTypingTarget(el) {
    if (!el || el === document.body) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function formatSeekTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  function mediaArea(el) {
    if (!el || !el.isConnected) return 0;
    var rect;
    try {
      rect = el.getBoundingClientRect();
    } catch (error) {
      return 0;
    }
    if (rect.width < 32 || rect.height < 32) return 0;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
      return 0;
    }
    var style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return 0;
    return rect.width * rect.height;
  }

  function pickMedia(list) {
    var best = null;
    var bestArea = 0;
    list.forEach(function (el) {
      var area = mediaArea(el);
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    });
    return best;
  }

  function addMediaFrom(root, list) {
    if (!root || !root.querySelectorAll) return;
    try {
      Array.prototype.forEach.call(root.querySelectorAll('video, audio'), function (el) {
        list.push(el);
      });
    } catch (error) {
      /* 忽略无法访问的文档 */
    }
  }

  function collectDeepMedia(root, list, depth) {
    if (!root || depth > 2) return;
    var all;
    try {
      all = root.querySelectorAll('*');
    } catch (error) {
      return;
    }
    Array.prototype.forEach.call(all, function (el) {
      if (el.shadowRoot) {
        addMediaFrom(el.shadowRoot, list);
        collectDeepMedia(el.shadowRoot, list, depth + 1);
      }
      if (el.tagName === 'IFRAME') {
        try {
          var doc = el.contentDocument;
          if (doc) {
            addMediaFrom(doc, list);
            collectDeepMedia(doc, list, depth + 1);
          }
        } catch (error) {
          /* 跨域 iframe 无法控制，忽略 */
        }
      }
    });
  }

  function findPrimaryMedia() {
    var now = Date.now();
    if (mediaCache.el && mediaCache.el.isConnected && now - mediaCache.at < 2000) {
      return mediaCache.el;
    }
    var list = [];
    addMediaFrom(document, list);
    var best = pickMedia(list);
    if (!best) {
      collectDeepMedia(document, list, 0);
      best = pickMedia(list);
    }
    mediaCache = { el: best, at: now };
    return best;
  }

  function showSeekToast(delta, time) {
    if (!shadow || !layer) return;
    var toast = shadow.querySelector('.seek-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'seek-toast';
      layer.appendChild(toast);
    }
    toast.textContent = (delta < 0 ? '←' : '→') + ' ' + Math.abs(delta) + ' 秒 · ' + formatSeekTime(time);
    toast.classList.add('show');
    if (seekToastTimer) window.clearTimeout(seekToastTimer);
    seekToastTimer = window.setTimeout(function () {
      seekToastTimer = null;
     	if (toast.isConnected) toast.classList.remove('show');
    }, 900);
  }

  /**
   * 听写时用左右方向键控制底层视频，而不是移动输入框里的光标。
   * 返回 false 表示当前页面没有可控制的 HTML5 媒体，交给输入框默认处理。
   */
  function seekMedia(delta) {
    var media = findPrimaryMedia();
    if (!media) return false;
    var current = Number(media.currentTime) || 0;
    var target = current + delta;
    var duration = Number(media.duration);
    if (isFinite(duration) && duration > 0) {
      target = C.clamp(target, 0, duration);
    } else {
      target = Math.max(0, target);
    }
    try {
      var seekable = media.seekable;
      if (seekable && seekable.length) {
        var start = seekable.start(0);
        var end = seekable.end(seekable.length - 1);
        if (isFinite(start) && isFinite(end) && end > start) {
          target = C.clamp(target, start, end);
        }
      }
    } catch (error) {
      /* 某些直播流没有 seekable，忽略 */
    }
    try {
      media.currentTime = target;
    } catch (error) {
      return false;
    }
    showSeekToast(delta, target);
    return true;
  }

  function onKeyDown(event) {
    if (practiceMode) {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (inkPaletteOpen) {
          closeInkPalette();
          return;
        }
        setPractice(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        setPeek(!peekMode);
        return;
      }
      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        var step = event.repeat ? 1 : 5;
        if (seekMedia(event.key === 'ArrowLeft' ? -step : step)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      return;
    }

    if (!editMode) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEdit(false);
      return;
    }

    if (isTypingTarget(document.activeElement)) return;
    var mask = currentMask();
    if (!mask && event.key !== 'Escape') return;

    var step = event.shiftKey ? 10 : 1;
    var handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        moveSelectedBy(-step, 0);
        break;
      case 'ArrowRight':
        moveSelectedBy(step, 0);
        break;
      case 'ArrowUp':
        moveSelectedBy(0, -step);
        break;
      case 'ArrowDown':
        moveSelectedBy(0, step);
        break;
      case 'Delete':
      case 'Backspace':
        removeMask(mask.id);
        break;
      case 'd':
      case 'D':
        if (event.metaKey || event.ctrlKey) {
          duplicateMask(mask.id);
        } else {
          handled = false;
        }
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /* ------------------------------------------------------------------ *
   * 消息
   * ------------------------------------------------------------------ */

  function snapshot() {
    return {
      ok: true,
      host: HOSTNAME,
      href: location.href,
      persisted: persisted,
      editMode: editMode,
      practiceMode: practiceMode,
      peekMode: peekMode,
      selectedId: selectedId,
      site: {
        enabled: site.enabled,
        inkColor: site.inkColor,
        style: Object.assign({}, site.style),
        masks: site.masks.map(function (mask) {
          return Object.assign({}, mask);
        })
      },
      viewport: {
        w: window.innerWidth,
        h: window.innerHeight
      }
    };
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'CURTAIN_PING':
      case 'CURTAIN_GET_STATE':
        return Promise.resolve(snapshot());
      case 'CURTAIN_SET_ENABLED':
        return setEnabled(message.enabled);
      case 'CURTAIN_SET_EDIT':
        return setEdit(message.edit);
      case 'CURTAIN_SET_PRACTICE':
        return setPractice(message.practice);
      case 'CURTAIN_SET_INK':
        return setInkColor(message.color);
      case 'CURTAIN_PATCH_STYLE':
        return applyStylePatch(message.patch);
      case 'CURTAIN_ADD_MASK':
        return addMask();
      case 'CURTAIN_DUPLICATE_MASK':
        return duplicateMask(message.id);
      case 'CURTAIN_REMOVE_MASK':
        return removeMask(message.id);
      case 'CURTAIN_SELECT_MASK':
        return selectMask(message.id, Boolean(message.edit));
      case 'CURTAIN_APPLY_PRESET':
        return applyPreset(message.preset);
      case 'CURTAIN_RESET_SITE':
        return resetSite();
      case 'CURTAIN_CLEAR_SITE':
        return clearSite();
      case 'CURTAIN_COMMAND':
        return runCommand(message.command);
      default:
        return Promise.resolve({ ok: false, error: 'unknown message' });
    }
  }

  function runCommand(command) {
    switch (command) {
      case 'toggle-overlay':
        return toggleEnabled();
      case 'toggle-edit':
        return setEdit(!editMode);
      case 'toggle-practice':
        return togglePractice();
      case 'add-mask':
        return addMask();
      case 'reset-site':
        return resetSite();
      default:
        return Promise.resolve(snapshot());
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') return false;
    if (!message.type.startsWith('CURTAIN_')) return false;
    if (sender && sender.id && sender.id !== chrome.runtime.id) return false;

    Promise.resolve(bootPromise)
      .then(function () {
        return handleMessage(message);
      })
      .then(function (result) {
        sendResponse(result);
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      });
    return true;
  });
})();
