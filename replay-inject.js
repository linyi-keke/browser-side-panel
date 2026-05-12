(function() {
  'use strict';

  console.log('========== replay-inject.js 已加载 ==========');
  console.log('当前页面URL:', window.location.href);

  // 标记已注入
  window.__replay_injected = true;

  var __lastMessageTime = {};

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

  ActionReplayer.prototype.findElement = function(step) {
    this.log('定位元素: ' + describeTarget(step), 'info', step);
    if (!step || !step.target) {
      if (step && step.x !== undefined && step.y !== undefined) {
        var pointElement = document.elementFromPoint(step.x, step.y);
        this.log('无 target，按坐标 (' + step.x + ', ' + step.y + ') 命中: ' + describeElement(pointElement), pointElement ? 'info' : 'fail', step);
        return pointElement;
      }
      this.log('定位失败: 缺少 target 和坐标', 'fail', step);
      return null;
    }
    var target = step.target;
    var element = null;

    if (target.id) {
      element = document.getElementById(target.id);
      if (element) {
        this.log('通过 id 找到元素: ' + describeElement(element), 'info', step);
        return element;
      }
      this.log('通过 id 未找到元素: #' + target.id, 'fail', step);
    }
    if (target.name) {
      var namedElements = document.getElementsByName(target.name);
      if (namedElements.length > 0) {
        this.log('通过 name 找到元素: ' + describeElement(namedElements[0]), 'info', step);
        return namedElements[0];
      }
      this.log('通过 name 未找到元素: ' + target.name, 'fail', step);
    }
    if (target.selector) {
      try {
        element = document.querySelector(target.selector);
        if (element) {
          this.log('通过 selector 找到元素: ' + describeElement(element), 'info', step);
          return element;
        }
        this.log('通过 selector 未找到元素: ' + target.selector, 'fail', step);
      } catch (e) {
        this.log('selector 无效: ' + target.selector + '，错误: ' + e.message, 'fail', step);
      }
    }

    if (target.textContent && target.textContent.trim().length > 0) {
      var searchText = target.textContent.trim();
      var allElements = document.querySelectorAll('span, div, button, a');
      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        var elText = (el.textContent || '').trim();
        if (elText === searchText) {
          console.log('通过文本找到元素:', searchText);
          return el;
        }
      }
    }

    if (target.id) {
      element = document.getElementById(target.id);
      if (element) {
        this.log('第二次 id 检查找到元素: ' + describeElement(element), 'info', step);
        return element;
      }
    }
    if (target.name) {
      var elements = document.getElementsByName(target.name);
      if (elements.length > 0) {
        this.log('第二次 name 检查找到元素: ' + describeElement(elements[0]), 'info', step);
        return elements[0];
      }
    }
    if (target.selector) {
      try {
        element = document.querySelector(target.selector);
        if (element) {
          this.log('第二次 selector 检查找到元素: ' + describeElement(element), 'info', step);
          return element;
        }
      } catch (e) {}
    }
    if (step.x !== undefined && step.y !== undefined) {
      element = document.elementFromPoint(step.x, step.y);
      this.log('Coordinate fallback hit: ' + describeElement(element), element ? 'info' : 'fail', step);
      if (element && element !== document.body) {
        this.log('坐标兜底命中元素: ' + describeElement(element), 'info', step);
        return element;
      }
      this.log('坐标兜底未命中有效元素: (' + step.x + ', ' + step.y + ')', 'fail', step);
    }
    this.log('定位失败: 所有策略均未找到元素', 'fail', step);
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

      var remainingSteps = [];
      for (var i = this.currentIndex + 1; i < this.steps.length; i++) {
        remainingSteps.push(this.steps[i]);
      }

      if (remainingSteps.length > 0) {
        sessionStorage.setItem('__replay_remaining_steps__', JSON.stringify({
          steps: remainingSteps,
          speed: this.speed,
          currentIndex: 0,
          totalSteps: this.steps.length
        }));
        console.log('保存剩余步骤:', remainingSteps.length);
      } else {
        sessionStorage.removeItem('__replay_remaining_steps__');
        sendUniqueMessage('replayStatus', { status: 'completed', total: this.steps.length }, 'complete');
      }

      sendUniqueMessage('replayStatus', { status: 'navigating', url: url }, 'nav');
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
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
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
          if (remainingSteps.length > 0 && !sessionStorage.getItem('__replay_remaining_steps__')) {
            sessionStorage.setItem('__replay_remaining_steps__', JSON.stringify({
              steps: remainingSteps,
              speed: this.speed,
              currentIndex: 0,
              totalSteps: this.steps.length
            }));
            console.log('Enter键保存剩余步骤:', remainingSteps.length);
          }
          sendUniqueMessage('replayStatus', { status: 'navigating' }, 'nav_enter');
          this.log('Enter key will submit form; saved remaining steps=' + remainingSteps.length, 'navigate', step);
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
    var element = this.findElement(step);
    if (!element && step.x !== undefined) {
      element = document.elementFromPoint(step.x, step.y);
      this.log('Click fallback by coordinate hit: ' + describeElement(element), element ? 'info' : 'fail', step);
    }
    if (!element) {
      this.log('Click failed: element not found', 'fail', step);
      console.warn('点击失败：找不到元素');
      return false;
    }
    try {
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
      element.click();
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
        var duration = Date.now() - startTime;

        sendUniqueMessage('replayStepResult', {
          index: index,
          stepNumber: step.stepNumber,
          success: success,
          duration: duration
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

  ActionReplayer.prototype.stop = function() {
    this.isReplaying = false;
    this.isPaused = false;
    this.steps = [];
    this.currentIndex = -1;
    sessionStorage.removeItem('__replay_remaining_steps__');
    this.log('Replay stopped and pending steps cleared', 'info');
    this.sendStatus('stopped');
  };

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'startReplayScript':
          if (window.__replayer) window.__replayer.stop();
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

(function checkPendingReplay() {
  sendReplayLog('Pending replay check started on ' + window.location.href, 'info');
  console.log('checkPendingReplay 开始执行');
  
  // 检查全局停止标志
  try {
    var globalStop = localStorage.getItem('__replay_global_stop__');
    if (globalStop === 'true') {
      console.log('全局停止标志存在，跳过恢复回放');
      sessionStorage.removeItem('__replay_remaining_steps__');
      return;
    }
  } catch (e) {}
  
  var pendingData = sessionStorage.getItem('__replay_remaining_steps__');
  if (!pendingData) {
    console.log('没有待回放的步骤');
    return;
  }
  
  console.log('发现待回放步骤:', pendingData.substring(0, 200));
  
  try {
    var data = JSON.parse(pendingData);
    var steps = data.steps || [];
    var speed = data.speed || 1;
    sendReplayLog('Pending replay data found: steps=' + steps.length + ', speed=' + speed, 'navigate');
    
    console.log('待回放步骤数量:', steps.length);
    
    // ✅ 关键修复：立即清除，防止重复
    sessionStorage.removeItem('__replay_remaining_steps__');
    
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
        window.__replayer.stop();
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
    sessionStorage.removeItem('__replay_remaining_steps__');
  }
})();

  console.log('replay-inject.js 加载完成');
})();
