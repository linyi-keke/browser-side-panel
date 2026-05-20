// sidebar-render.js - action card and list rendering
// Extracted from sidebar.js to keep the side panel logic easier to navigate.

function getAssertionSummary(action, isReplayMode) {
  var assertions = Array.isArray(action.assertions) ? action.assertions : [];
  if (assertions.length === 0) return '';

  var enabledAssertions = assertions.filter(function(item) { return item && item.enabled !== false; });
  var results = Array.isArray(action.assertionResults) ? action.assertionResults : [];
  var passed = results.filter(function(item) { return item && item.status === 'passed'; }).length;
  var failed = results.filter(function(item) { return item && item.status === 'failed'; }).length;
  var skipped = assertions.length - enabledAssertions.length + results.filter(function(item) { return item && item.status === 'skipped'; }).length;
  var summaryClass = 'pending';
  var summaryText = enabledAssertions.length + ' 个断言';

  if (isReplayMode && results.length) {
    if (failed > 0) {
      summaryClass = 'failed';
      summaryText = passed + '/' + enabledAssertions.length + ' 通过';
    } else if (passed >= enabledAssertions.length) {
      summaryClass = 'passed';
      summaryText = '全部通过';
    } else {
      summaryText = passed + '/' + enabledAssertions.length + ' 通过';
    }
  }
  if (skipped && enabledAssertions.length === 0) {
    summaryClass = 'skipped';
    summaryText = '已禁用';
  }

  var detailHTML = assertions.map(function(assertion, idx) {
    var result = results[idx] || {};
    var status = result.status || (assertion.enabled === false ? 'skipped' : 'pending');
    var label = assertionTypeMap[assertion.type] || assertion.type;
    var main = assertion.expected || assertion.selector || '';
    var actual = result.actual ? '<div class="assertion-actual">实际: ' + escapeHTML(result.actual) + '</div>' : '';
    var error = result.error ? '<div class="assertion-error">' + escapeHTML(result.error) + '</div>' : '';
    return '<div class="assertion-item ' + status + '">' +
      '<span class="assertion-dot"></span>' +
      '<div class="assertion-text"><strong>' + escapeHTML(label) + '</strong>' +
      (main ? '<span>' + escapeHTML(main) + '</span>' : '') +
      actual + error + '</div>' +
    '</div>';
  }).join('');

  return '<div class="assertion-summary ' + summaryClass + '">' +
    '<div class="assertion-summary-head"><span>断言</span><span>' + escapeHTML(summaryText) + '</span></div>' +
    '<div class="assertion-items">' + detailHTML + '</div>' +
  '</div>';
}

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
    hover: '🖱️',
    click: '🖱️', rightClick: '🖱️', dblclick: '🖱️',
    scroll: '📜', resize: '📏', focus: '🔍',
    input: '⌨️', keydown: '⌨️', submit: '📤', navigation: '🌐',
    wait: '⏱'
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
  if (['click', 'rightClick', 'dblclick', 'hover'].indexOf(action.type) !== -1 && target.textContent) {
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
  } else if (action.type === 'wait') {
    var waitMode = normalizeWaitMode(action.waitMode);
    if (waitMode === 'element') {
      coordinatesHTML = '<div class="card-body wait-display"><div class="card-info-item input-value-full"><div class="card-info-label">等待元素</div><div class="card-info-value coordinate" title="' + escapeHTML(action.waitSelector || '') + '">' + escapeHTML(action.waitSelector || '-') + '</div></div><div class="card-info-item input-value-full"><div class="card-info-label">最长等待</div><div class="card-info-value coordinate">' + getWaitTimeout(action) + 'ms</div></div></div>';
    } else {
      coordinatesHTML = '<div class="card-body wait-display"><div class="card-info-item input-value-full"><div class="card-info-label">等待时间</div><div class="card-info-value coordinate">' + getWaitDuration(action) + 'ms</div></div></div>';
    }
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
  var assertionHTML = getAssertionSummary(action, isReplayMode);
  var actionButtons = '';
  if (isReplayMode) {
    actionButtons = '<div class="card-actions always-visible">' +
      (action.type === 'wait' ? '<button class="btn-card-action btn-card-wait" data-index="' + index + '" title="编辑等待">⏱</button>' : '') +
      '<button class="btn-card-action btn-card-assert" data-index="' + index + '" title="编辑断言">断</button></div>';
  } else {
    actionButtons = '<div class="card-actions"><button class="btn-card-action btn-card-edit" data-index="' + index + '" title="修改信息">✏️</button><button class="btn-card-action btn-card-delete" data-index="' + index + '" title="删除步骤">🗑️</button></div>';
  }

  card.innerHTML = '<div class="card-header"><div class="action-type"><span class="step-number ' + (hasName ? 'has-name' : '') + '" data-index="' + index + '" title="' + (hasName ? escapeHTML(action.stepName) : '点击编辑名称') + '">#' + stepNum + '</span>' + statusIcon + '<span class="action-icon">' + icon + '</span><div class="action-type-info"><span class="action-type-text">' + typeText + '</span>' + actionDescription + stepNameTag + '</div></div><div class="card-header-right"><span class="action-time">' + time + '</span>' + actionButtons + '</div></div>' + coordinatesHTML + viewportHTML + pageUrlHTML + targetHTML;

  if (assertionHTML) card.insertAdjacentHTML('beforeend', assertionHTML);

  if (!isReplayMode) {
    var actionsWrap = card.querySelector('.card-actions');
    if (actionsWrap && !actionsWrap.querySelector('.btn-card-assert')) {
      var assertionButton = document.createElement('button');
      assertionButton.className = 'btn-card-action btn-card-assert';
      assertionButton.dataset.index = index;
      assertionButton.title = '编辑断言';
      assertionButton.textContent = '断';
      actionsWrap.insertBefore(assertionButton, actionsWrap.firstChild);
    }
  }

  var assertBtn = card.querySelector('.btn-card-assert');
  if (assertBtn) {
    assertBtn.addEventListener('click', (function(idx) {
      return function(e) { e.stopPropagation(); openAssertionDialog(idx, isReplayMode ? 'replay' : 'record'); };
    })(index));
  }

  var waitBtn = card.querySelector('.btn-card-wait');
  if (waitBtn) {
    waitBtn.addEventListener('click', (function(idx) {
      return function(e) { e.stopPropagation(); openWaitDialog(idx, isReplayMode ? 'replay' : 'record'); };
    })(index));
  }

  // 绑定事件
  if (!isReplayMode) {
    var editBtn = card.querySelector('.btn-card-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (function(idx) {
        return function(e) {
          e.stopPropagation();
          if (actionHistory[idx] && actionHistory[idx].type === 'wait') openWaitDialog(idx, 'record');
          else openEditStepDialog(idx);
        };
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

function shouldDisplayAction(action) {
  return action && action.type !== 'focus';
}

function renderActionList(actions, isReplayMode) {
  isReplayMode = isReplayMode || false;
  if (!actionList) return;

  actionList.innerHTML = '';

  if (!actions || actions.length === 0) {
    actionList.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>' + (isRecording ? '等待操作...' : isReplayMode ? '回放步骤' : '等待录制') + '</p><p class="empty-hint">' + (isRecording ? '在页面上进行操作' : isReplayMode ? '准备开始回放' : '点击 ⏺️ 录制 按钮开始') + '</p></div>';
    return;
  }

  var filtered = actions.filter(shouldDisplayAction);
  if (!isReplayMode && currentFilter !== 'all') {
    filtered = actions.filter(function(a) {
      if (!shouldDisplayAction(a)) return false;
      if (currentFilter === 'resize') return a.type === 'resize';
      if (currentFilter === 'scroll') return a.type === 'scroll';
      if (currentFilter === 'click') return ['click', 'rightClick', 'dblclick', 'hover'].indexOf(a.type) !== -1;
      return true;
    });
  }

  if (filtered.length === 0) { actionList.innerHTML = '<div class="empty-state"><p>没有匹配的操作</p></div>'; return; }

  filtered.forEach(function(action, i) { if (!action.stepNumber) action.stepNumber = filtered.length - i; });
  filtered.forEach(function(action, index) {
    var sourceIndex = isReplayMode ? index : actions.indexOf(action);
    actionList.appendChild(createActionCard(action, sourceIndex >= 0 ? sourceIndex : index, isReplayMode));
  });

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
  var sortedSteps = [].concat(replaySteps).filter(shouldDisplayAction).sort(function(a, b) {
    return (a.stepNumber || 0) - (b.stepNumber || 0);
  });

  if (sortedSteps.length === 0) {
    actionList.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>没有可展示的回放步骤</p></div>';
    return;
  }

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
