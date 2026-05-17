(function() {
  'use strict';

  console.log('========== replay-inject.js 已加载 ==========');
  console.log('当前页面URL:', window.location.href);

  // 标记已注入
  window.__replay_injected = true;

  var __lastMessageTime = {};
  var PENDING_REPLAY_KEY = '__replay_pending_data__';

  function sendUniqueMessage(type, data, key) {
    var now = Date.now();
    var messageKey = key || (type + '_' + (data.step || data.index || ''));
    if (__lastMessageTime[messageKey] && now - __lastMessageTime[messageKey] < 300) return;
    __lastMessageTime[messageKey] = now;
    try {
      chrome.runtime.sendMessage({ type: type, data: data });
    } catch (e) {}
  }

  function sendReplayLog(message, level, step) {
    try {
      chrome.runtime.sendMessage({
        type: 'replayLog',
        data: {
          message: message,
          level: level || 'info',
          stepNumber: step ? step.stepNumber : undefined,
          stepType: step ? step.type : undefined,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      });
    } catch (e) {}
  }

  function savePendingReplay(data) {
    return chrome.storage.local.set({ [PENDING_REPLAY_KEY]: data || null });
  }

  async function getPendingReplay() {
    var data = await chrome.storage.local.get([PENDING_REPLAY_KEY]);
    return data[PENDING_REPLAY_KEY] || null;
  }

  function clearPendingReplay() {
    return chrome.storage.local.remove([PENDING_REPLAY_KEY]);
  }

  function describeTarget(step) {
    if (!step || !step.target) return '无目标信息';
    var target = step.target;
    var parts = [];
    if (target.tagName) parts.push(String(target.tagName).toLowerCase());
    if (target.id) parts.push('#' + target.id);
    if (target.name) parts.push('[name="' + target.name + '"]');
    if (target.selector) parts.push('selector=' + target.selector);
    if (target.textContent) parts.push('text="' + String(target.textContent).trim().substring(0, 40) + '"');
    return parts.join(' ') || '无目标信息';
  }

  function describeElement(element) {
    if (!element) return 'null';
    var parts = [String(element.tagName || '').toLowerCase()];
    if (element.id) parts.push('#' + element.id);
    if (element.name) parts.push('[name="' + element.name + '"]');
    if (element.className && typeof element.className === 'string') {
      parts.push('.' + element.className.trim().split(/\s+/).slice(0, 3).join('.'));
    }
    return parts.join('');
  }

  var ActionReplayer = function(steps) {
    this.steps = steps || [];
    this.currentIndex = -1;
    this.isReplaying = false;
    this.isPaused = false;
    this.speed = 1;
    this.highlightEnabled = true;
  };

  ActionReplayer.prototype.log = function(message, level, step) {
    sendReplayLog(message, level, step);
  };

  ActionReplayer.prototype.createHighlight = function(x, y, color) {
    color = color || 'rgba(239, 68, 68, 0.8)';
    if (!this.highlightEnabled) return;
    var marker = document.createElement('div');
    marker.style.cssText = 'position:fixed;left:' + (x - 8) + 'px;top:' + (y - 8) + 'px;width:16px;height:16px;background:' + color + ';border:2px solid #fff;border-radius:50%;z-index:999999;pointer-events:none;animation:replayPulse 0.6s ease-out forwards;';
    if (!document.getElementById('replay-animation-style')) {
      var style = document.createElement('style');
      style.id = 'replay-animation-style';
      style.textContent = '@keyframes replayPulse{0%{transform:scale(0.5);opacity:1}50%{transform:scale(2);opacity:0.5}100%{transform:scale(3);opacity:0}}';
      document.head.appendChild(style);
    }
    document.body.appendChild(marker);
    setTimeout(function() { marker.remove(); }, 600);
  };

  ActionReplayer.prototype.isEditable = function(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  };

  ActionReplayer.prototype.isDisabled = function(el) {
    if (!el) return false;
    return !!el.disabled || el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true';
  };

  ActionReplayer.prototype.setNativeValue = function(element, value) {
    var tag = (element.tagName || '').toUpperCase();
    var proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  };

  ActionReplayer.prototype.dispatchTextInputEvents = function(element, value) {
    try {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (e) {}
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (e2) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  ActionReplayer.prototype.setContentEditableText = async function(element, value) {
    element.focus();
    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    var inserted = false;
    try {
      inserted = document.execCommand('insertText', false, value);
    } catch (e) {
      inserted = false;
    }

    if (!inserted || this.normalizeText(element.textContent) !== this.normalizeText(value)) {
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      selection.deleteFromDocument();
      element.textContent = value;
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    this.dispatchTextInputEvents(element, value);
    await new Promise(function(r) { setTimeout(r, 100); });
  };

  ActionReplayer.prototype.normalizeText = function(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  };

  ActionReplayer.prototype.getExpectedPoint = function(step) {
    if (!step || step.x === undefined || step.y === undefined) return null;
    var scaleX = step.viewportWidth ? (window.innerWidth / step.viewportWidth) : 1;
    var scaleY = step.viewportHeight ? (window.innerHeight / step.viewportHeight) : 1;
    return {
      x: Math.max(0, Math.min(window.innerWidth - 1, step.x * scaleX)),
      y: Math.max(0, Math.min(window.innerHeight - 1, step.y * scaleY))
    };
  };

  ActionReplayer.prototype.findBestCandidate = function(candidates, step, source) {
    var expectedText = step && step.target ? this.normalizeText(step.target.textContent) : '';
    var expectedPoint = this.getExpectedPoint(step);
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el || el === document.body || el === document.documentElement) continue;
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      var score = source === 'selector' ? 80 : 0;
      var text = this.normalizeText(el.textContent || el.value || '');
      if (expectedText) {
        if (text === expectedText) score += 1000;
        else if (text.indexOf(expectedText) >= 0) score += 500;
        else continue;
      }
      if (expectedPoint) {
        if (expectedPoint.x >= rect.left && expectedPoint.x <= rect.right && expectedPoint.y >= rect.top && expectedPoint.y <= rect.bottom) score += 250;
        var dx = rect.left + rect.width / 2 - expectedPoint.x;
        var dy = rect.top + rect.height / 2 - expectedPoint.y;
        score += Math.max(0, 200 - Math.sqrt(dx * dx + dy * dy));
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best && bestScore > -500) {
      this.log('Best ' + source + ' candidate: ' + describeElement(best) + ', score=' + Math.round(bestScore), 'info', step);
      return best;
    }
    return null;
  };

  ActionReplayer.prototype.urlMatchesStep = function(step) {
    if (!step || !step.pageUrl) return true;
    try {
      var current = new URL(window.location.href);
      var expected = new URL(step.pageUrl, window.location.href);
      return current.origin === expected.origin && current.pathname === expected.pathname;
    } catch (e) {
      return true;
    }
  };

  ActionReplayer.prototype.waitForStepPage = async function(step, timeoutMs) {
    if (!step || !step.pageUrl || step.type === 'navigation') return true;
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.urlMatchesStep(step)) return true;
      await new Promise(function(r) { setTimeout(r, 250); });
    }
    this.log('Page URL still differs from recorded step: current=' + window.location.href + ', recorded=' + step.pageUrl, 'info', step);
    return false;
  };

  ActionReplayer.prototype.waitForElement = async function(step, timeoutMs) {
    var start = Date.now();
    var element = null;
    while (Date.now() - start < timeoutMs) {
      element = this.findElement(step);
      if (element) return element;
      await new Promise(function(r) { setTimeout(r, 300); });
    }
    return this.findElement(step);
  };

  ActionReplayer.prototype.waitForActionableElement = async function(step, timeoutMs) {
    var start = Date.now();
    var element = null;
    while (Date.now() - start < timeoutMs) {
      element = this.findElement(step);
      if (element && !this.isDisabled(element)) return element;
      await new Promise(function(r) { setTimeout(r, 200); });
    }
    return element || this.findElement(step);
  };

  ActionReplayer.prototype.findBySelector = function(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  };

  ActionReplayer.prototype.executeWait = async function(step) {
    var mode = step && step.waitMode === 'element' ? 'element' : 'time';
    if (mode === 'element') {
      var selector = step.waitSelector || '';
      var timeoutMs = Math.max(0, Number(step.waitTimeoutMs) || 0);
      if (!selector) {
        this.log('Wait failed: missing selector', 'fail', step);
        return false;
      }
      this.log('Wait for element: ' + selector + ', timeout=' + timeoutMs + 'ms', 'executing', step);
      var start = Date.now();
      while (Date.now() - start <= timeoutMs) {
        var element = this.findBySelector(selector);
        if (element) {
          this.log('Wait element found: ' + describeElement(element), 'success', step);
          return true;
        }
        if (timeoutMs === 0) break;
        await new Promise(function(r) { setTimeout(r, 200); });
      }
      this.log('Wait timed out: element not found: ' + selector, 'fail', step);
      return false;
    }

    var waitMs = Math.max(0, Number(step.waitMs) || 0);
    this.log('Wait fixed time: ' + waitMs + 'ms', 'executing', step);
    await new Promise(function(r) { setTimeout(r, waitMs); });
    this.log('Wait finished: ' + waitMs + 'ms', 'success', step);
    return true;
  };

  ActionReplayer.prototype.getElementText = function(element) {
    if (!element) return '';
    return this.normalizeText(element.textContent || element.value || '');
  };

  ActionReplayer.prototype.pageHasText = function(text) {
    var expected = this.normalizeText(text);
    if (!expected) return false;
    return this.normalizeText(document.body ? document.body.innerText || document.body.textContent : '').indexOf(expected) >= 0;
  };

  ActionReplayer.prototype.getRegionText = function(region) {
    if (!region || !document.body) return '';
    var left = Number(region.left) || 0;
    var top = Number(region.top) || 0;
    var width = Number(region.width) || 0;
    var height = Number(region.height) || 0;
    if (width <= 0 || height <= 0) return '';

    var right = left + width;
    var bottom = top + height;
    var chunks = [];
    var seen = {};

    function rectIntersects(rect) {
      var pageLeft = rect.left + window.scrollX;
      var pageTop = rect.top + window.scrollY;
      var pageRight = pageLeft + rect.width;
      var pageBottom = pageTop + rect.height;
      return !(pageRight < left || pageLeft > right || pageBottom < top || pageTop > bottom);
    }

    function addText(text) {
      text = String(text || '').replace(/\s+/g, ' ').trim();
      if (!text || seen[text]) return;
      seen[text] = true;
      chunks.push(text);
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!String(node.nodeValue || '').replace(/\s+/g, ' ').trim()) return NodeFilter.FILTER_REJECT;
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
      if (!el || !el.getBoundingClientRect) return;
      var style = window.getComputedStyle(el);
      if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return;
      var rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0 || !rectIntersects(rect)) return;
      addText(el.value || el.placeholder || '');
    });

    return this.normalizeText(chunks.join(' '));
  };

  ActionReplayer.prototype.evaluateAssertionOnce = function(assertion) {
    var type = assertion.type || 'textVisible';
    var expected = assertion.expected || assertion.target || '';
    var selector = assertion.selector || '';
    var element = selector ? this.findBySelector(selector) : null;
    var actual = '';

    if (type === 'textVisible') {
      actual = this.pageHasText(expected) ? expected : '';
      return { passed: !!actual, actual: actual || '未找到文本' };
    }
    if (type === 'elementExists') {
      actual = element ? describeElement(element) : '未找到元素';
      return { passed: !!element, actual: actual };
    }
    if (type === 'elementNotExists') {
      actual = element ? describeElement(element) : '元素不存在';
      return { passed: !element, actual: actual };
    }
    if (type === 'urlContains') {
      actual = window.location.href;
      return { passed: actual.indexOf(expected) >= 0, actual: actual };
    }
    if (type === 'elementTextContains') {
      actual = this.getElementText(element);
      return { passed: !!element && actual.indexOf(this.normalizeText(expected)) >= 0, actual: element ? actual : '未找到元素' };
    }
    if (type === 'elementTextEquals') {
      actual = this.getElementText(element);
      return { passed: !!element && actual === this.normalizeText(expected), actual: element ? actual : '未找到元素' };
    }
    if (type === 'regionTextContains') {
      actual = this.getRegionText(assertion.region);
      return { passed: actual.indexOf(this.normalizeText(expected)) >= 0, actual: actual || 'No text in selected region' };
    }
    if (type === 'regionTextNotContains') {
      actual = this.getRegionText(assertion.region);
      return { passed: actual.indexOf(this.normalizeText(expected)) < 0, actual: actual || 'No text in selected region' };
    }
    return { passed: false, actual: '', error: 'Unknown assertion type: ' + type };
  };

  ActionReplayer.prototype.runAssertion = async function(assertion, step) {
    if (!assertion || assertion.enabled === false) {
      return Object.assign({}, assertion || {}, { status: 'skipped', actual: '', error: '' });
    }

    var timeout = assertion.timeout == null ? 2000 : Math.max(0, Number(assertion.timeout) || 0);
    var start = Date.now();
    var lastResult = null;
    while (Date.now() - start <= timeout) {
      lastResult = this.evaluateAssertionOnce(assertion);
      if (lastResult.passed) break;
      if (timeout === 0) break;
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    var status = lastResult && lastResult.passed ? 'passed' : 'failed';
    var result = Object.assign({}, assertion, {
      status: status,
      actual: lastResult ? lastResult.actual : '',
      error: lastResult && lastResult.error ? lastResult.error : ''
    });
    this.log('Assertion ' + status + ': ' + (assertion.type || '') + ' expected=' + (assertion.expected || assertion.selector || ''), status === 'passed' ? 'success' : 'fail', step);
    return result;
  };

  ActionReplayer.prototype.runAssertions = async function(step) {
    var assertions = Array.isArray(step.assertions) ? step.assertions : [];
    var results = [];
    var success = true;
    for (var i = 0; i < assertions.length; i++) {
      var result = await this.runAssertion(assertions[i], step);
      results.push(result);
      if (result.status === 'failed') success = false;
    }
    return { success: success, results: results };
  };

  ActionReplayer.prototype.findElement = function(step) {
    this.log('Locate element: ' + describeTarget(step), 'info', step);
    var expectedPoint = this.getExpectedPoint(step);
    if (!step || !step.target) {
      if (step && step.x !== undefined && step.y !== undefined) {
        return document.elementFromPoint(expectedPoint ? expectedPoint.x : step.x, expectedPoint ? expectedPoint.y : step.y);
      }
      this.log('Locate failed: missing target and coordinates', 'fail', step);
      return null;
    }
    var target = step.target;
    var element = null;
    if (target.id) {
      element = document.getElementById(target.id);
      if (element) {
        if (!target.textContent || this.normalizeText(element.textContent || element.value || '').indexOf(this.normalizeText(target.textContent)) >= 0) return element;
      }
    }
    if (target.name) {
      element = this.findBestCandidate(Array.prototype.slice.call(document.getElementsByName(target.name)), step, 'name');
      if (element) return element;
    }
    if (target.selector) {
      try {
        element = this.findBestCandidate(Array.prototype.slice.call(document.querySelectorAll(target.selector)), step, 'selector');
        if (element) {
          this.log('Matched by selector + text/coordinate: ' + describeElement(element), 'info', step);
          return element;
        }
        this.log('Selector had no text/coordinate match: ' + target.selector, 'fail', step);
      } catch (e) {
        this.log('Invalid selector: ' + target.selector + ', error=' + e.message, 'fail', step);
      }
    }
    if (target.textContent && target.textContent.trim().length > 0) {
      var searchText = this.normalizeText(target.textContent);
      var textSelector = target.tagName ? target.tagName.toLowerCase() + ', span, div, button, a, yt-formatted-string' : 'span, div, button, a, yt-formatted-string';
      var allElements = Array.prototype.slice.call(document.querySelectorAll(textSelector));
      var textMatches = [];
      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        if (this.normalizeText(el.textContent || el.value || '') === searchText) {
          textMatches.push(el);
        }
      }
      element = this.findBestCandidate(textMatches, step, 'text');
      if (element) return element;
    }
    if (step.x !== undefined && step.y !== undefined) {
      element = document.elementFromPoint(expectedPoint ? expectedPoint.x : step.x, expectedPoint ? expectedPoint.y : step.y);
      this.log('Coordinate fallback hit: ' + describeElement(element), element ? 'info' : 'fail', step);
      if (element && element !== document.body) {
        if (target.textContent) {
          var expectedText = this.normalizeText(target.textContent);
          var actualText = this.normalizeText(element.textContent || element.value || '');
          if (actualText && actualText !== expectedText && actualText.indexOf(expectedText) < 0) {
            this.log('Coordinate text mismatch; refusing click: ' + actualText, 'fail', step);
            return null;
          }
        }
        return element;
      }
    }
    this.log('Locate failed: no element matched both text and coordinates', 'fail', step);
    return null;
  };

  ActionReplayer.prototype.executeFocus = async function(step) {
    var element = this.findElement(step);
    if (!element) {
      this.log('聚焦失败: 找不到元素', 'fail', step);
      return false;
    }
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(function(r) { setTimeout(r, 200); });
      element.focus();
      this.log('聚焦成功: ' + describeElement(element), 'success', step);
      return true;
    } catch (error) {
      this.log('聚焦异常: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeNavigation = async function(step) {
    try {
      var url = step.url || step.pageUrl;
      if (!url) {
        this.log('导航失败: 步骤缺少 url/pageUrl', 'fail', step);
        return false;
      }

      var currentUrl = window.location.href;
      this.log('准备导航: 当前=' + currentUrl + '，目标=' + url, 'navigate', step);
      var isSamePage = false;
      try {
        var currentBase = new URL(currentUrl).origin + new URL(currentUrl).pathname;
        var targetBase = new URL(url, currentUrl).origin + new URL(url, currentUrl).pathname;
        isSamePage = (currentBase === targetBase);
      } catch (e) {
        isSamePage = (currentUrl.indexOf(url) === 0 || url.indexOf(currentUrl) === 0);
      }

      if (isSamePage) {
        this.log('导航跳过: 当前页面已匹配目标地址', 'success', step);
        return true;
      }

      var remainingSteps = [step];
      for (var i = this.currentIndex + 1; i < this.steps.length; i++) {
        remainingSteps.push(this.steps[i]);
      }

      await savePendingReplay({
        steps: remainingSteps,
        speed: this.speed,
        currentIndex: 0,
        totalSteps: this.steps.length
      });
      console.log('Saved remaining steps:', remainingSteps.length);

      sendUniqueMessage('replayStatus', { status: 'navigating', url: url }, 'nav');
      this.isReplaying = false;
      window.location.href = url;
      return true;
    } catch (error) {
      this.log('导航异常: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeInput = async function(step) {
    var element = this.findElement(step);
    if (!element) {
      this.log('输入失败: 找不到输入元素', 'fail', step);
      return false;
    }
    if (!this.isEditable(element)) {
      this.log('输入失败: 元素不可编辑 ' + describeElement(element), 'fail', step);
      return false;
    }
    try {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(function(r) { setTimeout(r, 200); });
      var value = step.value || '';
      this.log('准备输入: "' + String(value).substring(0, 80) + '" 到 ' + describeElement(element), 'executing', step);
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        this.setNativeValue(element, '');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        this.setNativeValue(element, value);
        this.dispatchTextInputEvents(element, value);
      } else if (element.isContentEditable) {
        await this.setContentEditableText(element, value);
      } else if (element.tagName === 'SELECT') {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (this.highlightEnabled) {
        var rect = element.getBoundingClientRect();
        this.createHighlight(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      this.log('输入成功: 当前值长度=' + String(value).length, 'success', step);
      return true;
    } catch (error) {
      this.log('输入异常: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeKeydown = async function(step) {
    var element = this.findElement(step) || document.activeElement;
    if (!element) {
      this.log('Keydown failed: no target element and no active element', 'fail', step);
      return false;
    }
    try {
      element.focus();
      this.log('Dispatch keydown: key=' + step.key + ', target=' + describeElement(element), 'executing', step);
      if (step.key === 'Enter') {
        var form = element.closest('form');
        if (form) {
          var remainingSteps = [];
          for (var i = this.currentIndex + 1; i < this.steps.length; i++) {
            remainingSteps.push(this.steps[i]);
          }
          if (remainingSteps.length > 0) {
            await savePendingReplay({
              steps: remainingSteps,
              speed: this.speed,
              currentIndex: 0,
              totalSteps: this.steps.length
            });
            console.log('Enter键保存剩余步骤:', remainingSteps.length);
          }
          sendUniqueMessage('replayStatus', { status: 'navigating' }, 'nav_enter');
          this.log('Enter key will submit form; saved remaining steps=' + remainingSteps.length, 'navigate', step);
          this.isReplaying = false;
          setTimeout(function() { form.submit(); }, 100);
          return true;
        }
      }
      element.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true }));
      this.log('Keydown dispatched successfully: ' + step.key, 'success', step);
      return true;
    } catch (error) {
      this.log('Keydown exception: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeClick = async function(step) {
    await this.waitForStepPage(step, 8000);
    var element = await this.waitForActionableElement(step, 8000);
    if (!element && step.x !== undefined) {
      var expectedPoint = this.getExpectedPoint(step);
      element = document.elementFromPoint(expectedPoint ? expectedPoint.x : step.x, expectedPoint ? expectedPoint.y : step.y);
      this.log('Click fallback by coordinate hit: ' + describeElement(element), element ? 'info' : 'fail', step);
      if (element && step.target && step.target.textContent) {
        var expectedText = this.normalizeText(step.target.textContent);
        var actualText = this.normalizeText(element.textContent || element.value || '');
        if (actualText && actualText !== expectedText && actualText.indexOf(expectedText) < 0) {
          this.log('Click fallback text mismatch; refusing coordinate click: ' + actualText, 'fail', step);
          element = null;
        }
      }
    }
    if (!element) {
      this.log('Click failed: element not found', 'fail', step);
      console.warn('点击失败：找不到元素');
      return false;
    }
    if (this.isDisabled(element)) {
      this.log('Click failed: element is disabled ' + describeElement(element), 'fail', step);
      return false;
    }
    try {
      var remainingSteps = [];
      for (var i = this.currentIndex + 1; i < this.steps.length; i++) {
        remainingSteps.push(this.steps[i]);
      }
      if (remainingSteps.length > 0) {
        await savePendingReplay({
          steps: remainingSteps,
          speed: this.speed,
          currentIndex: 0,
          totalSteps: this.steps.length
        });
        setTimeout(function() {
          if (window.__replayer && window.__replayer.isReplaying) clearPendingReplay();
        }, 2500);
      }
      this.log('Prepare click on ' + describeElement(element), 'executing', step);
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(function(r) { setTimeout(r, 200); });
      var rect = element.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;
      if (step.target && step.target.clickOffsetX != null && step.target.clickOffsetY != null) {
        centerX = rect.left + Math.max(0, Math.min(rect.width, step.target.clickOffsetX));
        centerY = rect.top + Math.max(0, Math.min(rect.height, step.target.clickOffsetY));
      }
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: centerX, clientY: centerY, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: centerX, clientY: centerY, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: centerX, clientY: centerY, view: window }));
      if (typeof element.click === 'function') {
        element.click();
      }
      this.createHighlight(centerX, centerY);
      this.log('Click succeeded at (' + Math.round(centerX) + ', ' + Math.round(centerY) + ') on ' + describeElement(element), 'success', step);
      console.log('点击成功:', element.tagName, element.className);
      return true;
    } catch (error) {
      console.error('点击失败:', error);
      this.log('Click exception: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeScroll = async function(step) {
    try {
      this.log('Scroll to x=' + (step.scrollX || 0) + ', y=' + (step.scrollY || 0), 'executing', step);
      window.scrollTo({ left: step.scrollX || 0, top: step.scrollY || 0, behavior: 'smooth' });
      this.log('Scroll command dispatched', 'success', step);
      return true;
    } catch (error) {
      this.log('Scroll exception: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeMouseEvent = async function(step) {
    var element = this.findElement(step);
    if (!element) {
      this.log('Mouse event failed: element not found', 'fail', step);
      return false;
    }
    try {
      var eventType = step.type === 'rightClick' ? 'contextmenu' : 'dblclick';
      this.log('Dispatch mouse event: ' + eventType + ' on ' + describeElement(element), 'executing', step);
      element.dispatchEvent(new MouseEvent(eventType, { bubbles: true }));
      this.log('Mouse event dispatched: ' + eventType, 'success', step);
      return true;
    } catch (error) {
      this.log('Mouse event exception: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeSubmit = async function(step) {
    var element = this.findElement(step);
    if (!element) {
      this.log('Submit failed: element not found', 'fail', step);
      return false;
    }
    try {
      var form = element.closest('form');
      if (!form) {
        this.log('Submit failed: no parent form for ' + describeElement(element), 'fail', step);
        return false;
      }
      this.log('Submit form from ' + describeElement(element), 'navigate', step);
      form.submit();
      return true;
    } catch (error) {
      this.log('Submit exception: ' + error.message, 'fail', step);
      return false;
    }
  };

  ActionReplayer.prototype.executeStep = function(step, index) {
    var self = this;
    return new Promise(function(resolve) {
      if (!step || !step.type) {
        self.log('Step skipped: missing step or type', 'fail', step);
        resolve(false);
        return;
      }
      if (!step.stepNumber) step.stepNumber = index + 1;

      setTimeout(async function() {
        var startTime = Date.now();
        var success = false;
        self.log('Step #' + step.stepNumber + ' started: type=' + step.type + ', page=' + window.location.href, 'executing', step);
        try {
          switch (step.type) {
            case 'navigation': success = await self.executeNavigation(step); break;
            case 'click': success = await self.executeClick(step); break;
            case 'focus': success = await self.executeFocus(step); break;
            case 'input': success = await self.executeInput(step); break;
            case 'keydown': success = await self.executeKeydown(step); break;
            case 'scroll': success = await self.executeScroll(step); break;
            case 'wait': success = await self.executeWait(step); break;
            case 'rightClick': success = await self.executeMouseEvent(step); break;
            case 'dblclick': success = await self.executeMouseEvent(step); break;
            case 'submit': success = await self.executeSubmit(step); break;
            default:
              self.log('Unknown step type, treating as success: ' + step.type, 'info', step);
              success = true;
          }
        } catch (error) {
          success = false;
          console.error('步骤执行异常:', error);
        }
        if (!success) {
          self.log('Step #' + step.stepNumber + ' returned failure before result event', 'fail', step);
        }
        var assertionRun = await self.runAssertions(step);
        if (!assertionRun.success) success = false;
        var duration = Date.now() - startTime;

        sendUniqueMessage('replayStepResult', {
          index: index,
          stepNumber: step.stepNumber,
          success: success,
          duration: duration,
          assertions: assertionRun.results
        }, 'result_' + index);

        console.log('步骤 #' + step.stepNumber + ' 执行' + (success ? '成功' : '失败') + ' 耗时:' + duration + 'ms');

        self.log('Step #' + step.stepNumber + ' finished: ' + (success ? 'success' : 'fail') + ', duration=' + duration + 'ms', success ? 'success' : 'fail', step);
        var delay = (step.type === 'navigation') ? 1500 : 400;
        setTimeout(function() { resolve(success); }, delay);
      }, 300);
    });
  };

  ActionReplayer.prototype.sendStatus = function(status, stepNum, step) {
    sendUniqueMessage('replayStatus', {
      status: status,
      step: stepNum,
      total: this.steps.length,
      type: step ? step.type : undefined
    }, 'status_' + status + '_' + stepNum);
  };

  ActionReplayer.prototype.startReplay = async function(fromIndex) {
    fromIndex = fromIndex || 0;
    if (this.isReplaying && !this.isPaused) return;
    if (this.isPaused) this.isPaused = false;

    this.isReplaying = true;
    this.currentIndex = fromIndex;
    this.log('Replay started: fromIndex=' + fromIndex + ', totalSteps=' + this.steps.length + ', speed=' + this.speed + ', url=' + window.location.href, 'start');
    this.sendStatus('started', fromIndex + 1);

    if (this.steps.length > 0 && fromIndex < this.steps.length) {
      this.sendStatus('executing', fromIndex + 1, this.steps[fromIndex]);
    }

    for (var i = fromIndex; i < this.steps.length; i++) {
      while (this.isPaused && this.isReplaying) {
        await new Promise(function(r) { setTimeout(r, 100); });
      }
      if (!this.isReplaying) break;

      this.currentIndex = i;
      var step = this.steps[i];
      if (!step.stepNumber) step.stepNumber = i + 1;

      this.sendStatus('executing', i + 1, step);
      await this.waitForStepPage(step, 8000);
      await this.executeStep(step, i);

      if (step.type !== 'navigation') {
        await new Promise(function(r) { setTimeout(r, 800 / this.speed); }.bind(this));
      } else {
        await new Promise(function(r) { setTimeout(r, 1500); });
      }
    }

    this.isReplaying = false;
    this.isPaused = false;

    if (this.currentIndex >= this.steps.length - 1) {
      this.sendStatus('completed', this.steps.length);
      this.log('Replay completed: totalSteps=' + this.steps.length, 'complete');
      console.log('========== 回放完成 ==========');
    }
  };

  ActionReplayer.prototype.pause = function() {
    if (!this.isReplaying) return;
    this.isPaused = true;
    this.log('Replay paused at index=' + this.currentIndex, 'pause');
    this.sendStatus('paused', this.currentIndex + 1);
  };

  ActionReplayer.prototype.resume = function() {
    if (!this.isReplaying) return;
    if (!this.isPaused) return;
    this.isPaused = false;
    this.log('Replay resumed at index=' + this.currentIndex, 'start');
    this.sendStatus('resumed', this.currentIndex + 1);
  };

  ActionReplayer.prototype.stop = function(silent) {
    this.isReplaying = false;
    this.isPaused = false;
    this.steps = [];
    this.currentIndex = -1;
    clearPendingReplay();
    if (!silent) {
      this.log('Replay stopped and pending steps cleared', 'info');
      this.sendStatus('stopped');
    }
  };

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'startReplayScript':
          if (window.__replayer) window.__replayer.stop(true);
          var replayer = new ActionReplayer(request.steps);
          replayer.speed = request.speed || 1;
          replayer.highlightEnabled = request.highlight !== false;
          window.__replayer = replayer;
          replayer.startReplay(request.fromIndex || 0);
          sendResponse({ success: true });
          break;
        case 'stopReplayScript':
          if (window.__replayer) { window.__replayer.stop(); window.__replayer = null; }
          sendResponse({ success: true });
          break;
        case 'pauseReplayScript':
          if (window.__replayer) window.__replayer.pause();
          sendResponse({ success: true });
          break;
        case 'resumeReplayScript':
          if (window.__replayer) window.__replayer.resume();
          sendResponse({ success: true });
          break;
        default:
          sendResponse({ success: false });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  });

// 每次页面加载都重置检查标记
window.__replay_pending_checked__ = false;
console.log('重置 checkPendingReplay 标记');

(async function checkPendingReplay() {
  sendReplayLog('Pending replay check started on ' + window.location.href, 'info');
  console.log('checkPendingReplay 开始执行');

  // 检查全局停止标志
  try {
    var globalStop = localStorage.getItem('__replay_global_stop__');
    if (globalStop === 'true') {
      console.log('全局停止标志存在，跳过恢复回放');
      await clearPendingReplay();
      return;
    }
  } catch (e) {}

  var pendingData = await getPendingReplay();
  if (!pendingData) {
    console.log('没有待回放的步骤');
    return;
  }

  if (typeof pendingData !== 'string') pendingData = JSON.stringify(pendingData);
  console.log('发现待回放步骤:', pendingData.substring(0, 200));

  try {
    var data = JSON.parse(pendingData);
    var steps = data.steps || [];
    var speed = data.speed || 1;
    sendReplayLog('Pending replay data found: steps=' + steps.length + ', speed=' + speed, 'navigate');

    console.log('待回放步骤数量:', steps.length);

    // ✅ 关键修复：立即清除，防止重复
    await clearPendingReplay();

    if (steps.length === 0) {
      console.log('剩余步骤为空');
      return;
    }

    // 过滤已执行的导航步骤
    var currentUrl = window.location.href;
    var filteredSteps = [];

    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (step.type === 'navigation') {
        var targetUrl = step.url || '';
        var skip = false;
        try {
          var currentBase = new URL(currentUrl).origin + new URL(currentUrl).pathname;
          var targetBase = new URL(targetUrl, currentUrl).origin + new URL(targetUrl, currentUrl).pathname;
          skip = (currentBase === targetBase);
        } catch (e) {
          skip = (currentUrl.indexOf(targetUrl) === 0);
        }
        if (skip) {
          console.log('跳过已加载的导航步骤:', targetUrl);
          var skipStartTime = Date.now();
          var skipAssertionRun = await (new ActionReplayer([])).runAssertions(step);
          var skipSuccess = skipAssertionRun.success;
          sendUniqueMessage('replayStepResult', {
            index: i,
            stepNumber: step.stepNumber,
            success: skipSuccess,
            duration: Date.now() - skipStartTime,
            assertions: skipAssertionRun.results
          }, 'skip_nav_result_' + (step.stepNumber || i));
          sendReplayLog('Skipped already-loaded navigation step; marked ' + (skipSuccess ? 'success' : 'fail'), skipSuccess ? 'success' : 'fail', step);
          continue;
        }
      }
      filteredSteps.push(step);
    }

    console.log('过滤后步骤数量:', filteredSteps.length);

    if (filteredSteps.length === 0) {
      console.log('所有步骤都已执行，发送完成');
      sendUniqueMessage('replayStatus', { status: 'completed', total: data.totalSteps || steps.length }, 'complete_pending');
      sendReplayLog('All pending steps filtered out; sending completed status', 'complete');
      return;
    }

    // 重新编号
    // 延迟执行，确保页面稳定
    setTimeout(function() {
      sendReplayLog('Resume replay after navigation: filteredSteps=' + filteredSteps.length, 'navigate');
      console.log('开始恢复回放，执行步骤:', filteredSteps.length);

      if (window.__replayer) {
        window.__replayer.stop(true);
        window.__replayer = null;
      }

      var replayer = new ActionReplayer(filteredSteps);
      replayer.speed = speed;
      replayer.highlightEnabled = true;
      window.__replayer = replayer;

      // 发送恢复状态
      sendUniqueMessage('replayStatus', {
        status: 'resumed',
        step: 1,
        total: filteredSteps.length
      }, 'resumed');

      // 开始回放
      setTimeout(function() {
        replayer.startReplay(0);
      }, 500);
    }, 1000);

  } catch (e) {
    console.error('恢复回放失败:', e);
    await clearPendingReplay();
  }
})();

  console.log('replay-inject.js 加载完成');
})();
