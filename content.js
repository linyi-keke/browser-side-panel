// content.js - 负责在页面中监听用户操作、收集窗口信息、发送消息给 background.js，并处理回放脚本的注入和通信
(function() {
  'use strict';

  var windowInfo = {
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    devicePixelRatio: window.devicePixelRatio
  };

  var isRecording = false;
  var scrollTimer = null;
  var lastResizeTime = 0;
  var lastScrollAction = null;
  var inputValueTracker = new Map();
  var assertionSelectActive = false;
  var assertionSelectState = null;
  var assertionSuppressEventsUntil = 0;
  var hoverCaptureActive = false;
  var hoverCaptureState = null;
  var userScrollUntil = 0;
  console.log('Content Script initialized');
  // update window info
  function updateAndNotifyWindowInfo() {
    windowInfo = {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      devicePixelRatio: window.devicePixelRatio
    };

    chrome.runtime.sendMessage({
      type: 'updateWindowInfo',
      data: windowInfo
    }).catch(function() {});

    return windowInfo;
  }
  // send action
  function sendAction(actionData) {
    if (!isRecording) return;

    chrome.runtime.sendMessage({
      type: 'recordAction',
      data: actionData
    }).catch(function() {});
  }
  // get element selector
  function getElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return '';

    if (el.id) return '#' + CSS.escape(el.id);

    if (el.name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';

    var selector = el.tagName.toLowerCase();

    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\s+/).filter(function(c) { return c && c.indexOf(':') === -1; });
      if (classes.length > 0) selector += '.' + classes.slice(0, 2).map(function(c) { return CSS.escape(c); }).join('.');
    }

    if (el.parentElement) {
      var siblings = Array.from(el.parentElement.children).filter(function(child) { return child.tagName === el.tagName; });
      if (siblings.length > 1) {
        var index = siblings.indexOf(el) + 1;
        selector += ':nth-of-type(' + index + ')';
      }
    }

    return selector;
  }
  // send scroll position
  function sendScrollPosition() {
    if (!isRecording) return;
    if (assertionSelectActive || Date.now() < assertionSuppressEventsUntil) return;

    windowInfo = Object.assign({}, windowInfo, {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight
    });

    var actionData = {
      type: 'scroll',
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: windowInfo.viewportWidth,
      viewportHeight: windowInfo.viewportHeight,
      windowWidth: windowInfo.windowWidth,
      windowHeight: windowInfo.windowHeight,
      timestamp: new Date().toISOString()
    };

    if (lastScrollAction && lastScrollAction.scrollX === actionData.scrollX && lastScrollAction.scrollY === actionData.scrollY) return;

    lastScrollAction = actionData;
    sendAction(actionData);
  }

  function markUserScrollIntent() {
    userScrollUntil = Date.now() + 1200;
  }

  // 获取元素文本
  function normalizeElementText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getAccessibleText(el) {
    if (!el) return '';

    var tagName = (el.tagName || '').toUpperCase();

    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      return normalizeElementText(el.value || el.placeholder || el.getAttribute('aria-label') || '');
    }

    if (tagName === 'IMG') {
      return normalizeElementText(el.alt || el.title || el.getAttribute('aria-label') || '');
    }

    return normalizeElementText(
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.innerText ||
      el.textContent ||
      el.value ||
      ''
    );
  }

  function getElementText(el) {
    return getAccessibleText(el).substring(0, 100);
  }

  function isSemanticClickTarget(el) {
    if (!el || !el.tagName || el === document.body || el === document.documentElement) return false;

    var tagName = (el.tagName || '').toUpperCase();
    var role = String(el.getAttribute('role') || '').toLowerCase();

    if (tagName === 'A' || tagName === 'BUTTON' || tagName === 'SUMMARY' || tagName === 'LABEL') return true;
    if (['button', 'link', 'tab', 'menuitem', 'option'].indexOf(role) !== -1) return true;
    if (el.hasAttribute('href') || el.hasAttribute('onclick')) return true;
    if (/^(YT-|YTD-|TP-YT-)/.test(tagName) && getAccessibleText(el)) return true;

    return false;
  }

  function getActionTarget(event) {
    var target = event && event.target;
    if (!target || !target.tagName) return target;
    if (isEditableElement(target)) return target;

    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    var fallback = getAccessibleText(target) ? target : null;

    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || !el.tagName || el === document.body || el === document.documentElement) continue;
      if (!fallback && getAccessibleText(el)) fallback = el;
      if (isSemanticClickTarget(el) && getAccessibleText(el)) return el;
    }

    var closest = target.closest && target.closest('button, a, summary, label, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], yt-chip-cloud-chip-renderer, ytd-guide-entry-renderer');
    if (closest && getAccessibleText(closest)) return closest;

    return fallback || target;
  }

  function normalizeRegionText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getTextFromRegion(region) {
    var left = region.left;
    var top = region.top;
    var right = left + region.width;
    var bottom = top + region.height;
    var chunks = [];
    var seen = new Set();
    if (!document.body) return '';

    function rectIntersects(rect) {
      var pageLeft = rect.left + window.scrollX;
      var pageTop = rect.top + window.scrollY;
      var pageRight = pageLeft + rect.width;
      var pageBottom = pageTop + rect.height;
      return !(pageRight < left || pageLeft > right || pageBottom < top || pageTop > bottom);
    }

    function addText(text) {
      text = normalizeRegionText(text);
      if (!text || seen.has(text)) return;
      seen.add(text);
      chunks.push(text);
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!normalizeRegionText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var style = window.getComputedStyle(parent);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walker.nextNode()) {
      var range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        if (rectIntersects(rects[i])) {
          addText(walker.currentNode.nodeValue);
          break;
        }
      }
      range.detach();
    }

    var fields = document.body.querySelectorAll('input, textarea, select');
    Array.prototype.forEach.call(fields, function(el) {
      if (!el || (assertionSelectState && (el === assertionSelectState.overlay || el === assertionSelectState.box || el === assertionSelectState.hint))) return;
      var style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return;
      var rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0 || !rectIntersects(rect)) return;
      addText(el.value || el.placeholder || '');
    });

    return normalizeRegionText(chunks.join(' '));
  }

  function getPrimaryElementInRegion(region) {
    var x = Math.max(0, Math.min(window.innerWidth - 1, region.left - window.scrollX + region.width / 2));
    var y = Math.max(0, Math.min(window.innerHeight - 1, region.top - window.scrollY + region.height / 2));
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (assertionSelectState && (el === assertionSelectState.overlay || el === assertionSelectState.box || el === assertionSelectState.hint)) {
      var oldDisplay = assertionSelectState.overlay.style.display;
      assertionSelectState.overlay.style.display = 'none';
      el = document.elementFromPoint(x, y);
      assertionSelectState.overlay.style.display = oldDisplay;
    }
    return el;
  }

  function finishAssertionRegionSelect(region) {
    var primary = getPrimaryElementInRegion(region);
    var result = {
      region: region,
      text: getTextFromRegion(region),
      selector: getElementSelector(primary),
      target: primary ? {
        tagName: primary.tagName || '',
        id: primary.id || '',
        className: (primary.className && typeof primary.className === 'string') ? primary.className : '',
        textContent: getElementText(primary),
        selector: getElementSelector(primary)
      } : null,
      pageUrl: window.location.href,
      pageTitle: document.title
    };
    cleanupAssertionRegionSelect();
    return result;
  }

  function cleanupAssertionRegionSelect() {
    if (!assertionSelectState) {
      assertionSelectActive = false;
      return;
    }
    document.removeEventListener('mousedown', assertionSelectState.onMouseDown, true);
    document.removeEventListener('mousemove', assertionSelectState.onMouseMove, true);
    document.removeEventListener('mouseup', assertionSelectState.onMouseUp, true);
    document.removeEventListener('keydown', assertionSelectState.onKeyDown, true);
    if (assertionSelectState.overlay) assertionSelectState.overlay.remove();
    assertionSelectState = null;
    assertionSelectActive = false;
    assertionSuppressEventsUntil = Date.now() + 500;
  }

  function startAssertionRegionSelect(options, done) {
    cleanupAssertionRegionSelect();
    assertionSelectActive = true;

    var overlay = document.createElement('div');
    overlay.id = '__assertion_region_overlay__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,0.08);';

    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;display:none;border:2px solid #f59e0b;background:rgba(245,158,11,0.16);box-shadow:0 0 0 9999px rgba(15,23,42,0.18);pointer-events:none;';

    var hint = document.createElement('div');
    hint.textContent = '\u62d6\u62fd\u9009\u62e9\u65ad\u8a00\u533a\u57df\uff0c\u6309 Esc \u53d6\u6d88';
    hint.style.cssText = 'position:fixed;left:16px;top:16px;padding:8px 10px;border-radius:6px;background:#111827;color:#f8fafc;font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(15,23,42,0.28);pointer-events:none;';

    overlay.appendChild(box);
    overlay.appendChild(hint);
    document.documentElement.appendChild(overlay);

    assertionSelectState = {
      overlay: overlay,
      box: box,
      hint: hint,
      startX: 0,
      startY: 0,
      dragging: false,
      done: done,
      onMouseDown: function(e) {
        e.preventDefault();
        e.stopPropagation();
        assertionSelectState.dragging = true;
        assertionSelectState.startX = e.clientX;
        assertionSelectState.startY = e.clientY;
        box.style.display = 'block';
        box.style.left = e.clientX + 'px';
        box.style.top = e.clientY + 'px';
        box.style.width = '0px';
        box.style.height = '0px';
      },
      onMouseMove: function(e) {
        if (!assertionSelectState || !assertionSelectState.dragging) return;
        e.preventDefault();
        e.stopPropagation();
        var left = Math.min(assertionSelectState.startX, e.clientX);
        var top = Math.min(assertionSelectState.startY, e.clientY);
        var width = Math.abs(e.clientX - assertionSelectState.startX);
        var height = Math.abs(e.clientY - assertionSelectState.startY);
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
      },
      onMouseUp: function(e) {
        if (!assertionSelectState || !assertionSelectState.dragging) return;
        e.preventDefault();
        e.stopPropagation();
        var left = Math.min(assertionSelectState.startX, e.clientX);
        var top = Math.min(assertionSelectState.startY, e.clientY);
        var width = Math.abs(e.clientX - assertionSelectState.startX);
        var height = Math.abs(e.clientY - assertionSelectState.startY);
        if (width < 8 || height < 8) {
          cleanupAssertionRegionSelect();
          done({ success: false, error: 'Selection is too small' });
          return;
        }
        var region = {
          left: left + window.scrollX,
          top: top + window.scrollY,
          width: width,
          height: height,
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        };
        done({ success: true, data: finishAssertionRegionSelect(region) });
      },
      onKeyDown: function(e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        cleanupAssertionRegionSelect();
        done({ success: false, error: 'Selection canceled' });
      }
    };

    document.addEventListener('mousedown', assertionSelectState.onMouseDown, true);
    document.addEventListener('mousemove', assertionSelectState.onMouseMove, true);
    document.addEventListener('mouseup', assertionSelectState.onMouseUp, true);
    document.addEventListener('keydown', assertionSelectState.onKeyDown, true);
  }

  // 是否可编辑
  function isEditableElement(el) {
    if (!el) return false;
    var tagName = (el.tagName || '').toUpperCase();
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || el.isContentEditable;
  }

  // 构建操作数据
  function buildActionData(type, event) {
    var originalTarget = event.target;
    var target = getActionTarget(event) || originalTarget;
    var rect = target.getBoundingClientRect ? target.getBoundingClientRect() : null;

    return {
      type: type,
      x: event.clientX,
      y: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
      viewportWidth: windowInfo.viewportWidth,
      viewportHeight: windowInfo.viewportHeight,
      windowWidth: windowInfo.windowWidth,
      windowHeight: windowInfo.windowHeight,
      timestamp: new Date().toISOString(),
      target: {
        tagName: target.tagName,
        id: target.id || '',
        className: (target.className && typeof target.className === 'string') ? target.className : '',
        textContent: getElementText(target),
        type: target.type || '',
        name: target.name || '',
        placeholder: target.placeholder || '',
        selector: getElementSelector(target),
        rect: rect ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        } : null,
        clickOffsetX: rect ? event.clientX - rect.left : null,
        clickOffsetY: rect ? event.clientY - rect.top : null
      }
    };
  }

  // 记录导航步骤
  function cleanupHoverCapture() {
    if (!hoverCaptureState) {
      hoverCaptureActive = false;
      return;
    }
    document.removeEventListener('mousemove', hoverCaptureState.onMouseMove, true);
    document.removeEventListener('keydown', hoverCaptureState.onKeyDown, true);
    if (hoverCaptureState.timer) clearTimeout(hoverCaptureState.timer);
    if (hoverCaptureState.indicator && hoverCaptureState.indicator.parentNode) {
      hoverCaptureState.indicator.parentNode.removeChild(hoverCaptureState.indicator);
    }
    hoverCaptureState = null;
    hoverCaptureActive = false;
    assertionSuppressEventsUntil = Date.now() + 300;
  }

  function startHoverCapture(options, done) {
    if (hoverCaptureActive) {
      done({ success: false, error: 'Hover capture already active' });
      return;
    }

    var settleMs = Number(options && options.settleMs) || 3000;
    hoverCaptureActive = true;
    var completed = false;
    var lastEvent = null;

    var indicator = document.createElement('div');
    indicator.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:rgba(15,23,42,.92);color:#e2e8f0;border:1px solid rgba(148,163,184,.35);border-radius:8px;padding:8px 10px;font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 24px rgba(15,23,42,.35);pointer-events:none;';
    indicator.textContent = '移动到目标位置，停留 3 秒记录悬浮；Esc 取消';
    document.documentElement.appendChild(indicator);

    function finish(result) {
      if (completed) return;
      completed = true;
      cleanupHoverCapture();
      try { done(result); } catch (e) {}
    }

    function schedule(event) {
      lastEvent = {
        target: event.target,
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY
      };
      if (hoverCaptureState.timer) clearTimeout(hoverCaptureState.timer);
      indicator.textContent = '保持不动 3 秒以记录悬浮位置';
      hoverCaptureState.timer = setTimeout(function() {
        if (!lastEvent) return;
        var pointTarget = document.elementFromPoint(lastEvent.clientX, lastEvent.clientY) || lastEvent.target;
        var actionData = buildActionData('hover', {
          target: pointTarget,
          clientX: lastEvent.clientX,
          clientY: lastEvent.clientY,
          pageX: lastEvent.pageX,
          pageY: lastEvent.pageY,
          composedPath: function() { return [pointTarget]; }
        });
        actionData.hoverMs = settleMs;
        finish({ success: true, data: actionData });
      }, settleMs);
    }

    hoverCaptureState = {
      timer: null,
      indicator: indicator,
      onMouseMove: function(e) {
        if (!hoverCaptureActive) return;
        schedule(e);
      },
      onKeyDown: function(e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        finish({ success: false, error: 'Hover capture canceled' });
      }
    };

    document.addEventListener('mousemove', hoverCaptureState.onMouseMove, true);
    document.addEventListener('keydown', hoverCaptureState.onKeyDown, true);
  }

  function recordNavigationStep() {
    var actionData = {
      type: 'navigation',
      url: window.location.href,
      title: document.title,
      viewportWidth: windowInfo.viewportWidth,
      viewportHeight: windowInfo.viewportHeight,
      windowWidth: windowInfo.windowWidth,
      windowHeight: windowInfo.windowHeight,
      timestamp: new Date().toISOString(),
      target: {
        tagName: 'PAGE',
        id: '',
        className: '',
        textContent: document.title
      }
    };

    sendAction(actionData);
      console.log('page navigation:', window.location.href);
  }

  // 监听点击
  document.addEventListener('click', function(e) {
    if (assertionSelectActive || hoverCaptureActive || Date.now() < assertionSuppressEventsUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!isRecording) return;

    var target = e.target;
    var tagName = (target.tagName || '').toUpperCase();

    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      sendAction(buildActionData('focus', e));
      return;
    }

    sendAction(buildActionData('click', e));
  }, true);

  // 监听右键
  document.addEventListener('contextmenu', function(e) {
    if (assertionSelectActive || hoverCaptureActive || Date.now() < assertionSuppressEventsUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!isRecording) return;
    sendAction(buildActionData('rightClick', e));
  });

  // 监听双击
  document.addEventListener('dblclick', function(e) {
    if (assertionSelectActive || hoverCaptureActive || Date.now() < assertionSuppressEventsUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!isRecording) return;
    sendAction(buildActionData('dblclick', e));
  });

  // Track final values for input aggregation.
  var pendingInputValues = new Map();
  var pendingInputTimers = new Map();

  // 监听输入
  document.addEventListener('input', function(e) {
  if (!isRecording) return;

  var target = e.target;
  if (!isEditableElement(target)) return;

  // 生成输入框的唯一标识
  var inputKey = getElementSelector(target) || target.name || target.id || 'unknown';

  // Get current value.
  var currentValue = target.value || target.textContent || '';

  // Store final value.
  pendingInputValues.set(inputKey, currentValue);

  // 清除之前的定时器
  if (pendingInputTimers.has(inputKey)) {
    clearTimeout(pendingInputTimers.get(inputKey));
  }
  // save final value after input settles
  var timer = setTimeout(function() {
    var finalValue = pendingInputValues.get(inputKey);
    if (finalValue !== undefined) {
      var previousValue = ''; // 可以从之前的记录获取，这里简�?
      var actionData = {
        type: 'input',
        value: finalValue,
        previousValue: previousValue,
        viewportWidth: windowInfo.viewportWidth,
        viewportHeight: windowInfo.viewportHeight,
        windowWidth: windowInfo.windowWidth,
        windowHeight: windowInfo.windowHeight,
        timestamp: new Date().toISOString(),
        target: {
          tagName: target.tagName,
          id: target.id || '',
          className: (target.className && typeof target.className === 'string') ? target.className : '',
          type: target.type || '',
          name: target.name || '',
          placeholder: target.placeholder || '',
          selector: getElementSelector(target)
        }
      };

      sendAction(actionData);

      // 清理
      pendingInputValues.delete(inputKey);
      pendingInputTimers.delete(inputKey);
    }
  }, 500); // 500ms 无输入后保存

  pendingInputTimers.set(inputKey, timer);
}, true);

  // 监听键盘
  document.addEventListener('keydown', function(e) {
    if (!isRecording) return;

    var target = e.target;
    var specialKeys = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (specialKeys.indexOf(e.key) === -1) return;

    if (isEditableElement(target)) {
      var actionData = {
        type: 'keydown',
        key: e.key,
        code: e.code,
        value: (target.value !== undefined) ? target.value : (target.textContent || ''),
        viewportWidth: windowInfo.viewportWidth,
        viewportHeight: windowInfo.viewportHeight,
        windowWidth: windowInfo.windowWidth,
        windowHeight: windowInfo.windowHeight,
        timestamp: new Date().toISOString(),
        target: {
          tagName: target.tagName,
          id: target.id || '',
          className: (target.className && typeof target.className === 'string') ? target.className : '',
          type: target.type || '',
          name: target.name || '',
          placeholder: target.placeholder || '',
          selector: getElementSelector(target)
        }
      };

      sendAction(actionData);
    }
  }, true);

  // 监听submit
  document.addEventListener('submit', function(e) {
    if (!isRecording) return;

    var target = e.target;
    var actionData = {
      type: 'submit',
      viewportWidth: windowInfo.viewportWidth,
      viewportHeight: windowInfo.viewportHeight,
      windowWidth: windowInfo.windowWidth,
      windowHeight: windowInfo.windowHeight,
      timestamp: new Date().toISOString(),
      target: {
        tagName: target.tagName,
        id: target.id || '',
        className: (target.className && typeof target.className === 'string') ? target.className : '',
        selector: getElementSelector(target)
      }
    };

    sendAction(actionData);
  }, true);

  // 监听滚动
  window.addEventListener('wheel', markUserScrollIntent, { passive: true, capture: true });
  window.addEventListener('touchmove', markUserScrollIntent, { passive: true, capture: true });
  document.addEventListener('keydown', function(e) {
    var scrollKeys = ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', 'Space'];
    if (scrollKeys.indexOf(e.code || e.key) !== -1 || scrollKeys.indexOf(e.key) !== -1) markUserScrollIntent();
  }, true);

  window.addEventListener('scroll', function() {
    if (!isRecording) return;
    if (assertionSelectActive || Date.now() < assertionSuppressEventsUntil) return;
    if (Date.now() > userScrollUntil) return;

    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      sendScrollPosition();
      scrollTimer = null;
    }, 300);
  }, { passive: true });

  // 监听窗口大小变化
  window.addEventListener('resize', function() {
    var now = Date.now();
    if (now - lastResizeTime > 500) {
      lastResizeTime = now;
      var updatedInfo = updateAndNotifyWindowInfo();

      if (isRecording) {
        sendAction(Object.assign({}, updatedInfo, {
          type: 'resize',
          timestamp: new Date().toISOString()
        }));
      }
    }
  });
  // before unload
  window.addEventListener('beforeunload', function() {
  // flush pending input values
  pendingInputValues.forEach(function(finalValue, key) {
    if (finalValue !== undefined) {
      var history = { lastValue: finalValue };
      var actionData = {
        type: 'input',
        value: finalValue,
        previousValue: '',
        viewportWidth: windowInfo.viewportWidth,
        viewportHeight: windowInfo.viewportHeight,
        windowWidth: windowInfo.windowWidth,
        windowHeight: windowInfo.windowHeight,
        timestamp: new Date().toISOString(),
        target: {
          tagName: 'INPUT',
          selector: key
        }
      };
      sendAction(actionData);
    }
  });

  if (isRecording && scrollTimer && Date.now() <= userScrollUntil) {
    clearTimeout(scrollTimer);
    sendScrollPosition();
  }

  // 清理所有定时器
  pendingInputTimers.forEach(function(timer) {
    clearTimeout(timer);
  });
  pendingInputValues.clear();
  pendingInputTimers.clear();
  inputValueTracker.clear();
});

  // 响应消息
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'getCurrentInfo') {
      updateAndNotifyWindowInfo();
      sendResponse({ windowInfo: windowInfo, isRecording: isRecording });
      return false;
    }

    if (request.action === 'updateRecordingStatus') {
      var wasRecording = isRecording;
      isRecording = request.isRecording;

      if (!wasRecording && isRecording && !request.suppressInitialNavigation) recordNavigationStep();
      if (!isRecording) inputValueTracker.clear();
      console.log('recording status:', isRecording ? 'recording' : 'stopped');
      sendResponse({ success: true });
      return false;
    }

    if (request.action === 'startAssertionRegionSelect') {
      startAssertionRegionSelect(request.options || {}, function(result) {
        try {
          sendResponse(result);
        } catch (e) {}
      });
      return true;
    }

    if (request.action === 'startHoverCapture') {
      startHoverCapture(request.options || {}, function(result) {
        try {
          sendResponse(result);
        } catch (e) {}
      });
      return true;
    }

    if (request.action === 'startReplayScript' || request.action === 'stopReplayScript' ||
        request.action === 'pauseReplayScript' || request.action === 'resumeReplayScript') {
      window.postMessage({
        type: request.action.replace('ReplayScript', '').toUpperCase() + '_REPLAY',
        steps: request.steps,
        speed: request.speed,
        highlight: request.highlight,
        fromIndex: request.fromIndex
      }, '*');
      sendResponse({ success: true });
      return false;
    }

    sendResponse({ success: false, error: 'Unknown action' });
    return false;
  });
  // forward replay status
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;

    if (event.data && (event.data.type === 'REPLAY_STEP_RESULT' || event.data.type === 'REPLAY_STATUS')) {
      chrome.runtime.sendMessage({
        type: event.data.type === 'REPLAY_STEP_RESULT' ? 'replayStepResult' : 'replayStatus',
        data: event.data
      }).catch(function() {});
    }
  });

// �?检查是否需要恢复录制状态（页面跳转后）
(function checkRecordingResume() {
  // read recording state from sessionStorage
  var savedState = sessionStorage.getItem('__recording_state__');
  if (savedState) {
    var state = JSON.parse(savedState);
      console.log('inject replay script failed:', e);
    // clear saved state
    sessionStorage.removeItem('__recording_state__');
    // resume after page load
    setTimeout(function() {
      isRecording = true;
      console.log('page navigation:', window.location.href);

      // 记录导航步骤（从旧页面跳转到新页面）
      var actionData = {
        type: 'navigation',
        url: window.location.href,
        title: document.title,
        viewportWidth: windowInfo.viewportWidth,
        viewportHeight: windowInfo.viewportHeight,
        windowWidth: windowInfo.windowWidth,
        windowHeight: windowInfo.windowHeight,
        timestamp: new Date().toISOString(),
        target: {
          tagName: 'PAGE',
          id: '',
          className: '',
          textContent: document.title
        }
      };

      sendAction(actionData);
      console.log('page navigation:', window.location.href);
    }, 1000);
  }
})();

// save recording state before navigation
window.addEventListener('beforeunload', function() {
  if (isRecording) {
    // 保存录制状态到 sessionStorage
    sessionStorage.setItem('__recording_state__', JSON.stringify({
      isRecording: true,
      timestamp: new Date().toISOString(),
      previousUrl: window.location.href
    }));
    console.log('recording state saved before navigation');
  }

  if (scrollTimer) {
    clearTimeout(scrollTimer);
    sendScrollPosition();
  }
  inputValueTracker.clear();
});
  // init
  updateAndNotifyWindowInfo();
  console.log('Content Script initialized');
})();

// 检查是否有待回放的回放步骤
(async function checkAndInjectReplay() {
  var response = await chrome.runtime.sendMessage({ type: 'getPendingReplay' }).catch(function() { return null; });
  var pendingData = response && response.data;
  if (pendingData) {
    console.log('检测到待回放步骤，请求 background 注入回放脚本');

    // 通过 background 注入，确�?chrome.runtime 可用
    chrome.runtime.sendMessage({
      type: 'injectReplayScript'
    }).catch(function(e) {
      console.log('inject replay script failed:', e);
    });

    // 添加重试机制：如�?秒后还没有回放脚本，再次请求
    setTimeout(function() {
      if (!window.__replayer && !window.__replay_injected) {
        console.log('retry inject replay script');
        chrome.runtime.sendMessage({
          type: 'injectReplayScript'
        }).catch(function(e) {});
      }
    }, 3000);
  }
})();
