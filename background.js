// background.js - 负责管理录制会话、处理消息、监听标签页和导航事件
// 存储录制会话
var recordingSessions = {};
var currentSessionId = null;
var isRecording = false;
var currentTabId = null;
var recordedTabs = new Set();
var autoSaveFileName = '';
var PENDING_REPLAY_KEY = '__replay_pending_data__';
var stateReady = loadPersistedState();

async function loadPersistedState() {
  try {
    var data = await chrome.storage.local.get([
      'sessions',
      'currentSessionId',
      'isRecording',
      'currentTabId',
      'currentFileName'
    ]);
    recordingSessions = data.sessions || {};
    currentSessionId = data.currentSessionId || null;
    isRecording = data.isRecording === true;
    currentTabId = data.currentTabId || null;
    autoSaveFileName = data.currentFileName || '';
    if (currentSessionId) {
      var sessionKey = 'session_' + currentSessionId;
      var sessionData = await chrome.storage.local.get([sessionKey]);
      if (sessionData[sessionKey]) {
        recordingSessions[currentSessionId] = sessionData[sessionKey];
      }
    }
    recordedTabs = new Set(currentTabId ? [currentTabId] : []);
  } catch (e) {
    console.warn('Failed to restore recording state:', e);
  }
}

function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateFileName(url, title) {
  var now = new Date();
  var dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');

  var shortName = 'recording';
  try {
    if (url) {
      var urlObj = new URL(url);
      shortName = urlObj.hostname.replace(/^www\./, '').split('.')[0];
      shortName = shortName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
    }
  } catch (e) {
    if (title) {
      shortName = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').substring(0, 30);
    }
  }

  if (!shortName || shortName === '_') shortName = 'recording';

  return shortName + '_' + dateStr + '.json';
}

function normalizeJsonFileName(fileName) {
  fileName = (fileName || 'recording').replace(/[<>:"/\\|?*]/g, '_');
  return fileName.replace(/\.json$/i, '') + '.json';
}

// 初始化
chrome.runtime.onInstalled.addListener(async function() {
  console.log('浏览器操作追踪器 v4.2 已安装');
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  await chrome.storage.local.set({
    sessions: {},
    currentSessionId: null,
    isRecording: false,
    actionHistory: [],
    currentTabId: null
  });
});

chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// 确保content script在标签页中运行
async function ensureContentScriptInjected(tabId) {
  if (recordedTabs.has(tabId)) return true;

  try {
    await chrome.tabs.sendMessage(tabId, { action: 'getCurrentInfo' });
    recordedTabs.add(tabId);
    return true;
  } catch (e) {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    recordedTabs.add(tabId);
    console.log('Content script 已注入到标签页:', tabId);
    return true;
  } catch (e) {
    console.log('注入content script:', e.message);
    return false;
  }
}

async function setTabRecordingStatus(tabId, recording, options) {
  if (!tabId) return;
  options = options || {};
  try {
    var ready = await ensureContentScriptInjected(tabId);
    if (ready) {
      await chrome.tabs.sendMessage(tabId, {
        action: 'updateRecordingStatus',
        isRecording: recording,
        suppressInitialNavigation: !!options.suppressInitialNavigation
      });
    }
  } catch (e) {}
}

// 保存会话数据到本地存储
async function saveSessionToStorage(sessionId) {
  if (!recordingSessions[sessionId]) return;
  var key = 'session_' + sessionId;
  await chrome.storage.local.set({ [key]: recordingSessions[sessionId] });
}

// 开始录制
function cloneInitialActions(actions) {
  return (actions || []).filter(function(action) {
    return action && action.type;
  }).map(function(action, index) {
    var clone = Object.assign({}, action, {
      target: Object.assign({}, action.target || {}),
      assertions: Array.isArray(action.assertions) ? action.assertions.map(function(assertion) {
        return Object.assign({}, assertion);
      }) : []
    });
    clone.stepNumber = index + 1;
    delete clone.assertionResults;
    return clone;
  });
}

function getInputActionKey(action) {
  if (!action || action.type !== 'input') return '';
  var target = action.target || {};
  return target.selector || target.id || target.name || '';
}

function canMergeInputAction(previous, next) {
  var previousKey = getInputActionKey(previous);
  var nextKey = getInputActionKey(next);
  if (!previousKey || !nextKey || previousKey !== nextKey) return false;
  if (previous.tabId && next.tabId && previous.tabId !== next.tabId) return false;
  if (previous.pageUrl && next.pageUrl && previous.pageUrl !== next.pageUrl) return false;
  return true;
}

function mergeInputAction(previous, next) {
  var merged = Object.assign({}, previous, next);
  merged.target = Object.assign({}, previous.target || {}, next.target || {});
  if (previous.previousValue !== undefined) merged.previousValue = previous.previousValue;
  if (previous.stepName && !next.stepName) merged.stepName = previous.stepName;
  if (previous.assertions && !next.assertions) merged.assertions = previous.assertions;
  if (previous.stepNumber != null && next.stepNumber == null) merged.stepNumber = previous.stepNumber;
  return merged;
}

function getSessionActionIndexFromHistoryIndex(historyIndex, historyItem) {
  if (!currentSessionId || !recordingSessions[currentSessionId]) return -1;
  var actions = recordingSessions[currentSessionId].actions || [];
  if (historyItem && historyItem.stepNumber != null) {
    var byStepNumber = Number(historyItem.stepNumber) - 1;
    if (byStepNumber >= 0 && byStepNumber < actions.length) return byStepNumber;
  }
  var reverseIndex = actions.length - 1 - historyIndex;
  return reverseIndex >= 0 && reverseIndex < actions.length ? reverseIndex : -1;
}

async function syncCurrentSessionActionFromHistory(historyIndex, historyItem) {
  var actionIndex = getSessionActionIndexFromHistoryIndex(historyIndex, historyItem);
  if (actionIndex < 0) return;
  recordingSessions[currentSessionId].actions[actionIndex] = Object.assign(
    {},
    recordingSessions[currentSessionId].actions[actionIndex],
    historyItem
  );
  await saveSessionToStorage(currentSessionId);
  await chrome.storage.local.set({ sessions: recordingSessions });
}

async function deleteCurrentSessionActionFromHistoryIndex(historyIndex) {
  if (!currentSessionId || !recordingSessions[currentSessionId]) return;
  var actions = recordingSessions[currentSessionId].actions || [];
  var actionIndex = actions.length - 1 - historyIndex;
  if (actionIndex < 0 || actionIndex >= actions.length) return;
  actions.splice(actionIndex, 1);
  recordingSessions[currentSessionId].actions = actions;
  await saveSessionToStorage(currentSessionId);
  await chrome.storage.local.set({ sessions: recordingSessions });
}

async function startRecording(url, title, tabId, initialActions) {
  await stateReady;
  currentSessionId = generateSessionId();
  isRecording = true;
  currentTabId = tabId;
  recordedTabs = new Set();

  autoSaveFileName = generateFileName(url, title);
  var seededActions = cloneInitialActions(initialActions);

  recordingSessions[currentSessionId] = {
    id: currentSessionId,
    fileName: autoSaveFileName,
    startUrl: url,
    startTitle: title,
    startTabId: tabId,
    startTime: new Date().toISOString(),
    endTime: null,
    windowSize: null,
    actions: seededActions,
    tabSwitches: [],
    urls: [{ url: url, title: title, tabId: tabId, timestamp: new Date().toISOString() }]
  };

  await chrome.storage.local.set({
    sessions: recordingSessions,
    currentSessionId: currentSessionId,
    isRecording: isRecording,
    actionHistory: [].concat(seededActions).reverse(),
    currentTabId: currentTabId,
    currentFileName: autoSaveFileName
  });

  console.log('开始录制:', currentSessionId, '文件:', autoSaveFileName);

  await setTabRecordingStatus(tabId, true, { suppressInitialNavigation: seededActions.length > 0 });
  return { sessionId: currentSessionId, fileName: autoSaveFileName };
}

// 停止录制
async function stopRecording() {
  await stateReady;
  if (!currentSessionId || !recordingSessions[currentSessionId]) return null;

  recordingSessions[currentSessionId].endTime = new Date().toISOString();
  isRecording = false;
  var sessionId = currentSessionId;
  var session = Object.assign({}, recordingSessions[currentSessionId]);
  var tabsToStop = Array.from(recordedTabs);

  await saveSessionToStorage(sessionId);
  await Promise.all(tabsToStop.map(function(tabId) {
    return setTabRecordingStatus(tabId, false);
  }));

  currentSessionId = null;
  currentTabId = null;

  await chrome.storage.local.set({
    sessions: recordingSessions,
    isRecording: false,
    currentSessionId: null,
    currentTabId: null
  });

  console.log('停止录制:', sessionId, '操作数:', session.actions ? session.actions.length : 0);

  chrome.runtime.sendMessage({
    type: 'recordingStopped',
    data: { sessionId: sessionId, fileName: session.fileName, actionsCount: session.actions ? session.actions.length : 0 }
  }).catch(function() {});

  return session;
}

// 更新窗口信息
async function updateWindowInfo(windowInfo) {
  chrome.runtime.sendMessage({
    type: 'windowInfoUpdated',
    data: windowInfo
  }).catch(function() {});
}

// 记录标签页切换
async function recordTabSwitch(fromTabId, toTabId, url, title) {
  await stateReady;
  if (!isRecording || !currentSessionId) return;

  await setTabRecordingStatus(fromTabId, false);
  currentTabId = toTabId;
  await ensureContentScriptInjected(toTabId);

  var switchData = {
    type: 'tabSwitch',
    fromTabId: fromTabId,
    toTabId: toTabId,
    url: url,
    title: title,
    timestamp: new Date().toISOString(),
    timeOffset: Date.now() - new Date(recordingSessions[currentSessionId].startTime).getTime()
  };

  recordingSessions[currentSessionId].tabSwitches.push(switchData);
  recordingSessions[currentSessionId].urls.push({
    url: url, title: title, tabId: toTabId, timestamp: new Date().toISOString()
  });

  await chrome.storage.local.set({
    sessions: recordingSessions,
    currentTabId: currentTabId
  });

  await setTabRecordingStatus(toTabId, true);

  chrome.runtime.sendMessage({
    type: 'tabSwitched',
    data: { tabId: toTabId, url: url, title: title }
  }).catch(function() {});
}

// 记录URL变化
async function recordUrlChange(tabId, url, title) {
  await stateReady;
  if (!isRecording || !currentSessionId) return;
  if (currentTabId !== tabId) return;

  var urlData = { url: url, title: title, tabId: tabId, timestamp: new Date().toISOString() };

  recordingSessions[currentSessionId].urls.push(urlData);
  await chrome.storage.local.set({ sessions: recordingSessions });

  chrome.runtime.sendMessage({
    type: 'urlChanged',
    data: { url: url, title: title, tabId: tabId }
  }).catch(function() {});
}

// 记录操作
async function recordAction(action, senderTabId) {
  await stateReady;
  if (!isRecording || !currentSessionId || !recordingSessions[currentSessionId]) return;
  if (senderTabId && currentTabId && senderTabId !== currentTabId) return;
  console.log('记录操作:', action.type, action.target ? action.target.tagName : '');

  var storageData = await chrome.storage.local.get(['actionHistory']);
  var actionHistory = storageData.actionHistory || [];

  action.tabId = senderTabId || currentTabId;

  if (action.type === 'navigation') {
    if (!action.url && recordingSessions[currentSessionId]) {
      action.url = recordingSessions[currentSessionId].startUrl;
    }
    if (!action.title && recordingSessions[currentSessionId]) {
      action.title = recordingSessions[currentSessionId].startTitle;
    }
  }

  if (currentSessionId && recordingSessions[currentSessionId]) {
    var urls = recordingSessions[currentSessionId].urls;
    var lastUrl = urls.length > 0 ? urls[urls.length - 1] : null;
    if (lastUrl) {
      action.pageUrl = lastUrl.url;
      action.pageTitle = lastUrl.title;
    }
  }

  var timeOffset = Date.now() - new Date(recordingSessions[currentSessionId].startTime).getTime();
  var shouldReplaceLatestInput = action.type === 'input' &&
    actionHistory.length > 0 &&
    canMergeInputAction(actionHistory[0], action);

  if (shouldReplaceLatestInput) {
    actionHistory[0] = mergeInputAction(actionHistory[0], action);
  } else {
    actionHistory.unshift(action);
  }

  if (actionHistory.length > 200) actionHistory.length = 200;

  await chrome.storage.local.set({ actionHistory: actionHistory });

  chrome.runtime.sendMessage({
    type: 'actionHistoryUpdated',
    data: actionHistory
  }).catch(function() {});

  if (isRecording && currentSessionId && recordingSessions[currentSessionId]) {
    var sessionActions = recordingSessions[currentSessionId].actions || [];
    var sessionAction = Object.assign({}, action, { timeOffset: timeOffset });

    if (action.type === 'input' &&
        sessionActions.length > 0 &&
        canMergeInputAction(sessionActions[sessionActions.length - 1], sessionAction)) {
      sessionActions[sessionActions.length - 1] = mergeInputAction(sessionActions[sessionActions.length - 1], sessionAction);
    } else {
      sessionActions.push(sessionAction);
    }
    recordingSessions[currentSessionId].actions = sessionActions;

    await saveSessionToStorage(currentSessionId);
  }
}

// 导出会话到文件
async function exportSessionToFile(sessionId, customName) {
  var session = recordingSessions[sessionId];

  if (!session) {
    var key = 'session_' + sessionId;
    var data = await chrome.storage.local.get([key]);
    if (!data[key]) return null;
    session = data[key];
  }

  var fileName = normalizeJsonFileName(customName || session.fileName || 'recording');

  var exportData = {
    sessionId: session.id,
    name: fileName,
    startUrl: session.startUrl,
    startTime: session.startTime,
    endTime: session.endTime,
    totalSteps: session.actions ? session.actions.length : 0,
    urls: session.urls || [],
    steps: session.actions || [],
    actions: session.actions || [],
    tabSwitches: session.tabSwitches || []
  };

  var jsonData = JSON.stringify(exportData, null, 2);
  var dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonData);

  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: 'recordings/' + fileName,
      saveAs: false
    });
    console.log('导出成功:', fileName);
    return fileName;
  } catch (error) {
    console.error('导出失败:', error);
    return null;
  }
}

// 消息处理
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  (async function() {
    try {
      await stateReady;
      switch (request.type) {
        case 'injectReplayScript':
          var activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          var activeTab = activeTabs[0];
          if (activeTab && activeTab.id) {
            try {
              // 先检查是否已经注入
              var checkResult = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: function() {
                  return window.__replay_injected === true;
                }
              });

              if (checkResult && checkResult[0] && checkResult[0].result) {
                console.log('replay-inject.js 已存在，无需重复注入');
                sendResponse({ success: true, alreadyInjected: true });
                break;
              }

              // 注入脚本
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ['replay-inject.js']
              });
              console.log('通过 background 注入 replay-inject.js 成功');
              sendResponse({ success: true });
            } catch (e) {
              console.error('注入失败:', e);
              sendResponse({ success: false, error: e.message });
            }
          } else {
            sendResponse({ success: false, error: 'No active tab' });
          }
          break;

        case 'startRecording':
          var tabId = sender.tab ? sender.tab.id : request.tabId;
          var result = await startRecording(request.url, request.title, tabId, request.initialActions || []);
          sendResponse({ success: true, sessionId: result.sessionId, fileName: result.fileName });
          break;

        case 'stopRecording':
          var session = await stopRecording();
          sendResponse({ success: true, session: session });
          break;

        case 'recordAction':
          await recordAction(request.data, sender.tab ? sender.tab.id : null);
          sendResponse({ success: true });
          break;

        case 'updateWindowInfo':
          await updateWindowInfo(request.data);
          sendResponse({ success: true });
          break;

        case 'replayStepResult':
        case 'replayStatus':
        case 'replayLog':
          chrome.runtime.sendMessage({ type: request.type, data: request.data }).catch(function() {});
          sendResponse({ success: true });
          break;

        case 'savePendingReplay':
          await chrome.storage.local.set({ [PENDING_REPLAY_KEY]: request.data || null });
          sendResponse({ success: true });
          break;

        case 'getPendingReplay':
          var pendingReplayData = await chrome.storage.local.get([PENDING_REPLAY_KEY]);
          sendResponse({ success: true, data: pendingReplayData[PENDING_REPLAY_KEY] || null });
          break;

        case 'clearPendingReplay':
          await chrome.storage.local.remove([PENDING_REPLAY_KEY]);
          sendResponse({ success: true });
          break;

        case 'getRecordingStatus':
          sendResponse({ isRecording: isRecording, currentSessionId: currentSessionId, currentTabId: currentTabId });
          break;

        case 'getActionHistory':
          var ahData = await chrome.storage.local.get(['actionHistory']);
          sendResponse({ actionHistory: ahData.actionHistory || [] });
          break;

        case 'clearHistory':
          await chrome.storage.local.set({ actionHistory: [] });
          sendResponse({ success: true });
          break;

        case 'setActionHistory':
          var sahHistory = request.steps || [];
          await chrome.storage.local.set({ actionHistory: sahHistory });
          if (currentSessionId && recordingSessions[currentSessionId]) {
            recordingSessions[currentSessionId].actions = cloneInitialActions([].concat(sahHistory).reverse());
            await saveSessionToStorage(currentSessionId);
            await chrome.storage.local.set({ sessions: recordingSessions });
          }
          sendResponse({ success: true });
          break;

        case 'updateStepName':
          var snData = await chrome.storage.local.get(['actionHistory']);
          var snHistory = snData.actionHistory || [];
          if (request.index >= 0 && request.index < snHistory.length) {
            snHistory[request.index].stepName = request.stepName;
            await chrome.storage.local.set({ actionHistory: snHistory });
            await syncCurrentSessionActionFromHistory(request.index, snHistory[request.index]);
          }
          sendResponse({ success: true });
          break;

        case 'deleteStep':
          var dsData = await chrome.storage.local.get(['actionHistory']);
          var dsHistory = dsData.actionHistory || [];
          if (request.index >= 0 && request.index < dsHistory.length) {
            dsHistory.splice(request.index, 1);
            dsHistory.forEach(function(action, i) { action.stepNumber = dsHistory.length - i; });
            await chrome.storage.local.set({ actionHistory: dsHistory });
            await deleteCurrentSessionActionFromHistoryIndex(request.index);
          }
          sendResponse({ success: true });
          break;

        case 'updateStepInfo':
          var usData = await chrome.storage.local.get(['actionHistory']);
          var usHistory = usData.actionHistory || [];
          if (request.index >= 0 && request.index < usHistory.length) {
            usHistory[request.index] = Object.assign({}, usHistory[request.index], request.data);
            await chrome.storage.local.set({ actionHistory: usHistory });
            await syncCurrentSessionActionFromHistory(request.index, usHistory[request.index]);
          }
          sendResponse({ success: true });
          break;

        case 'updateSessionSteps':
          var sessionIdToUpdate = request.sessionId;
          var updatedSteps = cloneInitialActions(request.steps || []);
          if (sessionIdToUpdate) {
            if (!recordingSessions[sessionIdToUpdate]) {
              var sessionKeyToUpdate = 'session_' + sessionIdToUpdate;
              var sessionDataToUpdate = await chrome.storage.local.get([sessionKeyToUpdate]);
              if (sessionDataToUpdate[sessionKeyToUpdate]) {
                recordingSessions[sessionIdToUpdate] = sessionDataToUpdate[sessionKeyToUpdate];
              }
            }
            if (recordingSessions[sessionIdToUpdate]) {
              recordingSessions[sessionIdToUpdate].actions = updatedSteps;
              await saveSessionToStorage(sessionIdToUpdate);
              await chrome.storage.local.set({ sessions: recordingSessions });
            }
          }
          sendResponse({ success: true });
          break;

        case 'getCurrentTabInfo':
          try {
            var tab = await chrome.tabs.get(currentTabId || (sender.tab ? sender.tab.id : null));
            sendResponse({ url: tab.url, title: tab.title, tabId: tab.id });
          } catch (e) {
            sendResponse({ url: '', title: '', tabId: null });
          }
          break;

        case 'getSessionUrls':
          var urls = (currentSessionId && recordingSessions[currentSessionId]) ? (recordingSessions[currentSessionId].urls || []) : [];
          sendResponse({ urls: urls });
          break;

        case 'exportSession':
          var fn = await exportSessionToFile(request.sessionId, request.fileName);
          sendResponse({ success: !!fn, fileName: fn });
          break;

        case 'getAllSessions':
          var allData = await chrome.storage.local.get(null);
          var sessions = [];
          for (var key in allData) {
            if (allData.hasOwnProperty(key) && key.indexOf('session_') === 0 && allData[key].id) {
              sessions.push({
                id: allData[key].id,
                fileName: allData[key].fileName,
                startUrl: allData[key].startUrl,
                startTime: allData[key].startTime,
                actionsCount: allData[key].actions ? allData[key].actions.length : 0
              });
            }
          }
          sessions.sort(function(a, b) { return new Date(b.startTime) - new Date(a.startTime); });
          sendResponse({ sessions: sessions });
          break;

        case 'deleteSession':
          var dk = 'session_' + request.sessionId;
          await chrome.storage.local.remove(dk);
          if (recordingSessions[request.sessionId]) delete recordingSessions[request.sessionId];
          sendResponse({ success: true });
          break;

        case 'autoSave':
          if (currentSessionId && recordingSessions[currentSessionId]) {
            recordingSessions[currentSessionId].lastAutoSave = request.data;
            await saveSessionToStorage(currentSessionId);
          }
          sendResponse({ success: true });
          break;

        case 'globalStopReplay':
          // 停止所有标签页的回放
          await chrome.storage.local.remove([PENDING_REPLAY_KEY]);
          var allTabs = await chrome.tabs.query({});
          for (var i = 0; i < allTabs.length; i++) {
            try {
              await chrome.tabs.sendMessage(allTabs[i].id, { action: 'stopReplayScript' });
            } catch (e) {}
            try {
              await chrome.scripting.executeScript({
                target: { tabId: allTabs[i].id },
                func: function() {
                  sessionStorage.removeItem('__replay_remaining_steps__');
                  if (window.__replayer) {
                    window.__replayer.stop();
                    window.__replayer = null;
                  }
                }
              });
            } catch (e) {}
          }
          sendResponse({ success: true });
          break;

        default:
          console.warn('未知消息类型:', request.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Background处理消息失败:', request.type, error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

// 监听标签页激活
chrome.tabs.onActivated.addListener(async function(activeInfo) {
  if (!isRecording) return;

  try {
    var tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.id !== currentTabId) {
      var oldTabId = currentTabId;
      await recordTabSwitch(oldTabId, tab.id, tab.url, tab.title);
      console.log('标签页切换:', oldTabId, '->', tab.id);
    }
  } catch (e) {
    console.error('标签页切换记录失败:', e);
  }
});

// 监听标签页更新（URL变化）
chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
  if (!isRecording) return;

  if (changeInfo.status === 'complete' && tab.url) {
    var contentReady = await ensureContentScriptInjected(tabId);

    if (tabId === currentTabId) {
      if (contentReady) {
        await setTabRecordingStatus(tabId, true);
      }
      // ✅ 只有当URL真正变化时才记录
      var session = recordingSessions[currentSessionId];
      if (session) {
        var urls = session.urls;
        var lastUrl = urls.length > 0 ? urls[urls.length - 1] : null;

        // 检查是否与上次记录的URL相同
        if (!lastUrl || lastUrl.url !== tab.url) {
          await recordUrlChange(tabId, tab.url, tab.title);
          console.log('页面跳转完成，新URL:', tab.url);
        }
      }
    }
  }
});

// 监听页面导航完成，自动注入回放脚本
chrome.webNavigation.onCompleted.addListener(async function(details) {
  // 只处理主框架
  if (details.frameId !== 0) return;

  // 检查是否有待回放的步骤
  try {
    var result = await chrome.storage.local.get([PENDING_REPLAY_KEY]);

    if (result && result[PENDING_REPLAY_KEY]) {
      console.log('检测到待回放步骤，注入回放脚本:', details.tabId);

      // 注入回放脚本
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['replay-inject.js']
      });
    }
  } catch (e) {
    console.log('检查待回放步骤失败:', e);
  }
});
