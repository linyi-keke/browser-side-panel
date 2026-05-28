// sidebar-data.js - import, export, clearing, and step normalization
// Extracted from sidebar.js to keep the side panel logic easier to navigate.

function openExportDialog() {
  var exportSourceSteps = getExportSourceSteps();
  if (exportSourceSteps.length === 0) { showToast('没有可导出的数据'); return; }

  var now = new Date();
  var dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0');

  fileNameInput.value = '录制_' + dateStr;
  fileDescriptionInput.value = '';

  var namedSteps = exportSourceSteps.filter(function(a) { return a.stepName; }).length;
  exportSummary.innerHTML = '📊 共 <span>' + exportSourceSteps.length + '</span> 个步骤' + (namedSteps > 0 ? ' | 🏷️ 已命名 <span>' + namedSteps + '</span> 个步骤' : '');

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
  var exportSourceSteps = getExportSourceSteps();
  var reversedHistory = replaySteps && replaySteps.length ? normalizeReplaySteps(exportSourceSteps) : normalizeReplaySteps([].concat(exportSourceSteps).reverse());

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
      delete obj.assertionResults;
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
  if (isReplaying || isReplayPaused) {
    await stopReplayInPage();
  }
  await chrome.runtime.sendMessage({ type: 'clearHistory' });
  actionHistory = [];
  replaySteps = [];
  stepCounter = 0;
  stepResults = {};
  currentReplaySessionId = null;
  continuationSteps = [];
  continuationSessionId = null;
  isReplaying = false;
  isReplayPaused = false;
  replayIsNavigating = false;
  clearReplayStorage();
  var replayPanel = document.getElementById('replayPanel');
  if (replayPanel) replayPanel.classList.add('hidden');
  updateStepCount();
  renderActionList(actionHistory);
  showToast('???');
}

function normalizeReplaySteps(steps) {
  steps = (steps || []).filter(function(s) { return s && s.type; }).map(function(step) {
    return Object.assign({}, step, { target: Object.assign({}, step.target || {}) });
  });
  steps.sort(function(a, b) { return getStepSortValue(a, 0) - getStepSortValue(b, 0); });
  steps = mergeDuplicateNavigationSteps(steps);
  steps = mergeDuplicateConsecutiveActionSteps(steps);
  steps = removeSyntheticChoiceFocusSteps(steps);
  steps.forEach(function(step, i) {
    step.stepNumber = i + 1;
    step.assertionResults = [];
    if (!step.target) step.target = {};
    if (!step.target.textContent && step.target.textContent === undefined) step.target.textContent = '';
    if (!step.target.className) step.target.className = '';
    if (!step.target.id) step.target.id = '';
    if (!step.target.tagName) step.target.tagName = '';
  });
  return steps;
}

function getStepSortValue(step, fallbackIndex) {
  if (step && step.timeOffset != null && !isNaN(Number(step.timeOffset))) return Number(step.timeOffset);
  if (step && step.timestamp) {
    var ts = new Date(step.timestamp).getTime();
    if (!isNaN(ts)) return ts;
  }
  if (step && step.stepNumber != null && !isNaN(Number(step.stepNumber))) return Number(step.stepNumber);
  return fallbackIndex || 0;
}

function normalizeUrlForCompare(url) {
  if (!url) return '';
  try {
    var parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch (e) {
    return String(url || '').split('#')[0];
  }
}

function mergeAssertions(targetStep, sourceStep) {
  var existing = Array.isArray(targetStep.assertions) ? targetStep.assertions : [];
  var incoming = Array.isArray(sourceStep.assertions) ? sourceStep.assertions : [];
  if (incoming.length === 0) return;
  var seen = {};
  existing.forEach(function(item) {
    if (item && item.id) seen[item.id] = true;
  });
  incoming.forEach(function(item) {
    if (!item) return;
    if (item.id && seen[item.id]) return;
    existing.push(Object.assign({}, item));
    if (item.id) seen[item.id] = true;
  });
  targetStep.assertions = existing;
}

function mergeDuplicateNavigationSteps(steps) {
  var result = [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var previous = result[result.length - 1];
    var sameNavigation = previous && previous.type === 'navigation' && step.type === 'navigation' &&
      normalizeUrlForCompare(previous.url || previous.pageUrl) === normalizeUrlForCompare(step.url || step.pageUrl);
    var closeInTime = Math.abs(getStepSortValue(step, i) - getStepSortValue(previous, i - 1)) <= 1500;
    if (sameNavigation && closeInTime) {
      mergeAssertions(previous, step);
      continue;
    }
    result.push(step);
  }
  return result;
}

function isSyntheticChoiceFocus(previous, step, index) {
  if (!previous || !step || step.type !== 'focus') return false;
  var target = step.target || {};
  if ((target.tagName || '').toUpperCase() !== 'INPUT') return false;
  var inputType = String(target.type || '').toLowerCase();
  if (inputType !== 'radio' && inputType !== 'checkbox') return false;
  if (previous.type !== 'click') return false;
  if ((previous.pageUrl || '') !== (step.pageUrl || '')) return false;
  if (Math.abs(getStepSortValue(step, index) - getStepSortValue(previous, index - 1)) > 500) return false;
  if (previous.x != null && step.x != null && Math.abs(Number(previous.x) - Number(step.x)) > 3) return false;
  if (previous.y != null && step.y != null && Math.abs(Number(previous.y) - Number(step.y)) > 3) return false;
  return true;
}

function removeSyntheticChoiceFocusSteps(steps) {
  var result = [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var previous = result[result.length - 1];
    if (isSyntheticChoiceFocus(previous, step, i)) {
      mergeAssertions(previous, step);
      continue;
    }
    result.push(step);
  }
  return result;
}

function getActionStepKey(step) {
  var target = step && step.target ? step.target : {};
  return [
    step ? step.type : '',
    step ? step.tabId : '',
    step ? step.pageUrl || step.url || '' : '',
    target.selector || '',
    target.id || '',
    target.className || '',
    target.textContent || '',
    step && step.x != null ? Math.round(Number(step.x)) : '',
    step && step.y != null ? Math.round(Number(step.y)) : '',
    step && step.value != null ? String(step.value) : '',
    step && step.key != null ? String(step.key) : ''
  ].join('|');
}

function mergeDuplicateConsecutiveActionSteps(steps) {
  var result = [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var previous = result[result.length - 1];
    var closeInTime = previous && Math.abs(getStepSortValue(step, i) - getStepSortValue(previous, i - 1)) <= 250;
    if (previous && previous.type === step.type && closeInTime && getActionStepKey(previous) === getActionStepKey(step)) {
      mergeAssertions(previous, step);
      continue;
    }
    result.push(step);
  }
  return result;
}

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
    steps = normalizeReplaySteps(steps);
    /*
    steps = steps.filter(function(s) { return s && s.type; });
    steps.sort(function(a, b) {
      var numA = a.stepNumber || 999;
      var numB = b.stepNumber || 999;
      return numA - numB;  // 升序：小的在前面
    });
    */

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
    currentReplaySessionId = null;
    continuationSteps = cloneStepsForRecording(steps);
    continuationSessionId = null;
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
