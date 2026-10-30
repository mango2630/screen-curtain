/*
 * 幕帘 · service worker
 * 负责右键菜单、快捷键与向页面分发命令。
 */
'use strict';

var MENU_DEFINITIONS = [
  { id: 'curtain-toggle', title: '显示 / 隐藏遮罩', command: 'toggle-overlay' },
  { id: 'curtain-edit', title: '调整遮罩位置', command: 'toggle-edit' },
  { id: 'curtain-practice', title: '开始 / 结束听写练习', command: 'toggle-practice' },
  { id: 'curtain-add', title: '添加一条遮罩', command: 'add-mask' }
];

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    MENU_DEFINITIONS.forEach(function (item) {
      chrome.contextMenus.create({
        id: item.id,
        title: item.title,
        contexts: ['page']
      });
    });
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  var menu = MENU_DEFINITIONS.find(function (item) {
    return item.id === info.menuItemId;
  });
  if (!menu || !tab || !tab.id) return;
  deliver(tab.id, { type: 'CURTAIN_COMMAND', command: menu.command });
});

chrome.commands.onCommand.addListener(function (command, tab) {
  if (tab && tab.id) {
    deliver(tab.id, { type: 'CURTAIN_COMMAND', command: command });
    return;
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    if (tabs && tabs[0] && tabs[0].id) {
      deliver(tabs[0].id, { type: 'CURTAIN_COMMAND', command: command });
    }
  });
});

/**
 * 优先复用页面中已有的 content script；若没有（例如扩展安装前就打开的标签页），
 * 则按依赖顺序注入一次，然后重试。
 */
async function deliver(tabId, message, attempt) {
  attempt = attempt || 0;
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (attempt > 0) return null;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['shared/common.js', 'content/content.js']
      });
    } catch (injectError) {
      return null;
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, 120);
    });
    return deliver(tabId, message, attempt + 1);
  }
}
