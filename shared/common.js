/*
 * 幕帘 · 共享状态模型
 * 被 content script、popup、service worker 共同加载。
 */
var CURTAIN = (function () {
  'use strict';

  var VERSION = '1.3.0';
  var STORAGE_PREFIX = 'curtain.site.v1:';
  var MAX_MASKS = 12;
  var MIN_MASK_PX = 28;
  var MAX_TEXT_LENGTH = 20000;

  var DEFAULT_STYLE = {
    color: '#0b0d12',
    opacity: 1,
    radius: 0,
    feather: 0,
    blur: 0
  };

  var PRESETS = [
    { id: 'bottom', label: '底部字幕', mask: { x: 0, y: 0.8, w: 1, h: 0.13 } },
    { id: 'top', label: '顶部信息', mask: { x: 0, y: 0, w: 1, h: 0.1 } },
    { id: 'center', label: '居中横幅', mask: { x: 0.12, y: 0.44, w: 0.76, h: 0.12 } },
    { id: 'full', label: '全屏遮罩', mask: { x: 0, y: 0, w: 1, h: 1 } }
  ];

  var COLOR_SWATCHES = [
    '#0b0d12',
    '#23262f',
    '#ffffff',
    '#0b2e4f',
    '#2d1b3d',
    '#143024'
  ];

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function uid() {
    var random = '';
    try {
      var bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      random = Array.prototype.map
        .call(bytes, function (b) {
          return b.toString(36).padStart(2, '0');
        })
        .join('');
    } catch (error) {
      random = Math.random().toString(36).slice(2, 10);
    }
    return 'm_' + random.slice(0, 8);
  }

  function round(value) {
    return Math.round(value * 10000) / 10000;
  }

  function normalizeColor(value) {
    if (typeof value !== 'string') return DEFAULT_STYLE.color;
    var color = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) {
      return (
        '#' +
        color
          .slice(1)
          .split('')
          .map(function (c) {
            return c + c;
          })
          .join('')
      );
    }
    return DEFAULT_STYLE.color;
  }

  function normalizeStyle(raw) {
    var style = raw && typeof raw === 'object' ? raw : {};
    var opacity =
      style.opacity === undefined || style.opacity === null
        ? DEFAULT_STYLE.opacity
        : Number(style.opacity);
    return {
      color: normalizeColor(style.color),
      opacity: clamp(Number.isFinite(opacity) ? opacity : DEFAULT_STYLE.opacity, 0.1, 1),
      radius: Math.round(clamp(Number(style.radius), 0, 64)),
      feather: Math.round(clamp(Number(style.feather), 0, 80)),
      blur: Math.round(clamp(Number(style.blur), 0, 40))
    };
  }

  function normalizeInkColor(value) {
    if (value === 'auto') return 'auto';
    if (typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
      return normalizeColor(value);
    }
    return 'auto';
  }

  function normalizeRuns(rawRuns, rawText) {
    var runs = [];
    var total = 0;
    if (Array.isArray(rawRuns)) {
      rawRuns.forEach(function (run) {
        if (!run || typeof run.text !== 'string' || total >= MAX_TEXT_LENGTH) return;
        var text = run.text.replace(/\u200b/g, '');
        if (!text) return;
        var remaining = MAX_TEXT_LENGTH - total;
        if (text.length > remaining) text = text.slice(0, remaining);
        if (!text) return;
        var color = normalizeInkColor(run.color);
        var last = runs[runs.length - 1];
        if (last && last.color === color) {
          last.text += text;
        } else {
          runs.push({ text: text, color: color });
        }
        total += text.length;
      });
    }
    if (!runs.length && typeof rawText === 'string' && rawText) {
      var text = rawText.replace(/\u200b/g, '').slice(0, MAX_TEXT_LENGTH);
      if (text) runs.push({ text: text, color: 'auto' });
    }
    return {
      runs: runs,
      text: runs
        .map(function (run) {
          return run.text;
        })
        .join('')
    };
  }

  function normalizeMask(raw) {
    var mask = raw && typeof raw === 'object' ? raw : {};
    var w = clamp(Number(mask.w), 0.02, 1);
    var h = clamp(Number(mask.h), 0.02, 1);
    var content = normalizeRuns(mask.runs, mask.text);
    return {
      id: typeof mask.id === 'string' && mask.id ? mask.id : uid(),
      x: round(clamp(Number(mask.x), 0, 1 - w)),
      y: round(clamp(Number(mask.y), 0, 1 - h)),
      w: round(w),
      h: round(h),
      text: content.text,
      runs: content.runs
    };
  }

  function createMask(overrides) {
    var base = {
      id: uid(),
      x: 0.17,
      y: 0.42,
      w: 0.66,
      h: 0.14,
      text: '',
      runs: []
    };
    return normalizeMask(Object.assign(base, overrides || {}));
  }

  function defaultSite() {
    return {
      enabled: false,
      inkColor: 'auto',
      style: Object.assign({}, DEFAULT_STYLE),
      masks: [
        {
          id: uid(),
          x: 0,
          y: 0.8,
          w: 1,
          h: 0.13,
          text: '',
          runs: []
        }
      ]
    };
  }

  function normalizeSite(raw) {
    if (!raw || typeof raw !== 'object') return defaultSite();
    var masks = [];
    if (Array.isArray(raw.masks)) {
      masks = raw.masks
        .slice(0, MAX_MASKS)
        .map(normalizeMask)
        .filter(Boolean);
    }
    return {
      enabled: Boolean(raw.enabled),
      inkColor: normalizeInkColor(raw.inkColor),
      style: normalizeStyle(raw.style),
      masks: masks
    };
  }

  function storageKey(host) {
    return STORAGE_PREFIX + (host || 'unknown');
  }

  async function loadSite(host) {
    var key = storageKey(host);
    var result = await chrome.storage.local.get(key);
    return {
      key: key,
      site: result[key] ? normalizeSite(result[key]) : null
    };
  }

  async function saveSite(host, site) {
    var key = storageKey(host);
    var payload = normalizeSite(site);
    await chrome.storage.local.set({ [key]: payload });
    return payload;
  }

  async function clearSite(host) {
    await chrome.storage.local.remove(storageKey(host));
  }

  function contrastColor(hex) {
    var color = normalizeColor(hex).slice(1);
    var r = parseInt(color.slice(0, 2), 16);
    var g = parseInt(color.slice(2, 4), 16);
    var b = parseInt(color.slice(4, 6), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62 ? '#111318' : '#ffffff';
  }

  function hexToRgba(hex, alpha) {
    var color = normalizeColor(hex).slice(1);
    var r = parseInt(color.slice(0, 2), 16);
    var g = parseInt(color.slice(2, 4), 16);
    var b = parseInt(color.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + clamp(alpha, 0, 1) + ')';
  }

  function presetById(id) {
    return PRESETS.find(function (preset) {
      return preset.id === id;
    });
  }

  function hostFromUrl(url) {
    try {
      return new URL(url).hostname || null;
    } catch (error) {
      return null;
    }
  }

  function isSupportedUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^(https?|file):/i.test(url)) return true;
    return false;
  }

  return {
    VERSION: VERSION,
    STORAGE_PREFIX: STORAGE_PREFIX,
    MAX_MASKS: MAX_MASKS,
    MIN_MASK_PX: MIN_MASK_PX,
    MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
    DEFAULT_STYLE: DEFAULT_STYLE,
    PRESETS: PRESETS,
    COLOR_SWATCHES: COLOR_SWATCHES,
    clamp: clamp,
    uid: uid,
    round: round,
    normalizeColor: normalizeColor,
    normalizeInkColor: normalizeInkColor,
    normalizeStyle: normalizeStyle,
    normalizeMask: normalizeMask,
    createMask: createMask,
    defaultSite: defaultSite,
    normalizeSite: normalizeSite,
    storageKey: storageKey,
    loadSite: loadSite,
    saveSite: saveSite,
    clearSite: clearSite,
    contrastColor: contrastColor,
    hexToRgba: hexToRgba,
    presetById: presetById,
    hostFromUrl: hostFromUrl,
    isSupportedUrl: isSupportedUrl
  };
})();
