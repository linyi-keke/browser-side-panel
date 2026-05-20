// sidebar.js - 负责侧边栏的 UI 渲染、用户交互、与 background.js 的通信，以及日志记录功能

var isRecording = false;
var currentFilter = 'all';
var actionHistory = [];
var recordingTimer = null;
var recordingStartTime = null;
var stepCounter = 0;
var currentPageUrl = '';
var currentPageTitle = '';
var currentSessionId = null;
var currentFileName = '';
var replaySteps = [];
var currentReplaySessionId = null;
var continuationSteps = [];
var continuationSessionId = null;
var isReplaying = false;
var isReplayPaused = false;
var replaySpeed = 1;
var currentTabId = null;
var stepResults = {};
var editingStepIndex = -1;
var editInfoStepIndex = -1;
var editingAssertionIndex = -1;
var editingAssertionSource = 'record';
var editingWaitIndex = -1;
var editingWaitSource = 'record';
var _lastReceivedMessage = {};
var _lastMessageTime = {};

var assertionTypeMap = {
  textVisible: '文本存在',
  elementExists: '元素存在',
  elementNotExists: '元素不存在',
  urlContains: 'URL包含',
  elementTextContains: '元素文本包含',
  elementTextEquals: '元素文本等于',
  regionTextContains: '\u533a\u57df\u6587\u672c\u5305\u542b',
  regionTextNotContains: '\u533a\u57df\u6587\u672c\u4e0d\u5305\u542b'
};

var typeMap = {
  hover: '鼠标悬浮',
  click: '鼠标点击', rightClick: '右键点击', dblclick: '双击',
  scroll: '页面滚动', resize: '窗口调整', focus: '聚焦输入框',
  input: '输入内容', keydown: '按键操作', submit: '提交表单', navigation: '打开页面',
  wait: '等待'
};

// DOM元素
var startBtn = document.getElementById('startBtn');
var stopBtn = document.getElementById('stopBtn');
var recordingIndicator = document.getElementById('recordingIndicator');
var recordingTime = document.getElementById('recordingTime');
var stepCount = document.getElementById('stepCount');
var actionList = document.getElementById('actionList');
var exportBtn = document.getElementById('exportBtn');
var clearBtn = document.getElementById('clearBtn');
var filterBtns = document.querySelectorAll('.filter-btn');

// 对话框元素
var exportDialog = document.getElementById('exportDialog');
var closeDialogBtn = document.getElementById('closeDialogBtn');
var cancelExportBtn = document.getElementById('cancelExportBtn');
var confirmExportBtn = document.getElementById('confirmExportBtn');
var fileNameInput = document.getElementById('fileName');
var fileDescriptionInput = document.getElementById('fileDescription');
var exportSummary = document.getElementById('exportSummary');

var editStepDialog = document.getElementById('editStepDialog');
var closeEditDialogBtn = document.getElementById('closeEditDialogBtn');
var cancelEditBtn = document.getElementById('cancelEditBtn');
var confirmEditBtn = document.getElementById('confirmEditBtn');
var editStepNumber = document.getElementById('editStepNumber');
var editStepName = document.getElementById('editStepName');

var editStepInfoDialog = document.getElementById('editStepInfoDialog');
var closeEditInfoDialogBtn = document.getElementById('closeEditInfoDialogBtn');
var cancelEditInfoBtn = document.getElementById('cancelEditInfoBtn');
var confirmEditInfoBtn = document.getElementById('confirmEditInfoBtn');
var editInfoPickCoordBtn = document.getElementById('editInfoPickCoordBtn');


// ==================== 日志功能 ====================

// 添加日志
var _lastAddLogTime = {};
var _lastAddLogMessage = '';

function addReplayLog(message, type) {
  type = type || 'info';

  // 1秒内相同的消息不重复添加
  var now = Date.now();
  var logKey = message + '_' + type;
  if (_lastAddLogMessage === logKey && now - _lastAddLogTime < 1000) {
    return;
  }
  _lastAddLogMessage = logKey;
  _lastAddLogTime = now;

  addReplayLogDirect(message, type);
}


// 清空日志
function clearReplayLog() {
  var logContent = document.getElementById('replayLogContent');
  if (logContent) {
    logContent.innerHTML = '<div class="log-entry log-info">日志已清空</div>';
  }
}

// ==================== 工具函数 ====================

function escapeHTML(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  var old = document.querySelector('.toast');
  if (old) old.remove();
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(function() { toast.remove(); }, 300);
  }, 2000);
}

async function getCurrentTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) currentTabId = tabs[0].id;
  return tabs[0];
}

function isRestrictedTabUrl(url) {
  return !url || /^(chrome|edge|brave|opera|vivaldi|about):/i.test(url);
}

// ==================== 窗口信息 ====================

function updateWindowInfo(data) {
  if (!data) return;
  var el;
  el = document.getElementById('windowWidth'); if (el) el.textContent = (data.windowWidth || '-') + 'px';
  el = document.getElementById('windowHeight'); if (el) el.textContent = (data.windowHeight || '-') + 'px';
  el = document.getElementById('viewportWidth'); if (el) el.textContent = (data.viewportWidth || '-') + 'px';
  el = document.getElementById('viewportHeight'); if (el) el.textContent = (data.viewportHeight || '-') + 'px';
}

function updateStepCount() {
  if (stepCount) stepCount.textContent = '步骤: ' + stepCounter;
}

function updateRecordingTimer() {
  if (!recordingStartTime) return;
  var elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  var minutes = Math.floor(elapsed / 60);
  var seconds = elapsed % 60;
  recordingTime.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function updateUrlDisplay(url, title) {
  currentPageUrl = url || '';
  currentPageTitle = title || '';
  var urlDisplay = document.getElementById('currentUrl');
  var titleDisplay = document.getElementById('currentTitle');
  if (urlDisplay) {
    var displayUrl = url ? (url.length > 50 ? url.substring(0, 50) + '...' : url) : '-';
    urlDisplay.textContent = displayUrl;
    urlDisplay.title = url || '';
  }
  if (titleDisplay) titleDisplay.textContent = title || '无标题';
}

async function fetchWindowInfo() {
  try {
    var tab = await getCurrentTab();
    if (tab && tab.id) {
      var res = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentInfo' });
      if (res && res.windowInfo) updateWindowInfo(res.windowInfo);
    }
  } catch (e) {}
}

// ==================== 录制控制 ====================

async function startRecording() {
  try {
    var tab = await getCurrentTab();
    if (!tab) { showToast('无法获取当前标签页'); return; }

    currentPageUrl = tab.url;
    currentPageTitle = tab.title;
    updateUrlDisplay(tab.url, tab.title);
    var startsOnRestrictedPage = isRestrictedTabUrl(tab.url);
    if (isReplaying || isReplayPaused) {
      await stopReplayInPage();
    }
    var initialSteps = replaySteps && replaySteps.length ? cloneStepsForRecording(normalizeReplaySteps(replaySteps)) : [];

    if (initialSteps.length === 0) {
      await chrome.runtime.sendMessage({ type: 'clearHistory' });
      actionHistory = [];
    } else {
      actionHistory = [].concat(initialSteps).reverse();
    }
    stepCounter = actionHistory.length;
    stepResults = {};
    updateStepCount();
    renderActionList(actionHistory);

    var response = await chrome.runtime.sendMessage({
      type: 'startRecording',
      url: tab.url,
      title: tab.title,
      tabId: tab.id,
      initialActions: initialSteps
    });

    if (response && response.success) {
      isRecording = true;
      currentSessionId = response.sessionId;
      currentReplaySessionId = null;
      replaySteps = [];
      continuationSteps = [];
      continuationSessionId = null;
      currentFileName = response.fileName || '';
      recordingStartTime = Date.now();

      startBtn.disabled = true;
      stopBtn.disabled = false;
      recordingIndicator.classList.remove('hidden');

      if (recordingTimer) clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingTimer, 1000);

      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'updateRecordingStatus',
          isRecording: true,
          suppressInitialNavigation: initialSteps.length > 0
        });
      } catch (e) {}

      var fileNameDisplay = document.getElementById('currentFileName');
      if (startsOnRestrictedPage) {
        showToast('当前页无法注入脚本，打开普通网页后会开始录制');
        return;
      }
      if (fileNameDisplay && response.fileName) fileNameDisplay.textContent = '📁 ' + response.fileName;

      showToast('🔴 录制已开始');
    }
  } catch (error) {
    console.error('开始录制失败:', error);
    showToast('开始录制失败');
  }
}

async function stopRecording() {
  try {
    var response = await chrome.runtime.sendMessage({ type: 'stopRecording' });
    if (response && response.success) {
      var stoppedSession = response.session || {};
      var stoppedSteps = normalizeReplaySteps(stoppedSession.actions || actionHistory);
      isRecording = false;
      currentSessionId = null;
      currentReplaySessionId = stoppedSession.id || null;
      continuationSessionId = stoppedSession.id || null;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      recordingIndicator.classList.add('hidden');
      if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
      recordingStartTime = null;
      recordingTime.textContent = '00:00';
      var tab = await getCurrentTab();
      if (tab) { try { await chrome.tabs.sendMessage(tab.id, { action: 'updateRecordingStatus', isRecording: false }); } catch (e) {} }
      if (stoppedSteps.length > 0) {
        replaySteps = stoppedSteps;
        continuationSteps = cloneStepsForRecording(stoppedSteps);
        stepResults = {};
        showReplayPanel(stoppedSession.fileName || currentFileName || 'current-recording', replaySteps);
        renderReplayList();
        addReplayLog('录制结束，已加载当前录制步骤，可直接回放或导出', 'info');
      }
      showToast('⏹️ 录制已停止 - 共 ' + stepCounter + ' 个步骤');
    }
  } catch (error) {
    console.error('停止录制失败:', error);
    showToast('停止录制失败');
  }
}

// ==================== 步骤编辑 ====================

function openEditDialog(index) {
  editingStepIndex = index;
  var action = actionHistory[index];
  if (!action) return;
  editStepNumber.textContent = '步骤 #' + (action.stepNumber || (index + 1));
  editStepName.value = action.stepName || '';
  editStepDialog.classList.remove('hidden');
  editStepName.focus();
}

function closeEditDialog() {
  editStepDialog.classList.add('hidden');
  editingStepIndex = -1;
  editStepName.value = '';
}

function saveStepName() {
  if (editingStepIndex >= 0 && editingStepIndex < actionHistory.length) {
    var name = editStepName.value.trim();
    actionHistory[editingStepIndex].stepName = name || null;
    chrome.runtime.sendMessage({ type: 'updateStepName', index: editingStepIndex, stepName: name || null }).catch(function() {});
    renderActionList(actionHistory);
  }
  closeEditDialog();
}

// 删除步骤
function deleteStep(index) {
  if (index < 0 || index >= actionHistory.length) return;
  var action = actionHistory[index];
  var stepNum = action.stepNumber || (index + 1);
  var typeText = typeMap[action.type] || action.type;

  if (!confirm('确定要删除步骤 #' + stepNum + ' (' + typeText + ') 吗？\n此操作不可恢复。')) return;

  actionHistory.splice(index, 1);
  actionHistory.forEach(function(a, i) { a.stepNumber = actionHistory.length - i; });
  stepCounter = actionHistory.length;
  updateStepCount();
  renderActionList(actionHistory);
  chrome.runtime.sendMessage({ type: 'deleteStep', index: index }).catch(function() {});
  showToast('已删除步骤 #' + stepNum);
}

// 打开修改步骤信息对话框
function openEditStepDialog(index) {
  editInfoStepIndex = index;
  var action = actionHistory[index];
  if (!action) return;

  var stepNum = action.stepNumber || (index + 1);
  document.getElementById('editInfoStepNumber').textContent = '步骤 #' + stepNum;
  document.getElementById('editInfoStepType').textContent = typeMap[action.type] || action.type;
  document.getElementById('editInfoStepName').value = action.stepName || '';

  // 坐标信息
  var coordGroup = document.getElementById('editInfoCoordGroup');
  if (['click', 'rightClick', 'dblclick', 'hover'].indexOf(action.type) !== -1) {
    coordGroup.style.display = 'block';
    document.getElementById('editInfoCoordX').value = action.x || '';
    document.getElementById('editInfoCoordY').value = action.y || '';
  } else { coordGroup.style.display = 'none'; }

  // 输入内容
  var valueGroup = document.getElementById('editInfoValueGroup');
  if (action.type === 'input') {
    valueGroup.style.display = 'block';
    document.getElementById('editInfoValue').value = action.value || '';
  } else { valueGroup.style.display = 'none'; }

  // URL信息
  var urlGroup = document.getElementById('editInfoUrlGroup');
  if (action.type === 'navigation') {
    urlGroup.style.display = 'block';
    document.getElementById('editInfoUrl').value = action.url || '';
  } else { urlGroup.style.display = 'none'; }

  editStepInfoDialog.classList.remove('hidden');
  document.getElementById('editInfoStepName').focus();
}

function closeEditStepDialog() {
  editStepInfoDialog.classList.add('hidden');
  editInfoStepIndex = -1;
}

async function startEditCoordinate() {
  if (editInfoStepIndex < 0 || editInfoStepIndex >= actionHistory.length) return;

  var action = actionHistory[editInfoStepIndex];
  if (['click', 'rightClick', 'dblclick', 'hover'].indexOf(action.type) === -1) return;

  try {
    var tab = await getCurrentTab();
    if (!tab || !tab.id) {
      showToast('无法获取当前标签页');
      return;
    }
    if (isRestrictedTabUrl(tab.url)) {
      showToast('当前页面无法修改坐标');
      return;
    }

    showToast('在页面拖动红点，点击确认保存坐标');
    var response = await chrome.tabs.sendMessage(tab.id, {
      action: 'startCoordinateEdit',
      options: {
        type: action.type,
        x: action.x,
        y: action.y
      }
    });

    if (!response || !response.success || !response.data) {
      if (response && response.error && response.error !== 'Coordinate edit canceled') showToast(response.error);
      return;
    }

    action = Object.assign({}, action, response.data, {
      stepName: document.getElementById('editInfoStepName').value.trim() || null,
      timestamp: new Date().toISOString()
    });
    actionHistory[editInfoStepIndex] = action;

    document.getElementById('editInfoCoordX').value = action.x;
    document.getElementById('editInfoCoordY').value = action.y;

    chrome.runtime.sendMessage({ type: 'updateStepInfo', index: editInfoStepIndex, data: action }).catch(function() {});
    renderActionList(actionHistory);
    showToast('坐标和目标信息已更新');
  } catch (error) {
    console.error('修改坐标失败:', error);
    showToast('修改坐标失败');
  }
}

function saveStepInfo() {
  if (editInfoStepIndex < 0 || editInfoStepIndex >= actionHistory.length) return;

  var action = actionHistory[editInfoStepIndex];
  action.stepName = document.getElementById('editInfoStepName').value.trim() || null;

  if (['click', 'rightClick', 'dblclick', 'hover'].indexOf(action.type) !== -1) {
    var x = parseInt(document.getElementById('editInfoCoordX').value);
    var y = parseInt(document.getElementById('editInfoCoordY').value);
    if (!isNaN(x)) action.x = x;
    if (!isNaN(y)) action.y = y;
  }

  if (action.type === 'input') action.value = document.getElementById('editInfoValue').value;
  if (action.type === 'navigation') action.url = document.getElementById('editInfoUrl').value;

  chrome.runtime.sendMessage({ type: 'updateStepInfo', index: editInfoStepIndex, data: action }).catch(function() {});
  renderActionList(actionHistory);
  closeEditStepDialog();
  showToast('步骤信息已更新');
}

// ==================== 操作卡片 ====================

async function checkStatus() {
  try {
    var res = await chrome.runtime.sendMessage({ type: 'getRecordingStatus' });
    if (res && res.isRecording) {
      isRecording = true;
      currentSessionId = res.currentSessionId;
      currentTabId = res.currentTabId;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      recordingIndicator.classList.remove('hidden');

      var hRes = await chrome.runtime.sendMessage({ type: 'getActionHistory' });
      if (hRes && hRes.actionHistory) {
        actionHistory = hRes.actionHistory;
        stepCounter = actionHistory.length;
        updateStepCount();
        renderActionList(actionHistory);
      }

      if (actionHistory.length > 0) {
        var last = actionHistory[0];
        if (last && last.timestamp) recordingStartTime = new Date(last.timestamp).getTime();
      }
      if (!recordingStartTime) recordingStartTime = Date.now();
      if (recordingTimer) clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingTimer, 1000);
    }
  } catch (e) {}
}

// ==================== 消息监听 ====================

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // 消息去重
  var now = Date.now();
  var msgKey = request.type + '_' + JSON.stringify(request.data);
  if (_lastReceivedMessage[msgKey] && now - _lastMessageTime[msgKey] < 500) {
    console.log('忽略重复消息:', request.type);
    sendResponse({ received: true, duplicate: true });
    return true;
  }
  _lastReceivedMessage[msgKey] = true;
  _lastMessageTime[msgKey] = now;

  switch (request.type) {
    case 'actionHistoryUpdated':
      if (isRecording) {
        actionHistory = request.data;
        stepCounter = actionHistory.length;
        updateStepCount();
        renderActionList(actionHistory);
      }
      break;

    case 'windowInfoUpdated':
      updateWindowInfo(request.data);
      break;

    case 'urlChanged':
    case 'tabSwitched':
      updateUrlDisplay(request.data.url, request.data.title);
      break;

    case 'recordingStopped':
      currentFileName = request.data.fileName;
      break;

    case 'replayStepResult':
      handleReplayStepResult(request.data);
      break;

    case 'replayStatus':
      handleReplayStatus(request.data);
      break;

    case 'replayLog':
      // 只处理日志，不再额外添加
      var replayLogData = request.data || {};
      var replayLogPrefix = replayLogData.stepNumber ? ('#' + replayLogData.stepNumber + ' ') : '';
      addReplayLogDirect(replayLogPrefix + (replayLogData.message || ''), replayLogData.level);
      break;
  }
  sendResponse({ received: true });
  return true;
});

// 新增：直接添加日志（不带额外前缀）
function addReplayLogDirect(message, type) {
  type = type || 'info';
  var logContent = document.getElementById('replayLogContent');
  if (!logContent) return;

  // ✅ 修复 [NaN] 问题：确保 message 是字符串
  if (message === undefined || message === null) {
    message = '未知消息';
  }
  message = String(message);

  // 移除 [NaN] 前缀
  if (message.indexOf('[NaN]') !== -1) {
    message = message.replace('[NaN]', '');
  }

  // 移除初始提示
  var firstEntry = logContent.querySelector('.log-entry:first-child');
  if (firstEntry && firstEntry.textContent === '等待回放开始...') {
    logContent.innerHTML = '';
  }

  var timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  var entry = document.createElement('div');
  entry.className = 'log-entry log-' + type;
  entry.innerHTML = '<span class="log-time">[' + timeStr + ']</span> ' + escapeHTML(message);

  logContent.appendChild(entry);
  logContent.scrollTop = logContent.scrollHeight;

  // 限制日志数量
  var entries = logContent.querySelectorAll('.log-entry');
  if (entries.length > 500) {
    entries[0].remove();
  }
}

// sidebar.js - 替换 handleReplayStepResult 函数

var _processedStepResults = {};

function handleReplayStepResult(data) {
  var index = data.index;
  if (data.stepNumber != null) {
    for (var replayIndex = 0; replayIndex < replaySteps.length; replayIndex++) {
      if (replaySteps[replayIndex] && replaySteps[replayIndex].stepNumber === data.stepNumber) {
        index = replayIndex;
        break;
      }
    }
  }
  var stepKey = 'step_' + (data.stepNumber != null ? data.stepNumber : index) + '_' + data.success;

  // 防止重复处理
  if (_processedStepResults[stepKey]) {
    console.log('忽略重复的步骤结果:', index);
    return;
  }
  _processedStepResults[stepKey] = true;

  setTimeout(function() {
    delete _processedStepResults[stepKey];
  }, 3000);

  // 更新步骤结果
  stepResults[index] = data.success ? 'success' : 'fail';
  if (replaySteps[index]) {
    replaySteps[index].assertionResults = Array.isArray(data.assertions) ? data.assertions : [];
  }
  console.log('步骤结果更新: index=' + index + ', success=' + data.success);

  // 更新卡片样式
  var cards = actionList.querySelectorAll('.action-card');
  if (cards[index]) {
    cards[index].classList.remove('replay-pending');
    cards[index].classList.add(data.success ? 'replay-success' : 'replay-fail');

    var si = cards[index].querySelector('.replay-status-icon');
    if (si) {
      si.className = 'replay-status-icon ' + (data.success ? 'success' : 'fail');
      si.textContent = data.success ? '✅' : '❌';
    }
    var oldAssertion = cards[index].querySelector('.assertion-summary');
    if (oldAssertion) oldAssertion.remove();
    if (replaySteps[index]) {
      var assertionHTML = getAssertionSummary(replaySteps[index], true);
      if (assertionHTML) cards[index].insertAdjacentHTML('beforeend', assertionHTML);
    }
  }

  // 更新进度条
  var pb = document.getElementById('replayProgressBar');
  if (pb && replaySteps.length > 0) {
    var completed = 0;
    for (var i = 0; i < replaySteps.length; i++) {
      if (stepResults[i] && stepResults[i] !== 'pending') completed++;
    }
    var percent = (completed / replaySteps.length) * 100;
    pb.style.width = percent + '%';
    console.log('进度条: ' + completed + '/' + replaySteps.length + ' = ' + percent + '%');
  }

  // ✅ 检查是否所有步骤都已完成
  var allCompleted = true;
  for (var i = 0; i < replaySteps.length; i++) {
    if (!stepResults[i] || stepResults[i] === 'pending') {
      allCompleted = false;
      break;
    }
  }

  if (allCompleted && replaySteps.length > 0) {
    console.log('所有步骤已完成，更新最终UI');
    if (pb) pb.style.width = '100%';
    var cs = document.getElementById('replayCurrentStep');
    if (cs && cs.innerHTML.indexOf('完成') === -1) {
      cs.innerHTML = '<span style="color:#34d399;">✅ 回放完成</span>';
    }
    addReplayLog('✅ 回放完成', 'complete');
    isReplaying = false;
    isReplayPaused = false;
    updateReplayButtons(false);
  }
}

// sidebar.js - 修改 handleReplayStatus，避免重复

var _processedStatus = {};
var navigatingTimeout = null;
var lastReplayStepCount = 0;
var replayIsNavigating = false;

function countCompletedReplaySteps() {
  var completed = 0;
  for (var i = 0; i < replaySteps.length; i++) {
    if (stepResults[i] && stepResults[i] !== 'pending') completed++;
  }
  return completed;
}

function handleReplayStatus(data) {
  var pb = document.getElementById('replayProgressBar');
  var cs = document.getElementById('replayCurrentStep');

  // 清除导航超时
  if (navigatingTimeout) {
    clearTimeout(navigatingTimeout);
    navigatingTimeout = null;
  }

  // 防止重复处理
  var statusKey = data.status + '_' + (data.step || '');
  if (_processedStatus && _processedStatus[statusKey]) {
    console.log('忽略重复的状态:', statusKey);
    return;
  }
  if (!_processedStatus) window._processedStatus = {};
  _processedStatus[statusKey] = true;
  setTimeout(function() { delete _processedStatus[statusKey]; }, 3000);

  switch (data.status) {
    case 'started':
      replayIsNavigating = false;
      if (pb) pb.style.width = '0%';
      if (cs) cs.innerHTML = '<span style="color:#60a5fa;">🚀 开始回放...</span>';
      // ✅ 清空 sessionStorage 中的残留数据
      clearReplayStorage();
      lastReplayStepCount = 0;
      break;

    case 'executing':
      replayIsNavigating = false;
      if (cs && data.step) {
        cs.innerHTML = '<span style="color:#60a5fa;">▶️ 步骤 ' + data.step + '/' + data.total + '</span>';
        lastReplayStepCount = data.step;
      }
      break;

    case 'completed':
      if (replaySteps.length > 0 && (replayIsNavigating || countCompletedReplaySteps() < replaySteps.length)) {
        console.log('忽略过早完成状态: completed=' + countCompletedReplaySteps() + '/' + replaySteps.length + ', navigating=' + replayIsNavigating);
        break;
      }
      if (navigatingTimeout) clearTimeout(navigatingTimeout);
      for (var completedIndex = 0; completedIndex < replaySteps.length; completedIndex++) {
        if (!stepResults[completedIndex] || stepResults[completedIndex] === 'pending') {
          stepResults[completedIndex] = 'success';
        }
      }
      renderReplayList();
      if (pb) pb.style.width = '100%';
      if (cs) cs.innerHTML = '<span style="color:#34d399;">✅ 回放完成</span>';
      isReplaying = false;
      isReplayPaused = false;
      updateReplayButtons(false);
      // ✅ 清理所有回放相关的存储
      clearReplayStorage();
      if (window._lastCompleteTime && Date.now() - window._lastCompleteTime < 1000) {
        break;
      }
      window._lastCompleteTime = Date.now();
      addReplayLog('✅ 回放完成', 'complete');
      break;

    case 'paused':
      if (cs) cs.innerHTML = '<span style="color:#f59e0b;">⏸️ 已暂停 - 步骤 ' + data.step + '/' + data.total + '</span>';
      isReplaying = false;
      isReplayPaused = true;
      updateReplayButtons(false);
      addReplayLog('⏸️ 回放已暂停', 'pause');
      break;

    case 'resumed':
      if (cs) cs.innerHTML = '<span style="color:#60a5fa;">▶️ 继续回放...</span>';
      isReplaying = true;
      isReplayPaused = false;
      updateReplayButtons(true);
      addReplayLog('▶️ 回放已恢复', 'start');
      renderReplayList();
      break;

    case 'navigating':
      replayIsNavigating = true;
      if (cs) cs.innerHTML = '<span style="color:#f59e0b;">🔄 正在跳转页面...</span>';
      addReplayLog('🔄 页面跳转中...', 'navigate');
      console.log('等待新页面加载并恢复回放');
      break;

    case 'stopped':
      if (isReplaying && countCompletedReplaySteps() === 0) {
        console.log('忽略新回放启动时的旧 stopped 状态');
        break;
      }
      replayIsNavigating = false;
      if (cs) cs.innerHTML = '<span class="text-muted">回放已停止</span>';
      isReplaying = false;
      isReplayPaused = false;
      updateReplayButtons(false);
      clearReplayStorage();
      addReplayLog('⏹️ 回放已停止', 'info');
      break;
  }
}

// ✅ 新增：检查回放是否完成的函数
function checkReplayCompletion() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;

    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: function() {
        var pending = sessionStorage.getItem('__replay_remaining_steps__');
        return { hasPending: !!pending, pendingData: pending };
      }
    }).then(function(result) {
      if (result && result[0] && result[0].result) {
        var hasPending = result[0].result.hasPending;
        if (!hasPending) {
          console.log('检测到没有待回放步骤，手动触发完成状态');
          // 手动发送完成状态
          chrome.runtime.sendMessage({
            type: 'replayStatus',
            data: { status: 'completed', total: 0 }
          });
        }
      }
    }).catch(function(err) {
      console.log('检查回放完成状态失败:', err);
    });
  });
}

// ✅ 新增：清理回放存储
function clearReplayStorage() {
  chrome.runtime.sendMessage({ type: 'clearPendingReplay' }).catch(function() {});
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0] && tabs[0].id) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: function() {
          sessionStorage.removeItem('__replay_remaining_steps__');
          sessionStorage.removeItem('__replay_speed__');
          sessionStorage.removeItem('__replay_current_index__');
          console.log('已清理回放存储数据');
        }
      }).catch(function(e) {});
    }
  });
}

function ensureAddWaitButton() {
  var existing = document.getElementById('addWaitStepBtn');
  if (existing) return existing;
  var footer = document.querySelector('.sidebar-footer');
  if (!footer) return null;
  var button = document.createElement('button');
  button.id = 'addWaitStepBtn';
  button.className = 'btn btn-wait';
  button.type = 'button';
  button.innerHTML = '<span>⏱</span> 等待';
  footer.insertBefore(button, footer.firstChild);
  return button;
}

function ensureAddHoverButton() {
  var existing = document.getElementById('addHoverStepBtn');
  if (existing) return existing;
  var footer = document.querySelector('.sidebar-footer');
  if (!footer) return null;
  var button = document.createElement('button');
  button.id = 'addHoverStepBtn';
  button.className = 'btn btn-hover';
  button.type = 'button';
  button.innerHTML = '<span>🖱️</span> 悬浮';
  var waitButton = document.getElementById('addWaitStepBtn');
  if (waitButton && waitButton.nextSibling) footer.insertBefore(button, waitButton.nextSibling);
  else footer.insertBefore(button, footer.firstChild);
  return button;
}

// ✅ 新增：检查回放是否完成
function checkReplayCompletion() {
  // 检查是否还有待回放的步骤
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: function() {
          var pending = sessionStorage.getItem('__replay_remaining_steps__');
          return !!pending;
        }
      }).then(function(result) {
        if (result && result[0] && !result[0].result) {
          // 没有待回放步骤，手动完成
          console.log('检测到回放已完成，更新UI');
          chrome.runtime.sendMessage({
            type: 'replayStatus',
            data: { status: 'completed', total: 0 }
          });
        }
      }).catch(function() {});
    }
  });
}

// ==================== 事件绑定 ====================

function bindReplayEvents() {
  var importBtn = document.getElementById('importBtn');
  var fileInput = document.getElementById('fileInput');
  var closeReplayBtn = document.getElementById('closeReplayBtn');
  var replayPlayBtn = document.getElementById('replayPlayBtn');
  var replayPauseBtn = document.getElementById('replayPauseBtn');
  var replayStopBtn = document.getElementById('replayStopBtn');
  var addWaitStepBtn = ensureAddWaitButton();
  var addHoverStepBtn = ensureAddHoverButton();

  // ✅ 清空日志按钮
  var clearLogBtn = document.getElementById('clearLogBtn');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', function() {
      clearReplayLog();
      addReplayLog('日志已清空', 'info');
    });
  }

  if (importBtn) importBtn.addEventListener('click', importFile);
  if (addWaitStepBtn) addWaitStepBtn.addEventListener('click', function() {
    openWaitDialog(-1, replaySteps && replaySteps.length ? 'replay' : 'record');
  });
  if (addHoverStepBtn) addHoverStepBtn.addEventListener('click', startHoverStepCapture);
  if (fileInput) fileInput.addEventListener('change', handleFileSelect);
  if (closeReplayBtn) closeReplayBtn.addEventListener('click', closeReplayPanel);

  if (replayPlayBtn) replayPlayBtn.addEventListener('click', function() { if (isReplayPaused) resumeReplayInPage(); else startReplayInPage(); });
  if (replayPauseBtn) replayPauseBtn.addEventListener('click', pauseReplayInPage);
  if (replayStopBtn) replayStopBtn.addEventListener('click', stopReplayInPage);

  document.querySelectorAll('.speed-btn').forEach(function(b) {
    b.addEventListener('click', function() { setReplaySpeed(parseFloat(b.dataset.speed)); });
  });
}

// 基础事件
startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
exportBtn.addEventListener('click', openExportDialog);
clearBtn.addEventListener('click', clearHistory);

closeDialogBtn.addEventListener('click', closeExportDialog);
cancelExportBtn.addEventListener('click', closeExportDialog);
confirmExportBtn.addEventListener('click', confirmExport);
exportDialog.addEventListener('click', function(e) { if (e.target === exportDialog) closeExportDialog(); });

closeEditDialogBtn.addEventListener('click', closeEditDialog);
cancelEditBtn.addEventListener('click', closeEditDialog);
confirmEditBtn.addEventListener('click', saveStepName);
editStepDialog.addEventListener('click', function(e) { if (e.target === editStepDialog) closeEditDialog(); });

if (closeEditInfoDialogBtn) closeEditInfoDialogBtn.addEventListener('click', closeEditStepDialog);
if (cancelEditInfoBtn) cancelEditInfoBtn.addEventListener('click', closeEditStepDialog);
if (confirmEditInfoBtn) confirmEditInfoBtn.addEventListener('click', saveStepInfo);
if (editInfoPickCoordBtn) editInfoPickCoordBtn.addEventListener('click', startEditCoordinate);
if (editStepInfoDialog) editStepInfoDialog.addEventListener('click', function(e) { if (e.target === editStepInfoDialog) closeEditStepDialog(); });

fileNameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirmExport(); if (e.key === 'Escape') closeExportDialog(); });
editStepName.addEventListener('keydown', function(e) { if (e.key === 'Enter') saveStepName(); if (e.key === 'Escape') closeEditDialog(); });

var editInfoStepNameInput = document.getElementById('editInfoStepName');
if (editInfoStepNameInput) {
  editInfoStepNameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') saveStepInfo(); if (e.key === 'Escape') closeEditStepDialog(); });
}

filterBtns.forEach(function(btn) {
  btn.addEventListener('click', function() {
    filterBtns.forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderActionList(actionHistory);
  });
});

// 初始化
async function init() {
  console.log('侧边栏初始化...');
  await checkStatus();
  await fetchWindowInfo();
  bindReplayEvents();
  setInterval(fetchWindowInfo, 2000);
}

document.addEventListener('DOMContentLoaded', init);
