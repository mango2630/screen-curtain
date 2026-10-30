/*
 * 幕帘 · popup
 */
(function () {
  'use strict';

  var C = window.CURTAIN;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var els = {
    heroCard: $('heroCard'),
    heroEyebrow: $('heroEyebrow'),
    heroTitle: $('heroTitle'),
    heroDesc: $('heroDesc'),
    enableBtn: $('enableBtn'),
    unsupportedCard: $('unsupportedCard'),
    unsupportedTitle: $('unsupportedTitle'),
    unsupportedDesc: $('unsupportedDesc'),
    controls: $('controls'),
    enabledToggle: $('enabledToggle'),
    siteHost: $('siteHost'),
    siteDot: $('siteDot'),
    maskCount: $('maskCount'),
    maskList: $('maskList'),
    addBtn: $('addBtn'),
    editBtn: $('editBtn'),
    editLabel: $('editLabel'),
    practiceBtn: $('practiceBtn'),
    practiceLabel: $('practiceLabel'),
    modeHint: $('modeHint'),
    styleResetBtn: $('styleResetBtn'),
    opacityRange: $('opacityRange'),
    opacityValue: $('opacityValue'),
    swatches: $('swatches'),
    colorInput: $('colorInput'),
    colorValue: $('colorValue'),
    radiusRange: $('radiusRange'),
    radiusValue: $('radiusValue'),
    featherRange: $('featherRange'),
    featherValue: $('featherValue'),
    blurToggle: $('blurToggle'),
    blurRow: $('blurRow'),
    blurRange: $('blurRange'),
    blurValue: $('blurValue'),
    presets: $('presets'),
    resetBtn: $('resetBtn'),
    clearBtn: $('clearBtn'),
    toast: $('toast')
  };

  var tab = null;
  var state = null;
  var styleTimer = null;
  var pendingStyle = null;
  var toastTimer = null;

  var SVG = {
    duplicate:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">' +
      '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/>' +
      '<path d="M10.5 5.5V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.2c0 .8.6 1.4 1.4 1.4h1.6" stroke-linecap="round"/>' +
      '</svg>',
    trash:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">' +
      '<path d="M3 4.5h10M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M4.4 4.5l.6 8c0 .5.4.9.9.9h4.2c.5 0 .9-.4.9-.9l.6-8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M6.6 7v3.6M9.4 7v3.6" stroke-linecap="round"/>' +
      '</svg>'
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    buildSwatches();
    buildPresets();
    bindEvents();
    setShortcutLabels();
    var version = document.querySelector('.version');
    if (version) version.textContent = 'v' + C.VERSION;

    tab = await findActiveTab();

    if (!tab || !tab.id || (tab.url && !isUsablePage(tab.url))) {
      showUnsupported(tab);
      return;
    }

    try {
      await ensureContent();
      var res = await chrome.tabs.sendMessage(tab.id, { type: 'CURTAIN_GET_STATE' });
      if (!res || !res.ok) throw new Error('no-state');
      state = res;
      render(true);
    } catch (error) {
      showUnsupported(tab);
    }
  }

  /**
   * 弹出面板本身也属于一个窗口，直接用 currentWindow 可能拿到面板自己。
   * 因此优先查找普通窗口中拥有可注入页面的活动标签页。
   */
  async function findActiveTab() {
    var queries = [
      { active: true, windowType: 'normal', lastFocusedWindow: true },
      { active: true, windowType: 'normal' },
      { active: true, lastFocusedWindow: true }
    ];
    for (var i = 0; i < queries.length; i++) {
      try {
        var tabs = await chrome.tabs.query(queries[i]);
        var match = (tabs || []).find(function (item) {
          return item && item.id && isUsablePage(item.url);
        });
        if (match) return match;
        if (tabs && tabs[0] && tabs[0].id) return tabs[0];
      } catch (error) {
        /* 尝试下一种查询方式 */
      }
    }
    try {
      var all = await chrome.tabs.query({});
      return (
        (all || []).find(function (item) {
          return item && item.id && isUsablePage(item.url);
        }) || null
      );
    } catch (error) {
      return null;
    }
  }

  function isUsablePage(url) {
    if (!C.isSupportedUrl(url)) return false;
    if (/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)\//i.test(url)) return false;
    return true;
  }

  async function ensureContent() {
    try {
      var pong = await chrome.tabs.sendMessage(tab.id, { type: 'CURTAIN_PING' });
      if (pong && pong.ok) return;
    } catch (error) {
      /* 尚未注入 */
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['shared/common.js', 'content/content.js']
      });
    } catch (error) {
      throw new Error('inject-failed');
    }

    await delay(120);
    var result = await chrome.tabs.sendMessage(tab.id, { type: 'CURTAIN_PING' });
    if (!result || !result.ok) throw new Error('no-state');
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  function render(syncStyle) {
    if (!state) return;
    var enabled = Boolean(state.site && state.site.enabled);
    var masks = state.site ? state.site.masks : [];

    document.body.dataset.state = enabled ? 'enabled' : 'disabled';
    els.siteHost.textContent = state.host || '当前页面';
    els.siteHost.title = state.href || state.host || '';
    els.siteDot.className = 'site-dot ' + (enabled ? 'on' : 'off');
    if (!enabled && !state.persisted) {
      els.maskCount.textContent = '未启用';
    } else {
      els.maskCount.textContent = masks.length ? masks.length + ' 个遮罩' : '暂无遮罩';
    }
    els.enabledToggle.checked = enabled;

    els.heroCard.hidden = enabled;
    els.controls.hidden = !enabled;
    els.unsupportedCard.hidden = true;

    if (!enabled) {
      if (state.persisted) {
        els.heroEyebrow.textContent = '已暂停';
        els.heroTitle.textContent = '遮罩已暂停';
        els.heroDesc.textContent = '此网站的遮罩当前不显示，页面保持原样。重新启用后会恢复上次的位置与外观。';
        els.enableBtn.textContent = '重新启用';
      } else {
        els.heroEyebrow.textContent = '为当前网站';
        els.heroTitle.textContent = '启用一条遮罩';
        els.heroDesc.textContent = '挡住字幕、弹幕或任何不想看到的画面。可拖动、可缩放，只遮住你想遮住的地方。';
        els.enableBtn.textContent = '启用遮罩';
      }
    } else {
      renderMaskList();
      renderModeState();
      if (syncStyle) syncStyleControls();
      updateMaskPreviews();
      els.editBtn.disabled = !masks.length;
    }

    if (!enabled) els.editBtn.disabled = true;

    els.resetBtn.disabled = !state.persisted;
    els.clearBtn.disabled = !state.persisted;
  }

  function renderMaskList() {
    var masks = state.site.masks;
    var viewport = state.viewport || { w: window.innerWidth, h: window.innerHeight };
    var fragment = document.createDocumentFragment();

    if (!masks.length) {
      var empty = document.createElement('li');
      empty.className = 'mask-empty';
      empty.textContent = '还没有遮罩，点击上方「＋ 添加」创建一条。';
      fragment.appendChild(empty);
      els.maskList.replaceChildren(fragment);
      return;
    }

    masks.forEach(function (mask, index) {
      var li = document.createElement('li');
      li.className = 'mask-row' + (mask.id === state.selectedId ? ' is-selected' : '');
      li.dataset.id = mask.id;

      var main = document.createElement('button');
      main.type = 'button';
      main.className = 'mask-main';
      main.setAttribute('aria-label', '选中遮罩 ' + (index + 1) + ' 并进入编辑模式');

      var preview = document.createElement('span');
      preview.className = 'mask-preview';
      preview.style.background = C.hexToRgba(state.site.style.color, state.site.style.opacity);
      preview.style.borderRadius = Math.min(10, state.site.style.radius) + 'px';

      var meta = document.createElement('span');
      meta.className = 'mask-meta';
      var name = document.createElement('span');
      name.className = 'mask-name';
      name.textContent = '遮罩 ' + (index + 1);
      var size = document.createElement('span');
      size.className = 'mask-size';
      var textLength = (mask.text || '').trim().length;
      size.textContent =
        Math.round(mask.w * viewport.w) +
        ' × ' +
        Math.round(mask.h * viewport.h) +
        ' px · ' +
        Math.round(mask.w * 100) +
        '% 宽' +
        (textLength ? ' · 听写 ' + textLength : '');
      meta.appendChild(name);
      meta.appendChild(size);
      main.appendChild(preview);
      main.appendChild(meta);

      main.addEventListener('click', function () {
        run({ type: 'CURTAIN_SELECT_MASK', id: mask.id, edit: true }, '已选中「遮罩 ' + (index + 1) + '」');
      });

      var actions = document.createElement('span');
      actions.className = 'row-actions';

      var duplicate = document.createElement('button');
      duplicate.type = 'button';
      duplicate.className = 'icon-btn';
      duplicate.title = '复制遮罩';
      duplicate.setAttribute('aria-label', '复制遮罩 ' + (index + 1));
      duplicate.innerHTML = SVG.duplicate;
      duplicate.addEventListener('click', function (event) {
        event.stopPropagation();
        run({ type: 'CURTAIN_DUPLICATE_MASK', id: mask.id }, '已复制遮罩');
      });

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn danger';
      remove.title = '删除遮罩';
      remove.setAttribute('aria-label', '删除遮罩 ' + (index + 1));
      remove.innerHTML = SVG.trash;
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        run({ type: 'CURTAIN_REMOVE_MASK', id: mask.id }, '已删除遮罩');
      });

      actions.appendChild(duplicate);
      actions.appendChild(remove);
      li.appendChild(main);
      li.appendChild(actions);
      fragment.appendChild(li);
    });

    els.maskList.replaceChildren(fragment);
  }

  function renderModeState() {
    var editing = Boolean(state.editMode);
    var practicing = Boolean(state.practiceMode);

    els.editBtn.classList.toggle('is-active', editing);
    els.editBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    els.editLabel.textContent = editing ? '完成调整' : '调整遮罩';

    els.practiceBtn.classList.toggle('is-active', practicing);
    els.practiceBtn.setAttribute('aria-pressed', practicing ? 'true' : 'false');
    els.practiceLabel.textContent = practicing ? '结束练习' : '听写练习';

    if (practicing) {
      els.modeHint.textContent = '拖上方六点把手移动遮罩，点「字色」切换颜色；← / → 控制视频，Cmd/Ctrl + Enter 对照原文。';
    } else if (editing) {
      els.modeHint.textContent = '编辑中：拖动遮罩移动，拖拽四边或四角缩放；方向键可微调，按 Esc 完成。';
    } else {
      els.modeHint.textContent = '「调整遮罩」移动和缩放；「听写练习」在遮罩上打字听写。';
    }
  }

  function updateMaskPreviews() {
    if (!state || !state.site) return;
    var style = state.site.style;
    Array.prototype.forEach.call(els.maskList.querySelectorAll('.mask-preview'), function (node) {
      node.style.background = C.hexToRgba(style.color, style.opacity);
      node.style.borderRadius = Math.min(10, style.radius) + 'px';
    });
  }

  function syncStyleControls() {
    var style = state.site.style;
    els.opacityRange.value = String(Math.round(style.opacity * 100));
    els.opacityValue.textContent = Math.round(style.opacity * 100) + '%';

    els.colorInput.value = style.color;
    els.colorValue.textContent = style.color.toUpperCase();
    setActiveSwatch(style.color);

    els.radiusRange.value = String(style.radius);
    els.radiusValue.textContent = style.radius + 'px';

    els.featherRange.value = String(style.feather);
    els.featherValue.textContent = style.feather + 'px';

    els.blurToggle.checked = style.blur > 0;
    els.blurRow.hidden = style.blur === 0;
    els.blurRange.value = String(style.blur > 0 ? style.blur : 12);
    els.blurValue.textContent = (style.blur > 0 ? style.blur : 12) + 'px';
  }

  /* ------------------------------------------------------------------ *
   * 控件
   * ------------------------------------------------------------------ */

  function buildSwatches() {
    C.COLOR_SWATCHES.forEach(function (color) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.color = color;
      button.style.background = color;
      button.title = color.toUpperCase();
      button.setAttribute('aria-label', '使用颜色 ' + color);
      button.addEventListener('click', function () {
        applyColor(color);
      });
      els.swatches.appendChild(button);
    });
  }

  function setActiveSwatch(color) {
    Array.prototype.forEach.call(els.swatches.children, function (node) {
      node.classList.toggle('is-active', node.dataset.color === color);
    });
  }

  function applyColor(color) {
    color = C.normalizeColor(color);
    els.colorInput.value = color;
    els.colorValue.textContent = color.toUpperCase();
    setActiveSwatch(color);
    queueStyle({ color: color });
  }

  function buildPresets() {
    C.PRESETS.forEach(function (preset) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.preset = preset.id;
      button.title = preset.label;

      var art = document.createElement('span');
      art.className = 'preset-art';
      var label = document.createElement('span');
      label.textContent = preset.label;

      button.appendChild(art);
      button.appendChild(label);
      button.addEventListener('click', function () {
        run({ type: 'CURTAIN_APPLY_PRESET', preset: preset.id }, '已应用「' + preset.label + '」');
      });
      els.presets.appendChild(button);
    });
  }

  function bindEvents() {
    els.enabledToggle.addEventListener('change', function () {
      setEnabled(els.enabledToggle.checked);
    });

    els.enableBtn.addEventListener('click', function () {
      els.enabledToggle.checked = true;
      setEnabled(true);
    });

    els.addBtn.addEventListener('click', function () {
      run({ type: 'CURTAIN_ADD_MASK' }, '已添加遮罩');
    });

    els.editBtn.addEventListener('click', function () {
      if (!state) return;
      run({ type: 'CURTAIN_SET_EDIT', edit: !state.editMode }, !state.editMode ? '已进入编辑模式' : '已退出编辑模式');
    });

    els.practiceBtn.addEventListener('click', async function () {
      if (!state) return;
      await flushStyle();
      var starting = !state.practiceMode;
      var res = await send({ type: 'CURTAIN_SET_PRACTICE', practice: starting });
      if (!res) return;
      state = res;
      render(false);
      if (starting) {
        // 让页面拿回焦点，关闭面板后可以直接开始打字
        window.close();
      } else {
        toast('已结束听写练习');
      }
    });

    els.opacityRange.addEventListener('input', function () {
      var value = Number(els.opacityRange.value);
      els.opacityValue.textContent = value + '%';
      queueStyle({ opacity: value / 100 });
    });

    els.colorInput.addEventListener('input', function () {
      applyColor(els.colorInput.value);
    });

    els.radiusRange.addEventListener('input', function () {
      var value = Number(els.radiusRange.value);
      els.radiusValue.textContent = value + 'px';
      queueStyle({ radius: value });
    });

    els.featherRange.addEventListener('input', function () {
      var value = Number(els.featherRange.value);
      els.featherValue.textContent = value + 'px';
      queueStyle({ feather: value });
    });

    els.blurToggle.addEventListener('change', function () {
      var on = els.blurToggle.checked;
      els.blurRow.hidden = !on;
      if (on) {
        var value = Number(els.blurRange.value) || 12;
        els.blurValue.textContent = value + 'px';
        queueStyle({ blur: value });
      } else {
        queueStyle({ blur: 0 });
      }
    });

    els.blurRange.addEventListener('input', function () {
      var value = Number(els.blurRange.value);
      els.blurValue.textContent = value + 'px';
      queueStyle({ blur: value });
    });

    els.styleResetBtn.addEventListener('click', async function () {
      if (!state) return;
      await flushStyle();
      var res = await send({ type: 'CURTAIN_PATCH_STYLE', patch: C.DEFAULT_STYLE });
      if (!res) return;
      state = res;
      render(true);
      toast('外观已恢复默认');
    });

    els.resetBtn.addEventListener('click', function () {
      if (!state) return;
      armConfirm(els.resetBtn, '确认恢复？', async function () {
        await flushStyle();
        var res = await send({ type: 'CURTAIN_RESET_SITE' });
        if (!res) return;
        state = res;
        render(true);
        toast('已恢复默认设置');
      });
    });

    els.clearBtn.addEventListener('click', function () {
      if (!state) return;
      armConfirm(els.clearBtn, '确认清除？', async function () {
        await flushStyle();
        var res = await send({ type: 'CURTAIN_CLEAR_SITE' });
        if (!res) return;
        state = res;
        render(true);
        toast('已清除本站设置');
      });
    });
  }

  async function setEnabled(enabled) {
    if (!state) return;
    await flushStyle();
    var res = await send({ type: 'CURTAIN_SET_ENABLED', enabled: enabled });
    if (!res) {
      els.enabledToggle.checked = !enabled;
      return;
    }
    state = res;
    render(true);
    if (enabled) {
      toast(res.editMode ? '遮罩已启用，拖动即可调整位置' : '遮罩已启用');
    } else {
      toast('遮罩已暂停');
    }
  }

  /* ------------------------------------------------------------------ *
   * 通信
   * ------------------------------------------------------------------ */

  async function run(message, successMessage) {
    if (!state) return null;
    await flushStyle();
    var res = await send(message);
    if (!res) return null;
    state = res;
    render(false);
    if (successMessage) toast(successMessage);
    return res;
  }

  async function send(message) {
    try {
      var res = await chrome.tabs.sendMessage(tab.id, message);
      if (!res || res.ok === false) {
        toast((res && res.error) || '操作失败，请刷新页面后重试');
        return null;
      }
      return res;
    } catch (error) {
      toast('无法连接到当前页面，请刷新后重试');
      return null;
    }
  }

  function queueStyle(patch) {
    if (!state || !state.site || !state.site.enabled) return;
    pendingStyle = Object.assign(pendingStyle || {}, patch);
    if (styleTimer) window.clearTimeout(styleTimer);
    styleTimer = window.setTimeout(flushStyle, 80);
  }

  async function flushStyle() {
    if (styleTimer) {
      window.clearTimeout(styleTimer);
      styleTimer = null;
    }
    if (!pendingStyle || !state) return;
    var patch = pendingStyle;
    pendingStyle = null;
    try {
      var res = await chrome.tabs.sendMessage(tab.id, { type: 'CURTAIN_PATCH_STYLE', patch: patch });
      if (res && res.ok) {
        state.site.style = res.site.style;
        state.selectedId = res.selectedId;
        updateMaskPreviews();
      }
    } catch (error) {
      /* 静默失败，避免拖动滑块时反复弹提示 */
    }
  }

  /* ------------------------------------------------------------------ *
   * 其他
   * ------------------------------------------------------------------ */

  function showUnsupported(activeTab) {
    document.body.dataset.state = 'unsupported';
    els.heroCard.hidden = true;
    els.controls.hidden = true;
    els.unsupportedCard.hidden = false;
    els.enabledToggle.checked = false;
    els.enabledToggle.disabled = true;
    els.maskCount.textContent = '';
    els.siteDot.className = 'site-dot off';

    var url = activeTab && activeTab.url ? activeTab.url : '';
    if (url) {
      els.siteHost.textContent = displayLocation(url);
      els.siteHost.title = url;
    } else {
      els.siteHost.textContent = '当前页面';
    }

    if (url && /^file:/i.test(url)) {
      els.unsupportedDesc.textContent =
        '本地文件需要先在扩展详情页开启「允许访问文件网址」。你也可以打开普通网页后再使用幕帘。';
    } else if (url && /^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
      els.unsupportedDesc.textContent = '浏览器内部页面不允许扩展运行。请切换到普通网页（http 或 https）后再使用幕帘。';
    } else if (url && /chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(url)) {
      els.unsupportedDesc.textContent = 'Chrome 应用商店页面不允许扩展运行。请在其它网页中使用幕帘。';
    } else {
      els.unsupportedDesc.textContent = '无法在此页面注入遮罩。请刷新页面，或打开普通网页后再使用幕帘。';
    }

    els.resetBtn.disabled = true;
    els.clearBtn.disabled = true;
    els.enableBtn.disabled = true;
  }

  function displayLocation(url) {
    try {
      var parsed = new URL(url);
      if (parsed.hostname) return parsed.hostname;
      return parsed.protocol + '//' + (parsed.pathname || '').replace(/^\/+/, '');
    } catch (error) {
      return url.slice(0, 36);
    }
  }

  function setShortcutLabels() {
    var platform = navigator.userAgentData && navigator.userAgentData.platform
      ? navigator.userAgentData.platform
      : navigator.platform || '';
    var isMac = /mac/i.test(platform);
    var labels = isMac
      ? { toggle: '⌥ ⇧ B', edit: '⌥ ⇧ E', add: '⌥ ⇧ A', practice: '⌥ ⇧ P' }
      : { toggle: 'Alt + Shift + B', edit: 'Alt + Shift + E', add: 'Alt + Shift + A', practice: 'Alt + Shift + P' };
    Array.prototype.forEach.call(document.querySelectorAll('[data-shortcut]'), function (node) {
      var key = node.getAttribute('data-shortcut');
      if (labels[key]) node.textContent = labels[key];
    });
  }

  var armedConfirm = null;

  function disarmConfirm() {
    if (!armedConfirm) return;
    window.clearTimeout(armedConfirm.timer);
    armedConfirm.button.textContent = armedConfirm.original;
    armedConfirm.button.classList.remove('is-armed');
    armedConfirm = null;
  }

  /**
   * 浏览器扩展弹窗里原生 confirm 可能被静默阻止，改用“再次点击确认”。
   */
  function armConfirm(button, armedText, action) {
    if (armedConfirm && armedConfirm.button === button) {
      window.clearTimeout(armedConfirm.timer);
      button.textContent = armedConfirm.original;
      button.classList.remove('is-armed');
      armedConfirm = null;
      action();
      return;
    }
    disarmConfirm();
    var original = button.textContent;
    button.textContent = armedText;
    button.classList.add('is-armed');
    var timer = window.setTimeout(function () {
      if (!armedConfirm || armedConfirm.button !== button) return;
      button.textContent = original;
      button.classList.remove('is-armed');
      armedConfirm = null;
    }, 3200);
    armedConfirm = { button: button, original: original, timer: timer };
  }

  function toast(message) {
    if (!message) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastTimer = null;
      els.toast.classList.remove('show');
    }, 2200);
  }
})();
