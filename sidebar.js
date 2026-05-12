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
var isReplaying = false;
var isReplayPaused = false;
var replaySpeed = 1;
var currentTabId = null;
var stepResults = {};
var editingStepIndex = -1;
var editInfoStepIndex = -1;
var _lastReceivedMessage = {};
var _lastMessageTime = {};

var typeMap = {
  click: '鼠标点击', rightClick: '右键点击', dblclick: '双击',
  scroll: '页面滚动', resize: '窗口调整', focus: '聚焦输入框',
  input: '输入内容', keydown: '按键操作', submit: '提交表单', navigation: '打开页面'
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
    
    await chrome.runtime.sendMessage({ type: 'clearHistory' });
    actionHistory = [];
    stepCounter = 0;
    stepResults = {};
    updateStepCount();
    renderActionList([]);
    
    var response = await chrome.runtime.sendMessage({
      type: 'startRecording',
      url: tab.url,
      title: tab.title,
      tabId: tab.id
    });
    
    if (response && response.success) {
      isRecording = true;
      currentSessionId = response.sessionId;
      currentFileName = response.fileName || '';
      recordingStartTime = Date.now();
      
      startBtn.disabled = true;
      stopBtn.disabled = false;
      recordingIndicator.classList.remove('hidden');
      
      if (recordingTimer) clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingTimer, 1000);
      
      try { await chrome.tabs.sendMessage(tab.id, { action: 'updateRecordingStatus', isRecording: true }); } catch (e) {}
      
      var fileNameDisplay = document.getElementById('currentFileName');
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
      isRecording = false;
      currentSessionId = null;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      recordingIndicator.classList.add('hidden');
      if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
      recordingStartTime = null;
      recordingTime.textContent = '00:00';
      var tab = await getCurrentTab();
      if (tab) { try { await chrome.tabs.sendMessage(tab.id, { action: 'updateRecordingStatus', isRecording: false }); } catch (e) {} }
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
  if (['click', 'rightClick', 'dblclick'].indexOf(action.type) !== -1) {
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

function saveStepInfo() {
  if (editInfoStepIndex < 0 || editInfoStepIndex >= actionHistory.length) return;
  
  var action = actionHistory[editInfoStepIndex];
  action.stepName = document.getElementById('editInfoStepName').value.trim() || null;
  
  if (['click', 'rightClick', 'dblclick'].indexOf(action.type) !== -1) {
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

function createActionCard(action, index, isReplayMode) {
  isReplayMode = isReplayMode || false;
  
  if (!action) {
    var emptyCard = document.createElement('div');
    emptyCard.className = 'action-card';
    emptyCard.innerHTML = '<div class="card-header"><span>无效步骤</span></div>';
    return emptyCard;
  }
  
  var target = action.target || {};
  
  var statusClass = '';
  if (isReplayMode) {
    var result = stepResults[index];
    if (result === 'success') statusClass = ' replay-success';
    else if (result === 'fail') statusClass = ' replay-fail';
    else statusClass = ' replay-pending';
  }
  
  var card = document.createElement('div');
  card.className = 'action-card ' + (action.type || '') + statusClass;
  
  var iconMap = {
    click: '🖱️', rightClick: '🖱️', dblclick: '🖱️',
    scroll: '📜', resize: '📏', focus: '🔍',
    input: '⌨️', keydown: '⌨️', submit: '📤', navigation: '🌐'
  };
  
  var icon = iconMap[action.type] || '📌';
  var typeText = typeMap[action.type] || action.type;
  var time = action.timestamp ? new Date(action.timestamp).toLocaleTimeString() : '';
  var stepNum = action.stepNumber;
  if (stepNum === undefined || stepNum === null) {
    stepNum = index + 1;
  }
  var hasName = action.stepName && action.stepName.trim();
  
  // 状态图标
  var statusIcon = '';
  if (isReplayMode) {
    var result2 = stepResults[index];
    if (result2 === 'success') statusIcon = '<span class="replay-status-icon success">✅</span>';
    else if (result2 === 'fail') statusIcon = '<span class="replay-status-icon fail">❌</span>';
    else statusIcon = '<span class="replay-status-icon pending">⏳</span>';
  }
  
  // 点击内容描述
  var actionDescription = '';
  if (['click', 'rightClick', 'dblclick'].indexOf(action.type) !== -1 && target.textContent) {
    var text = String(target.textContent).trim();
    if (text) {
      var displayText = text.length > 25 ? text.substring(0, 25) + '...' : text;
      actionDescription = '<span class="click-content">"' + escapeHTML(displayText) + '"</span>';
    }
  }
  
  // 坐标/操作信息
  var coordinatesHTML = '';
  
  if (action.type === 'scroll') {
    coordinatesHTML = '<div class="card-body"><div class="card-info-item"><div class="card-info-label">水平滚动</div><div class="card-info-value coordinate">' + (action.scrollX || 0) + 'px</div></div><div class="card-info-item"><div class="card-info-label">垂直滚动</div><div class="card-info-value coordinate">' + (action.scrollY || 0) + 'px</div></div></div><div class="scroll-indicator"><span class="card-info-label">📍</span><span class="card-info-value">(' + (action.scrollX || 0) + ', ' + (action.scrollY || 0) + ')</span></div>';
  } else if (action.type === 'resize') {
    coordinatesHTML = '<div class="card-body"><div class="card-info-item"><div class="card-info-label">宽度</div><div class="card-info-value coordinate">' + (action.windowWidth || '-') + 'px</div></div><div class="card-info-item"><div class="card-info-label">高度</div><div class="card-info-value coordinate">' + (action.windowHeight || '-') + 'px</div></div></div>';
  } else if (action.type === 'input') {
    var displayValue = (action.value || '').length > 50 ? (action.value || '').substring(0, 50) + '...' : (action.value || '');
    coordinatesHTML = '<div class="card-body input-display"><div class="card-info-item input-value-full"><div class="card-info-label">输入内容</div><div class="card-info-value coordinate input-text">"' + escapeHTML(displayValue || '(清空)') + '"</div></div></div>';
  } else if (action.type === 'keydown') {
    var keyMap = { 'Enter': '回车键', 'Tab': 'Tab键', 'Escape': 'Esc键', 'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→' };
    var keyName = keyMap[action.key] || action.key;
    coordinatesHTML = '<div class="card-body"><div class="card-info-item input-value-full"><div class="card-info-label">按键</div><div class="card-info-value coordinate">' + escapeHTML(keyName) + '</div></div></div>';
  } else if (action.type === 'focus') {
    coordinatesHTML = '<div class="card-body"><div class="card-info-item input-value-full"><div class="card-info-label">聚焦元素</div><div class="card-info-value coordinate">' + escapeHTML(target.tagName || '') + ' ' + escapeHTML(target.placeholder || target.name || '') + '</div></div></div>';
  } else if (action.type === 'navigation') {
    var displayUrl = (action.url || '').length > 50 ? (action.url || '').substring(0, 50) + '...' : (action.url || '');
    var displayTitle = (action.title || '').length > 30 ? (action.title || '').substring(0, 30) + '...' : (action.title || '');
    coordinatesHTML = '<div class="card-body navigation-display"><div class="card-info-item input-value-full"><div class="card-info-label">页面标题</div><div class="card-info-value">' + escapeHTML(displayTitle) + '</div></div><div class="card-info-item input-value-full"><div class="card-info-label">页面URL</div><div class="card-info-value coordinate url-text-display" title="' + escapeHTML(action.url || '') + '">' + escapeHTML(displayUrl) + '</div></div></div>';
  } else {
    coordinatesHTML = '<div class="card-body"><div class="card-info-item"><div class="card-info-label">Client X</div><div class="card-info-value coordinate">' + (action.x != null ? action.x + 'px' : '-') + '</div></div><div class="card-info-item"><div class="card-info-label">Client Y</div><div class="card-info-value coordinate">' + (action.y != null ? action.y + 'px' : '-') + '</div></div>' + (action.pageX != null ? '<div class="card-info-item"><div class="card-info-label">Page X</div><div class="card-info-value">' + action.pageX + 'px</div></div>' : '') + (action.pageY != null ? '<div class="card-info-item"><div class="card-info-label">Page Y</div><div class="card-info-value">' + action.pageY + 'px</div></div>' : '') + '</div>';
  }
  
  // 视口信息
  var viewportHTML = '';
  var vpW = action.viewportWidth || action.windowWidth;
  var vpH = action.viewportHeight || action.windowHeight;
  if (vpW && vpH) {
    viewportHTML = '<div class="viewport-info"><span class="card-info-label">📐 视口</span><span class="card-info-value">' + vpW + ' × ' + vpH + '</span></div>';
  }
  
  // 页面URL信息
  var pageUrlHTML = '';
  if (action.pageUrl && action.pageUrl !== currentPageUrl) {
    var shortUrl = action.pageUrl.length > 40 ? action.pageUrl.substring(0, 40) + '...' : action.pageUrl;
    pageUrlHTML = '<div class="page-url-info"><span class="card-info-label">🌐</span><span class="target-desc" title="' + escapeHTML(action.pageUrl) + '">' + escapeHTML(shortUrl) + '</span></div>';
  }
  
  // 目标元素
  var targetHTML = '';
  if (target.tagName && target.tagName !== 'PAGE') {
    var desc = target.tagName.toLowerCase();
    if (target.id) desc += '#' + target.id;
    if (target.className && typeof target.className === 'string') {
      var cls = target.className.split(' ').filter(function(c) { return c && c.length > 0; })[0];
      if (cls) desc += '.' + cls;
    }
    targetHTML = '<div class="target-info"><span class="card-info-label">🎯</span><span class="target-desc">' + escapeHTML(desc) + '</span></div>';
  }
  
  // 步骤名称标签
  var stepNameTag = '';
  if (hasName) {
    stepNameTag = '<span class="step-name-tag">' + escapeHTML(action.stepName) + '</span>';
  }
  
  // 操作按钮（录制模式）
  var actionButtons = '';
  if (!isReplayMode) {
    actionButtons = '<div class="card-actions"><button class="btn-card-action btn-card-edit" data-index="' + index + '" title="修改信息">✏️</button><button class="btn-card-action btn-card-delete" data-index="' + index + '" title="删除步骤">🗑️</button></div>';
  }
  
  card.innerHTML = '<div class="card-header"><div class="action-type"><span class="step-number ' + (hasName ? 'has-name' : '') + '" data-index="' + index + '" title="' + (hasName ? escapeHTML(action.stepName) : '点击编辑名称') + '">#' + stepNum + '</span>' + statusIcon + '<span class="action-icon">' + icon + '</span><div class="action-type-info"><span class="action-type-text">' + typeText + '</span>' + actionDescription + stepNameTag + '</div></div><div class="card-header-right"><span class="action-time">' + time + '</span>' + actionButtons + '</div></div>' + coordinatesHTML + viewportHTML + pageUrlHTML + targetHTML;
  
  // 绑定事件
  if (!isReplayMode) {
    var editBtn = card.querySelector('.btn-card-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (function(idx) {
        return function(e) { e.stopPropagation(); openEditStepDialog(idx); };
      })(index));
    }
    
    var deleteBtn = card.querySelector('.btn-card-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (function(idx) {
        return function(e) { e.stopPropagation(); deleteStep(idx); };
      })(index));
    }
    
    var stepNumberEl = card.querySelector('.step-number');
    if (stepNumberEl) {
      stepNumberEl.addEventListener('click', (function(idx) {
        return function(e) { e.stopPropagation(); openEditDialog(idx); };
      })(index));
    }
  }
  
  return card;
}

// ==================== 渲染列表 ====================

function renderActionList(actions, isReplayMode) {
  isReplayMode = isReplayMode || false;
  if (!actionList) return;
  
  actionList.innerHTML = '';
  
  if (!actions || actions.length === 0) {
    actionList.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>' + (isRecording ? '等待操作...' : isReplayMode ? '回放步骤' : '等待录制') + '</p><p class="empty-hint">' + (isRecording ? '在页面上进行操作' : isReplayMode ? '准备开始回放' : '点击 ⏺️ 录制 按钮开始') + '</p></div>';
    return;
  }
  
  var filtered = actions;
  if (!isReplayMode && currentFilter !== 'all') {
    filtered = actions.filter(function(a) {
      if (currentFilter === 'resize') return a.type === 'resize';
      if (currentFilter === 'scroll') return a.type === 'scroll';
      if (currentFilter === 'click') return ['click', 'rightClick', 'dblclick'].indexOf(a.type) !== -1;
      return true;
    });
  }
  
  if (filtered.length === 0) { actionList.innerHTML = '<div class="empty-state"><p>没有匹配的操作</p></div>'; return; }
  
  filtered.forEach(function(action, i) { if (!action.stepNumber) action.stepNumber = filtered.length - i; });
  filtered.forEach(function(action, index) { actionList.appendChild(createActionCard(action, index, isReplayMode)); });
  
  actionList.scrollTop = 0;
}

// 渲染回放步骤列表 - ✅ 按 stepNumber 升序排列（步骤1在最上面）
function renderReplayList() {
  if (!actionList) return;
  actionList.innerHTML = '';
  
  if (!replaySteps || replaySteps.length === 0) {
    actionList.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>没有回放步骤</p></div>';
    return;
  }
  
  // ✅ 确保 replaySteps 按 stepNumber 升序排列
  var sortedSteps = [].concat(replaySteps).sort(function(a, b) {
    return (a.stepNumber || 0) - (b.stepNumber || 0);
  });
  
  // ✅ 显示顺序：步骤1在最上面（不要反转）
  // 因为回放时是从数组头部开始执行的，所以直接按升序渲染
  sortedSteps.forEach(function(step, index) {
    if (!step.stepNumber) step.stepNumber = index + 1;
    if (!step.target) step.target = {};
    
    // 创建卡片，index 参数用 sortedSteps 中的位置
    var card = createActionCard(step, index, true);
    actionList.appendChild(card);
  });
  
  actionList.scrollTop = 0;
  
  console.log('回放列表渲染完成，顺序:');
  sortedSteps.forEach(function(s, i) {
    console.log('  [' + i + '] 步骤 #' + s.stepNumber + ':', s.type);
  });
}

// ==================== 导出/清空 ====================

function openExportDialog() {
  if (actionHistory.length === 0) { showToast('没有可导出的数据'); return; }
  
  var now = new Date();
  var dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');
  
  fileNameInput.value = '录制_' + dateStr;
  fileDescriptionInput.value = '';
  
  var namedSteps = actionHistory.filter(function(a) { return a.stepName; }).length;
  exportSummary.innerHTML = '📊 共 <span>' + actionHistory.length + '</span> 个步骤' + (namedSteps > 0 ? ' | 🏷️ 已命名 <span>' + namedSteps + '</span> 个步骤' : '');
  
  exportDialog.classList.remove('hidden');
  fileNameInput.focus();
  fileNameInput.select();
}

function closeExportDialog() { exportDialog.classList.add('hidden'); }

async function confirmExport() {
  var fileName = fileNameInput.value.trim() || '录制_' + Date.now();
  fileName = fileName.replace(/[<>:"/\\|?*]/g, '_');

  // 在导出时过滤掉中间输入步骤
  var filteredSteps = [];
  var lastInputKey = null;

  // 需要先反转成正常顺序再处理
  var reversedHistory = [].concat(actionHistory).reverse();

  for (var i = 0; i < reversedHistory.length; i++) {
    var action = reversedHistory[i];
    
    if (action.type === 'input') {
      var inputKey = (action.target && (action.target.selector || action.target.id)) || '';
      if (lastInputKey === inputKey && inputKey !== '') {
        // 替换上一个输入步骤（只保留最后一个）
        if (filteredSteps.length > 0) {
          filteredSteps[filteredSteps.length - 1] = action;
        }
      } else {
        filteredSteps.push(action);
        lastInputKey = inputKey;
      }
    } else {
      filteredSteps.push(action);
      lastInputKey = null;
    }
  }
  
  // 使用 filteredSteps
  var exportData = {
    name: fileName,
    description: fileDescriptionInput.value.trim() || '',
    exportTime: new Date().toISOString(),
    totalSteps: filteredSteps.length,
    steps: filteredSteps.map(function(action, i) {
      var obj = Object.assign({}, action);
      obj.stepNumber = i + 1;  // 重新编号，从1开始
      obj.stepName = action.stepName || null;
      return obj;
    })
  };
  
  try {
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    closeExportDialog();
    showToast('✅ 已导出: ' + fileName + '.json');
  } catch (e) {
    console.error('导出失败:', e);
    showToast('导出失败: ' + e.message);
  }
}

async function clearHistory() {
  await chrome.runtime.sendMessage({ type: 'clearHistory' });
  actionHistory = [];
  stepCounter = 0;
  stepResults = {};
  updateStepCount();
  renderActionList([]);
  showToast('已清空');
}

// ==================== 导入/回放 ====================

function importFile() {
  var fi = document.getElementById('fileInput');
  if (fi) fi.click();
}

// 处理文件选择
async function handleFileSelect(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) { showToast('请选择 JSON 文件'); event.target.value = ''; return; }
  
  try {
    var text = await file.text();
    var data = JSON.parse(text);
    
    var steps = [];
    if (data && data.steps && data.steps.length > 0) steps = data.steps;
    else if (data && data.actions && data.actions.length > 0) steps = data.actions;
    else if (Array.isArray(data)) steps = data;
    
    if (!steps.length) { showToast('文件中没有操作步骤'); event.target.value = ''; return; }
    
    // ✅ 按 stepNumber 升序排列（步骤1, 2, 3...）
    steps = steps.filter(function(s) { return s && s.type; });
    steps.sort(function(a, b) {
      var numA = a.stepNumber || 999;
      var numB = b.stepNumber || 999;
      return numA - numB;  // 升序：小的在前面
    });
    
    // 重新编号确保连续
    steps.forEach(function(s, i) { s.stepNumber = i + 1; });
    
    // 确保每个步骤有 target
    steps.forEach(function(step) {
      if (!step.target) step.target = {};
      if (!step.target.textContent && step.target.textContent === undefined) step.target.textContent = '';
      if (!step.target.className) step.target.className = '';
      if (!step.target.id) step.target.id = '';
      if (!step.target.tagName) step.target.tagName = '';
    });
    
    console.log('✅ 导入成功:', steps.length, '个步骤，步骤顺序:');
    steps.forEach(function(s) { console.log('  步骤 #' + s.stepNumber + ':', s.type, s.target ? s.target.textContent || '' : ''); });
    
    // 重置状态
    actionHistory = [];
    stepCounter = steps.length;
    stepResults = {};
    replaySteps = steps;
    isRecording = false;
    
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
    recordingStartTime = null;
    recordingTime.textContent = '00:00';
    recordingIndicator.classList.add('hidden');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    updateStepCount();
    showReplayPanel(file.name, steps);
    renderReplayList();  // ✅ 调用修复后的渲染函数
    showToast('✅ 已加载: ' + steps.length + ' 个步骤');
  } catch (error) {
    console.error('导入失败:', error);
    showToast('导入失败: ' + error.message);
  }
  event.target.value = '';
}

function showReplayPanel(fileName, steps) {
  var panel = document.getElementById('replayPanel');
  if (panel) panel.classList.remove('hidden');
  
  var rfn = document.getElementById('replayFileName');
  var rsi = document.getElementById('replayStepInfo');
  var rpb = document.getElementById('replayProgressBar');
  var rcs = document.getElementById('replayCurrentStep');
  
  if (rfn) rfn.textContent = '📄 ' + fileName;
  if (rsi) rsi.textContent = '共 ' + steps.length + ' 个步骤';
  if (rpb) rpb.style.width = '0%';
  if (rcs) rcs.innerHTML = '<span class="text-muted">准备就绪，点击 ▶️ 开始回放</span>';
  
  // ✅ 初始化日志
  clearReplayLog();
  addReplayLog('📄 已加载文件: ' + fileName, 'info');
  addReplayLog('📊 共 ' + steps.length + ' 个步骤', 'info');
  
  // 列出所有步骤
  steps.forEach(function(step, i) {
    var typeNames = {
      navigation: '🌐 打开页面',
      click: '🖱️ 点击',
      focus: '🔍 聚焦',
      input: '⌨️ 输入',
      keydown: '⌨️ 按键',
      scroll: '📜 滚动',
      resize: '📏 调整',
      submit: '📤 提交'
    };
    var typeName = typeNames[step.type] || step.type;
    var extra = '';
    if (step.type === 'click' && step.target && step.target.textContent) {
      extra = ' "' + step.target.textContent.substring(0, 20) + '"';
    } else if (step.type === 'input') {
      extra = ' "' + (step.value || '').substring(0, 20) + '"';
    } else if (step.type === 'navigation') {
      extra = ' ' + (step.url || '').substring(0, 30);
    }
    addReplayLog('  步骤 #' + (step.stepNumber || (i + 1)) + ': ' + typeName + extra, 'info');
  });
  
  updateReplayButtons(false);
}

function closeReplayPanel() {
  stopReplayInPage();

  replaySteps = [];
  isReplaying = false;
  isReplayPaused = false;
  stepResults = {};
  
  var panel = document.getElementById('replayPanel');
  if (panel) panel.classList.add('hidden');
  
  // ✅ 清空日志
  clearReplayLog();
  renderActionList([]);

  // ✅ 额外清理一次
  clearReplayStorage();
  addReplayLog('回放面板已关闭', 'info');
}

async function startReplayInPage() {
  if (replaySteps.length === 0) {
    showToast('没有可回放的步骤');
    return;
  }
  
  // 防止重复启动
  if (isReplaying && !isReplayPaused) {
    console.log('回放已在运行中');
    showToast('回放已在运行中');
    return;
  }
  
  // 如果是暂停状态，调用恢复
  if (isReplayPaused) {
    console.log('从暂停状态恢复');
    await resumeReplayInPage();
    return;
  }
  
  try {
    var tab = await getCurrentTab();
    if (!tab) {
      showToast('无法获取当前标签页');
      return;
    }
    
    // 1. 清理所有旧的回放数据（通过脚本注入）
    // ✅ 彻底清理所有回放相关数据
    console.log('========== 开始新回放，清理旧数据 ==========');

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          // 清除所有存储
          sessionStorage.removeItem('__replay_remaining_steps__');
          sessionStorage.removeItem('__replay_speed__');
          sessionStorage.removeItem('__replay_current_index__');
          sessionStorage.removeItem('__replay_injected__');
          localStorage.removeItem('__replay_global_stop__');
          
          // 重置所有标记
          window.__replay_pending_checked__ = false;
          window.__replay_injected = false;
          
          // 停止旧回放器
          if (window.__replayer) {
            window.__replayer.stop();
            window.__replayer = null;
          }
          
          console.log('旧回放数据已清理');
        }
      });
    } catch (e) {
      console.log('清理数据失败:', e);
    }
    
    // 等待清理完成
    await new Promise(function(r) { setTimeout(r, 500); });
    
    // 排序步骤
    replaySteps.sort(function(a, b) {
      return (a.stepNumber || 0) - (b.stepNumber || 0);
    });
    
    // 重新编号
    replaySteps.forEach(function(step, idx) {
      step.stepNumber = idx + 1;
    });
    
    stepResults = {};
    replaySteps.forEach(function(_, i) { stepResults[i] = 'pending'; });
    renderReplayList();
    
    var pb = document.getElementById('replayProgressBar');
    if (pb) pb.style.width = '0%';
    
    var cs = document.getElementById('replayCurrentStep');
    if (cs) cs.innerHTML = '<span style="color:#60a5fa;">🚀 正在启动回放...</span>';
    
    // 注入回放脚本
    try {
      console.log('注入 replay-inject.js...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['replay-inject.js']
      });
      await new Promise(function(r) { setTimeout(r, 800); });
      console.log('注入完成');
    } catch (e) {
      console.error('脚本注入失败:', e);
      addReplayLog('❌ 脚本注入失败: ' + e.message, 'error');
      showToast('脚本注入失败，请刷新页面重试');
      return;
    }
    
    // 发送回放指令
    var response = await chrome.tabs.sendMessage(tab.id, {
      action: 'startReplayScript',
      steps: replaySteps,
      speed: replaySpeed,
      highlight: true,
      fromIndex: 0
    });
    
    console.log('回放启动响应:', response);
    
    if (response && response.success) {
      isReplaying = true;
      isReplayPaused = false;
      updateReplayButtons(true);
      showToast('▶️ 回放开始');
      addReplayLog('🚀 开始回放，共 ' + replaySteps.length + ' 个步骤', 'start');
    } else {
      throw new Error('回放启动失败: ' + (response ? response.error : '未知错误'));
    }
    
  } catch (error) {
    console.error('回放启动失败:', error);
    showToast('回放启动失败: ' + error.message);
    addReplayLog('❌ 回放启动失败: ' + error.message, 'error');
    isReplaying = false;
    updateReplayButtons(false);
  }
}

async function pauseReplayInPage() {
  var tab = await getCurrentTab();
  if (!tab) return;
  try { await chrome.tabs.sendMessage(tab.id, { action: 'pauseReplayScript' }); } catch (e) {}
}

async function resumeReplayInPage() {
  var tab = await getCurrentTab();
  if (!tab) return;
  try { await chrome.tabs.sendMessage(tab.id, { action: 'resumeReplayScript' }); } catch (e) {}
}

async function stopReplayInPage() {
  var tab = await getCurrentTab();
  
  // ✅ 设置全局停止标志（防止新页面自动恢复回放）
  
  // 1. 发送停止消息到当前页面
  if (tab && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'stopReplayScript' });
      console.log('已发送停止消息到当前页面');
    } catch (e) {
      console.log('发送停止消息失败:', e);
    }
  }
  
  // 2. 清除所有页面的 sessionStorage 和回放状态
  try {
    var allTabs = await chrome.tabs.query({});
    for (var i = 0; i < allTabs.length; i++) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: allTabs[i].id },
          func: function() {
            localStorage.setItem('__replay_global_stop__', 'true');
            setTimeout(function() {
              localStorage.removeItem('__replay_global_stop__');
            }, 3000);
            // 清除回放相关的存储
            sessionStorage.removeItem('__replay_remaining_steps__');
            sessionStorage.removeItem('__replay_speed__');
            sessionStorage.removeItem('__replay_current_index__');
            sessionStorage.removeItem('__replay_injected__');
            
            // 清理标记
            window.__replay_pending_checked__ = false;
            window.__replay_injected = false;
            
            // 停止回放器
            if (window.__replayer) {
              window.__replayer.stop();
              window.__replayer = null;
            }
            
            console.log('已清理页面回放状态');
          }
        });
      } catch (e) {
        console.log('清理页面失败:', allTabs[i].url, e.message);
      }
    }
  } catch (e) {
    console.log('获取标签页失败:', e);
  }
  
  // 3. 重置侧边栏状态
  isReplaying = false;
  isReplayPaused = false;
  stepResults = {};
  updateReplayButtons(false);
  
  var pb = document.getElementById('replayProgressBar');
  var cs = document.getElementById('replayCurrentStep');
  if (pb) pb.style.width = '0%';
  if (cs) cs.innerHTML = '<span class="text-muted">回放已停止</span>';
  
  addReplayLog('⏹️ 回放已完全停止，已清理所有页面状态', 'info');
  showToast('回放已停止');
}

function updateReplayButtons(playing) {
  var playBtn = document.getElementById('replayPlayBtn');
  var pauseBtn = document.getElementById('replayPauseBtn');
  if (playBtn) { playBtn.classList.toggle('hidden', playing); if (!playing) playBtn.textContent = '▶️'; }
  if (pauseBtn) pauseBtn.classList.toggle('hidden', !playing);
}

function setReplaySpeed(speed) {
  replaySpeed = speed;
  document.querySelectorAll('.speed-btn').forEach(function(b) { b.classList.toggle('active', parseFloat(b.dataset.speed) === speed); });
}

// ==================== 状态检查 ====================

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
      addReplayLogDirect(request.data.message, request.data.level);
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
  if (entries.length > 100) {
    entries[0].remove();
  }
}

// sidebar.js - 替换 handleReplayStepResult 函数

var _processedStepResults = {};

function handleReplayStepResult(data) {
  var index = data.index;
  var stepKey = 'step_' + index + '_' + data.success;
  
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
      if (pb) pb.style.width = '0%';
      if (cs) cs.innerHTML = '<span style="color:#60a5fa;">🚀 开始回放...</span>';
      // ✅ 清空 sessionStorage 中的残留数据
      clearReplayStorage();
      lastReplayStepCount = 0;
      break;
     
    case 'executing':
      if (cs && data.step) {
        cs.innerHTML = '<span style="color:#60a5fa;">▶️ 步骤 ' + data.step + '/' + data.total + '</span>';
        lastReplayStepCount = data.step;
      }
      break;

    case 'completed':
      if (navigatingTimeout) clearTimeout(navigatingTimeout);
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
      if (cs) cs.innerHTML = '<span style="color:#f59e0b;">🔄 正在跳转页面...</span>';
      addReplayLog('🔄 页面跳转中...', 'navigate');
      // ✅ 设置5秒超时，如果还没收到完成状态，检查是否真的完成了
      navigatingTimeout = setTimeout(function() {
        console.log('导航超时，检查回放是否完成');
        checkReplayCompletion();
      }, 5000);
      break;
      
    case 'stopped':
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

  // ✅ 清空日志按钮
  var clearLogBtn = document.getElementById('clearLogBtn');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', function() {
      clearReplayLog();
      addReplayLog('日志已清空', 'info');
    });
  }
  
  if (importBtn) importBtn.addEventListener('click', importFile);
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
