// sidebar-step-tools.js - assertion, wait, and editable-step helpers
// Extracted from sidebar.js to keep the side panel logic easier to navigate.

function ensureAssertionDialog() {
  var dialog = document.getElementById('assertionDialog');
  if (dialog) return dialog;

  dialog = document.createElement('div');
  dialog.id = 'assertionDialog';
  dialog.className = 'dialog-overlay hidden';
  dialog.innerHTML =
    '<div class="dialog assertion-dialog">' +
      '<div class="dialog-header">' +
        '<h3>步骤断言</h3>' +
        '<button id="closeAssertionDialogBtn" class="dialog-close">&times;</button>' +
      '</div>' +
      '<div class="dialog-body">' +
        '<div class="form-group"><label>步骤</label><span id="assertionStepNumber" class="step-number-display"></span></div>' +
        '<div id="assertionRows" class="assertion-edit-list"></div>' +
        '<button id="addAssertionBtn" class="btn btn-assertion-add" type="button">+ 添加断言</button>' +
      '</div>' +
      '<div class="dialog-footer">' +
        '<button id="cancelAssertionBtn" class="btn btn-cancel">取消</button>' +
        '<button id="confirmAssertionBtn" class="btn btn-confirm">保存</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(dialog);

  document.getElementById('closeAssertionDialogBtn').addEventListener('click', closeAssertionDialog);
  document.getElementById('cancelAssertionBtn').addEventListener('click', closeAssertionDialog);
  document.getElementById('confirmAssertionBtn').addEventListener('click', saveAssertions);
  document.getElementById('addAssertionBtn').addEventListener('click', function() { addAssertionRow(); });
  return dialog;
}

function createDefaultAssertion() {
  return {
    id: 'assert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    type: 'textVisible',
    selector: '',
    expected: '',
    enabled: true,
    timeout: 2000
  };
}

function getEditableSteps(source) {
  return source === 'replay' ? replaySteps : actionHistory;
}

function openAssertionDialog(index, source) {
  editingAssertionSource = source === 'replay' ? 'replay' : 'record';
  var steps = getEditableSteps(editingAssertionSource);
  var action = steps[index];
  if (!action) return;

  editingAssertionIndex = index;
  var dialog = ensureAssertionDialog();
  document.getElementById('assertionStepNumber').textContent = '#' + (action.stepNumber || (index + 1));

  var rows = document.getElementById('assertionRows');
  rows.innerHTML = '';
  var assertions = Array.isArray(action.assertions) ? action.assertions : [];
  if (assertions.length === 0) addAssertionRow(createDefaultAssertion());
  else assertions.forEach(function(assertion) { addAssertionRow(assertion); });

  dialog.classList.remove('hidden');
}

function closeAssertionDialog() {
  var dialog = document.getElementById('assertionDialog');
  if (dialog) dialog.classList.add('hidden');
  editingAssertionIndex = -1;
  editingAssertionSource = 'record';
}

function normalizeWaitMode(mode) {
  return mode === 'element' ? 'element' : 'time';
}

function getWaitDuration(step) {
  var value = step && step.waitMs != null ? step.waitMs : 1000;
  value = Number(value);
  if (isNaN(value) || value < 0) value = 1000;
  return Math.round(value);
}

function getWaitTimeout(step) {
  var value = step && step.waitTimeoutMs != null ? step.waitTimeoutMs : 10000;
  value = Number(value);
  if (isNaN(value) || value < 0) value = 10000;
  return Math.round(value);
}

function createWaitStep() {
  return {
    type: 'wait',
    stepName: '等待',
    waitMode: 'time',
    waitMs: 1000,
    waitSelector: '',
    waitTimeoutMs: 10000,
    timestamp: new Date().toISOString(),
    pageUrl: currentPageUrl || '',
    pageTitle: currentPageTitle || '',
    target: { tagName: 'PAGE' },
    assertions: []
  };
}

function ensureWaitDialog() {
  var dialog = document.getElementById('waitStepDialog');
  if (dialog) return dialog;

  dialog = document.createElement('div');
  dialog.id = 'waitStepDialog';
  dialog.className = 'dialog-overlay hidden';
  dialog.innerHTML =
    '<div class="dialog wait-dialog">' +
      '<div class="dialog-header">' +
        '<h3>等待设置</h3>' +
        '<button id="closeWaitDialogBtn" class="dialog-close">&times;</button>' +
      '</div>' +
      '<div class="dialog-body">' +
        '<div class="form-group">' +
          '<label for="waitStepName">步骤名称</label>' +
          '<input type="text" id="waitStepName" class="form-input" placeholder="等待">' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="waitMode">等待方式</label>' +
          '<select id="waitMode" class="form-input">' +
            '<option value="time">等待固定时间</option>' +
            '<option value="element">等待元素出现</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group" id="waitTimeGroup">' +
          '<label for="waitMs">等待时间 (ms)</label>' +
          '<input type="number" id="waitMs" class="form-input" min="0" step="100" value="1000">' +
        '</div>' +
        '<div class="form-group hidden" id="waitElementGroup">' +
          '<label for="waitSelector">CSS selector</label>' +
          '<input type="text" id="waitSelector" class="form-input" placeholder="#submit, .loaded, [data-ready=true]">' +
          '<span class="form-hint">找到该元素后继续执行下一步。</span>' +
        '</div>' +
        '<div class="form-group hidden" id="waitTimeoutGroup">' +
          '<label for="waitTimeoutMs">最长等待时间 (ms)</label>' +
          '<input type="number" id="waitTimeoutMs" class="form-input" min="0" step="500" value="10000">' +
        '</div>' +
      '</div>' +
      '<div class="dialog-footer">' +
        '<button id="cancelWaitBtn" class="btn btn-cancel">取消</button>' +
        '<button id="confirmWaitBtn" class="btn btn-confirm">保存</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(dialog);

  document.getElementById('closeWaitDialogBtn').addEventListener('click', closeWaitDialog);
  document.getElementById('cancelWaitBtn').addEventListener('click', closeWaitDialog);
  document.getElementById('confirmWaitBtn').addEventListener('click', saveWaitStep);
  document.getElementById('waitMode').addEventListener('change', updateWaitModeFields);
  dialog.addEventListener('click', function(e) { if (e.target === dialog) closeWaitDialog(); });
  return dialog;
}

function updateWaitModeFields() {
  var modeEl = document.getElementById('waitMode');
  var mode = normalizeWaitMode(modeEl ? modeEl.value : 'time');
  var isElement = mode === 'element';
  var waitTimeGroup = document.getElementById('waitTimeGroup');
  var waitElementGroup = document.getElementById('waitElementGroup');
  var waitTimeoutGroup = document.getElementById('waitTimeoutGroup');
  if (waitTimeGroup) waitTimeGroup.classList.toggle('hidden', isElement);
  if (waitElementGroup) waitElementGroup.classList.toggle('hidden', !isElement);
  if (waitTimeoutGroup) waitTimeoutGroup.classList.toggle('hidden', !isElement);
}

function openWaitDialog(index, source) {
  editingWaitSource = source === 'replay' ? 'replay' : 'record';
  editingWaitIndex = typeof index === 'number' ? index : -1;
  var steps = getEditableSteps(editingWaitSource);
  var step = editingWaitIndex >= 0 ? steps[editingWaitIndex] : createWaitStep();
  var dialog = ensureWaitDialog();

  document.getElementById('waitStepName').value = step.stepName || '';
  document.getElementById('waitMode').value = normalizeWaitMode(step.waitMode);
  document.getElementById('waitMs').value = String(getWaitDuration(step));
  document.getElementById('waitSelector').value = step.waitSelector || '';
  document.getElementById('waitTimeoutMs').value = String(getWaitTimeout(step));
  updateWaitModeFields();

  dialog.classList.remove('hidden');
  var focusEl = normalizeWaitMode(step.waitMode) === 'element' ? document.getElementById('waitSelector') : document.getElementById('waitMs');
  if (focusEl) focusEl.focus();
}

function closeWaitDialog() {
  var dialog = document.getElementById('waitStepDialog');
  if (dialog) dialog.classList.add('hidden');
  editingWaitIndex = -1;
  editingWaitSource = 'record';
}

function collectWaitStepFromDialog(existing) {
  var mode = normalizeWaitMode(document.getElementById('waitMode').value);
  var step = Object.assign({}, existing || createWaitStep(), {
    type: 'wait',
    stepName: document.getElementById('waitStepName').value.trim() || null,
    waitMode: mode,
    waitMs: Math.max(0, Number(document.getElementById('waitMs').value) || 0),
    waitSelector: document.getElementById('waitSelector').value.trim(),
    waitTimeoutMs: Math.max(0, Number(document.getElementById('waitTimeoutMs').value) || 0),
    target: Object.assign({ tagName: 'PAGE' }, existing && existing.target ? existing.target : {})
  });
  if (mode === 'time') step.waitSelector = '';
  return step;
}

async function persistEditableSteps(source) {
  if (source === 'replay') {
    replaySteps = normalizeReplaySteps(replaySteps);
    continuationSteps = cloneStepsForRecording(replaySteps);
    if (continuationSessionId) {
      chrome.runtime.sendMessage({ type: 'updateSessionSteps', sessionId: continuationSessionId, steps: cloneStepsForRecording(replaySteps) }).catch(function() {});
    }
    renderReplayList();
    return;
  }

  actionHistory.forEach(function(action, i) { action.stepNumber = actionHistory.length - i; });
  stepCounter = actionHistory.length;
  updateStepCount();
  renderActionList(actionHistory);
  chrome.runtime.sendMessage({ type: 'setActionHistory', steps: actionHistory }).catch(function() {});
}

async function startHoverStepCapture() {
  try {
    var tab = await getCurrentTab();
    if (!tab || !tab.id) {
      showToast('无法获取当前标签页');
      return;
    }
    if (isRestrictedTabUrl(tab.url)) {
      showToast('当前页面无法添加悬浮步骤');
      return;
    }

    showToast('移动到目标位置并停留 3 秒');
    var response = await chrome.tabs.sendMessage(tab.id, {
      action: 'startHoverCapture',
      options: { settleMs: 3000 }
    });

    if (!response || !response.success || !response.data) {
      if (response && response.error) showToast(response.error === 'Hover capture canceled' ? '已取消添加悬浮' : response.error);
      return;
    }

    var step = Object.assign({}, response.data, {
      stepName: response.data.stepName || '鼠标悬浮',
      pageUrl: currentPageUrl || tab.url || '',
      pageTitle: currentPageTitle || tab.title || ''
    });

    if (isRecording) {
      await chrome.runtime.sendMessage({ type: 'recordAction', data: step });
    } else if (replaySteps && replaySteps.length) {
      step.stepNumber = replaySteps.length + 1;
      replaySteps.push(step);
      persistEditableSteps('replay');
    } else {
      actionHistory.unshift(step);
      persistEditableSteps('record');
    }

    showToast('已添加鼠标悬浮步骤');
  } catch (error) {
    console.error('添加悬浮步骤失败:', error);
    showToast('添加悬浮步骤失败');
  }
}

function saveWaitStep() {
  var source = editingWaitSource;
  var steps = getEditableSteps(source);
  var existing = editingWaitIndex >= 0 ? steps[editingWaitIndex] : null;
  var mode = normalizeWaitMode(document.getElementById('waitMode').value);
  var selectorInput = document.getElementById('waitSelector');
  var timeoutInput = document.getElementById('waitTimeoutMs');

  selectorInput.classList.remove('form-input-error');
  timeoutInput.classList.remove('form-input-error');

  if (mode === 'element' && !selectorInput.value.trim()) {
    selectorInput.classList.add('form-input-error');
    showToast('请输入要等待的 CSS selector');
    return;
  }

  var step = collectWaitStepFromDialog(existing);
  if (editingWaitIndex >= 0) {
    steps[editingWaitIndex] = step;
  } else if (source === 'record') {
    actionHistory.unshift(step);
  } else {
    step.stepNumber = replaySteps.length + 1;
    replaySteps.push(step);
  }

  persistEditableSteps(source);
  closeWaitDialog();
  showToast('等待步骤已保存');
}

function getExportSourceSteps() {
  return replaySteps && replaySteps.length ? replaySteps : actionHistory;
}

function cloneStepsForRecording(steps) {
  return (steps || []).map(function(step, index) {
    var clone = Object.assign({}, step, {
      target: Object.assign({}, step.target || {}),
      assertions: Array.isArray(step.assertions) ? step.assertions.map(function(assertion) {
        return Object.assign({}, assertion);
      }) : []
    });
    clone.stepNumber = index + 1;
    delete clone.assertionResults;
    return clone;
  });
}

function getAssertionRegionLabel(region) {
  if (!region) return '';
  return 'Region ' + Math.round(region.width || 0) + 'x' + Math.round(region.height || 0) +
    ' @ ' + Math.round(region.left || 0) + ',' + Math.round(region.top || 0);
}

async function sendAssertionRegionSelectRequest() {
  var tab = await getCurrentTab();
  if (!tab || !tab.id) throw new Error('无法获取当前标签页');

  try {
    return await chrome.tabs.sendMessage(tab.id, {
      action: 'startAssertionRegionSelect',
      options: {}
    });
  } catch (firstError) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await new Promise(function(r) { setTimeout(r, 200); });
    return await chrome.tabs.sendMessage(tab.id, {
      action: 'startAssertionRegionSelect',
      options: {}
    });
  }
}

async function captureAssertionRegion(row) {
  if (!row) return;
  var typeEl = row.querySelector('.assertion-type');
  var expectedEl = row.querySelector('.assertion-expected');
  var selectorEl = row.querySelector('.assertion-selector');
  var regionInfo = row.querySelector('.assertion-region-info');

  showToast('请在页面中拖拽选择断言区域');
  try {
    var response = await sendAssertionRegionSelectRequest();
    if (!response || !response.success || !response.data) {
      showToast((response && response.error) || '区域选择已取消');
      return;
    }
    var data = response.data;
    row.dataset.region = JSON.stringify(data.region || {});
    if (typeEl && ['regionTextContains', 'regionTextNotContains'].indexOf(typeEl.value) === -1) {
      typeEl.value = 'regionTextContains';
    }
    if (expectedEl && !expectedEl.value.trim()) expectedEl.value = (data.text || '').substring(0, 300);
    if (selectorEl && !selectorEl.value.trim()) selectorEl.value = data.selector || '';
    if (regionInfo) {
      regionInfo.textContent = getAssertionRegionLabel(data.region) + (data.text ? ' | ' + data.text.substring(0, 80) : '');
      regionInfo.classList.remove('hidden');
    }
    showToast('区域断言已生成');
  } catch (error) {
    showToast('区域选择失败: ' + error.message);
  }
}

function addAssertionRow(assertion) {
  assertion = assertion || createDefaultAssertion();
  var rows = document.getElementById('assertionRows');
  if (!rows) return;

  var row = document.createElement('div');
  row.className = 'assertion-edit-row';
  row.dataset.id = assertion.id || createDefaultAssertion().id;
  row.innerHTML =
    '<div class="assertion-row-top">' +
      '<select class="form-input assertion-type">' +
        '<option value="textVisible">文本存在</option>' +
        '<option value="elementExists">元素存在</option>' +
        '<option value="elementNotExists">元素不存在</option>' +
        '<option value="urlContains">URL包含</option>' +
        '<option value="elementTextContains">元素文本包含</option>' +
        '<option value="elementTextEquals">元素文本等于</option>' +
        '<option value="regionTextContains">\u533a\u57df\u6587\u672c\u5305\u542b</option>' +
        '<option value="regionTextNotContains">\u533a\u57df\u6587\u672c\u4e0d\u5305\u542b</option>' +
      '</select>' +
      '<label class="assertion-enabled"><input type="checkbox" class="assertion-enabled-input"> 启用</label>' +
      '<button type="button" class="btn-card-action btn-assertion-remove" title="删除断言">×</button>' +
    '</div>' +
    '<input class="form-input assertion-selector" placeholder="CSS selector，可选" value="' + escapeHTML(assertion.selector || '') + '">' +
    '<input class="form-input assertion-expected" placeholder="期望文本 / URL 片段" value="' + escapeHTML(assertion.expected || assertion.target || '') + '">' +
    '<input class="form-input assertion-timeout" type="number" min="0" step="500" placeholder="超时(ms)" value="' + escapeHTML(String(assertion.timeout == null ? 2000 : assertion.timeout)) + '">';

  var timeoutInput = row.querySelector('.assertion-timeout');
  var regionRow = document.createElement('div');
  regionRow.className = 'assertion-region-row';
  regionRow.innerHTML =
    '<button type="button" class="btn btn-assertion-pick">\u6846\u9009\u9875\u9762\u533a\u57df</button>' +
    '<span class="assertion-region-info' + (assertion.region ? '' : ' hidden') + '">' + escapeHTML(getAssertionRegionLabel(assertion.region)) + '</span>';
  row.insertBefore(regionRow, timeoutInput);

  row.querySelector('.assertion-type').value = assertion.type || 'textVisible';
  if (assertion.region) row.dataset.region = JSON.stringify(assertion.region);
  row.querySelector('.assertion-enabled-input').checked = assertion.enabled !== false;
  row.querySelector('.btn-assertion-remove').addEventListener('click', function() { row.remove(); });
  row.querySelector('.btn-assertion-pick').addEventListener('click', function() { captureAssertionRegion(row); });
  rows.appendChild(row);
}

function collectAssertionRows() {
  var rows = document.querySelectorAll('#assertionRows .assertion-edit-row');
  var assertions = [];
  var errors = [];
  rows.forEach(function(row, rowIndex) {
    var type = row.querySelector('.assertion-type').value;
    var selector = row.querySelector('.assertion-selector').value.trim();
    var expected = row.querySelector('.assertion-expected').value.trim();
    var timeout = parseInt(row.querySelector('.assertion-timeout').value, 10);
    var enabled = row.querySelector('.assertion-enabled-input').checked;
    var region = null;
    if (row.dataset.region) {
      try {
        region = JSON.parse(row.dataset.region);
      } catch (e) {
        region = null;
      }
    }
    var needsExpected = ['textVisible', 'urlContains', 'elementTextContains', 'elementTextEquals', 'regionTextContains', 'regionTextNotContains'].indexOf(type) !== -1;
    var needsSelector = ['elementExists', 'elementNotExists', 'elementTextContains', 'elementTextEquals'].indexOf(type) !== -1;
    var needsRegion = ['regionTextContains', 'regionTextNotContains'].indexOf(type) !== -1;

    if (needsExpected && !expected) {
      errors.push('第 ' + (rowIndex + 1) + ' 条断言缺少期望内容');
      row.querySelector('.assertion-expected').classList.add('form-input-error');
      return;
    }
    row.querySelector('.assertion-expected').classList.remove('form-input-error');

    if (needsSelector && !selector) {
      errors.push('第 ' + (rowIndex + 1) + ' 条断言缺少 CSS selector');
      row.querySelector('.assertion-selector').classList.add('form-input-error');
      return;
    }
    row.querySelector('.assertion-selector').classList.remove('form-input-error');

    if (needsRegion && (!region || !region.width || !region.height)) {
      errors.push('第 ' + (rowIndex + 1) + ' 条区域断言缺少框选区域');
      return;
    }

    var assertionData = {
      id: row.dataset.id || createDefaultAssertion().id,
      type: type,
      selector: selector,
      expected: expected,
      enabled: enabled,
      timeout: isNaN(timeout) ? 2000 : Math.max(0, timeout)
    };
    if (region) assertionData.region = region;
    assertions.push(assertionData);
  });
  return { assertions: assertions, errors: errors };
}

function saveAssertions() {
  var steps = getEditableSteps(editingAssertionSource);
  if (editingAssertionIndex < 0 || editingAssertionIndex >= steps.length) return;

  var collected = collectAssertionRows();
  if (collected.errors.length) {
    showToast(collected.errors[0]);
    return;
  }
  var assertions = collected.assertions;
  steps[editingAssertionIndex].assertions = assertions;
  steps[editingAssertionIndex].assertionResults = [];

  if (editingAssertionSource === 'replay') {
    continuationSteps = cloneStepsForRecording(steps);
    continuationSessionId = currentReplaySessionId || continuationSessionId;
    if (currentReplaySessionId) {
      chrome.runtime.sendMessage({
        type: 'updateSessionSteps',
        sessionId: currentReplaySessionId,
        steps: cloneStepsForRecording(steps)
      }).catch(function() {});
    }
    renderReplayList();
  } else {
    chrome.runtime.sendMessage({ type: 'updateStepInfo', index: editingAssertionIndex, data: steps[editingAssertionIndex] }).catch(function() {});
    renderActionList(actionHistory);
  }
  closeAssertionDialog();
  showToast('断言已保存');
}
