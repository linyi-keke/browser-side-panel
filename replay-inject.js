// replay-inject.js - 负责在页面中执行回放步骤，提供回放控制和状态反馈功能
(function() {
  'use strict';

  console.log('replay-inject.js 初始化...');

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

  var ActionReplayer = function(steps) {
    this.steps = steps || [];
    this.currentIndex = -1;
    this.isReplaying = false;
    this.isPaused = false;
    this.speed = 1;
    this.highlightEnabled = true;
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
    if (!step || !step.target) {
      if (step && step.x !== undefined && step.y !== undefined) {
        return document.elementFromPoint(step.x, step.y);
      }
      return null;
    }
    var target = step.target;
    var element = null;
    
    // 通过文本查找
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
      if (element) return element;
    }
    if (target.name) {
      var elements = document.getElementsByName(target.name);
      if (elements.length > 0) return elements[0];
    }
    if (target.selector) {
      try {
        element = document.querySelector(target.selector);
        if (element) return element;
      } catch (e) {}
    }
    if (step.x !== undefined && step.y !== undefined) {
      element = document.elementFromPoint(step.x, step.y);
      if (element && element !== document.body) return element;
    }
    return null;
  };

  ActionReplayer.prototype.executeFocus = async function(step) {
    var element = this.findElement(step);
    if (!element) return false;
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(function(r) { setTimeout(r, 200); });
      element.focus();
      return true;
    } catch (error) {
      return false;
    }
  };

  ActionReplayer.prototype.executeNavigation = async function(step) {
    try {
      var url = step.url || step.pageUrl;
      if (!url) return false;
      
      var currentUrl = window.location.href;
      var isSamePage = false;
      try {
        var currentBase = new URL(currentUrl).origin + new URL(currentUrl).pathname;
        var targetBase = new URL(url, currentUrl).origin + new URL(url, currentUrl).pathname;
        isSamePage = (currentBase === targetBase);
      } catch (e) {
        isSamePage = (currentUrl.indexOf(url) === 0 || url.indexOf(currentUrl) === 0);
      }
      
      if (isSamePage) return true;
      
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
      return false;
    }
  };

  ActionReplayer.prototype.executeInput = async function(step) {
    var element = this.findElement(step);
    if (!element || !this.isEditable(element)) return false;
    try {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(function(r) { setTimeout(r, 200); });
      var value = step.value || '';
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
      return true;
    } catch (error) {
      return false;
    }
  };

  ActionReplayer.prototype.executeKeydown = async function(step) {
    var element = this.findElement(step) || document.activeElement;
    if (!element) return false;
    try {
      element.focus();
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
          setTimeout(function() { form.submit(); }, 100);
          return true;
        }
      }
      element.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true }));
      return true;
    } catch (error) {
      return false;
    }
  };

  ActionReplayer.prototype.executeClick = async function(step) {
    var element = this.findElement(step);
    if (!element && step.x !== undefined) {
      element = document.elementFromPoint(step.x, step.y);
    }
    if (!element) {
      console.warn('点击失败：找不到元素');
      return false;
    }
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(function(r) { setTimeout(r, 200); });
      var rect = element.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: centerX, clientY: centerY, view: window }));
      element.click();
      this.createHighlight(centerX, centerY);
      console.log('点击成功:', element.tagName, element.className);
      return true;
    } catch (error) {
      console.error('点击失败:', error);
      return false;
    }
  };

  ActionReplayer.prototype.executeScroll = async function(step) {
    try {
      window.scrollTo({ left: step.scrollX || 0, top: step.scrollY || 0, behavior: 'smooth' });
      return true;
    } catch (error) {
      return false;
    }
  };

  ActionReplayer.prototype.executeMouseEvent = async function(step) {
    var element = this.findElement(step);
    if (!element) return false;
    try {
      var eventType = step.type === 'rightClick' ? 'contextmenu' : 'dblclick';
      element.dispatchEvent(new MouseEvent(eventType, { bubbles: true }));
      return true;
    } catch (error) {
      return false;
    }
  };

  ActionReplayer.prototype.executeSubmit = async function(step) {
    var element = this.findElement(step);
    if (!element) return false;
    try {
      var form = element.closest('form');
      if (form) form.submit();
      return true;
    } catch (error) {
      return false;
    }
  };

  ActionReplayer.prototype.executeStep = function(step, index) {
    var self = this;
    return new Promise(function(resolve) {
      if (!step || !step.type) {
        resolve(false);
        return;
      }
      if (!step.stepNumber) step.stepNumber = index + 1;
      
      setTimeout(async function() {
        var startTime = Date.now();
        var success = false;
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
            default: success = true;
          }
        } catch (error) {
          success = false;
          console.error('步骤执行异常:', error);
        }
        var duration = Date.now() - startTime;
        
        sendUniqueMessage('replayStepResult', {
          index: index,
          stepNumber: step.stepNumber,
          success: success,
          duration: duration
        }, 'result_' + index);
        
        console.log('步骤 #' + step.stepNumber + ' 执行' + (success ? '成功' : '失败') + ' 耗时:' + duration + 'ms');
        
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
      console.log('========== 回放完成 ==========');
    }
  };

  ActionReplayer.prototype.pause = function() {
    if (!this.isReplaying) return;
    this.isPaused = true;
    this.sendStatus('paused', this.currentIndex + 1);
  };

  ActionReplayer.prototype.resume = function() {
    if (!this.isReplaying) return;
    if (!this.isPaused) return;
    this.isPaused = false;
    this.sendStatus('resumed', this.currentIndex + 1);
  };

  ActionReplayer.prototype.stop = function() {
    this.isReplaying = false;
    this.isPaused = false;
    this.steps = [];
    this.currentIndex = -1;
    sessionStorage.removeItem('__replay_remaining_steps__');
    this.sendStatus('stopped');
  };

  // 消息监听
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

  // 跨页面恢复
  (function checkPendingReplay() {
    if (window.__replay_pending_checked__) return;
    window.__replay_pending_checked__ = true;
    
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
    if (!pendingData) return;
    
    try {
      var data = JSON.parse(pendingData);
      var steps = data.steps || [];
      var speed = data.speed || 1;
      
      sessionStorage.removeItem('__replay_remaining_steps__');
      
      if (steps.length === 0) return;
      
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
      
      if (filteredSteps.length === 0) {
        sendUniqueMessage('replayStatus', { status: 'completed', total: data.totalSteps || steps.length }, 'complete_pending');
        return;
      }
      
      // 重新编号
      filteredSteps.forEach(function(s, idx) {
        s.stepNumber = (s.stepNumber || 1) + idx;
      });
      
      var waitForPageLoad = function() {
        if (document.readyState === 'complete') {
          console.log('页面已完全加载，开始恢复回放，剩余步骤:', filteredSteps.length);
          
          if (window.__replayer) {
            window.__replayer.stop();
            window.__replayer = null;
          }
          
          var replayer = new ActionReplayer(filteredSteps);
          replayer.speed = speed;
          replayer.highlightEnabled = true;
          window.__replayer = replayer;
          
          sendUniqueMessage('replayStatus', { 
            status: 'resumed', 
            step: filteredSteps[0] ? filteredSteps[0].stepNumber : 1, 
            total: data.totalSteps || filteredSteps.length 
          }, 'resumed');
          
          if (filteredSteps.length > 0) {
            sendUniqueMessage('replayStatus', { 
              status: 'executing', 
              step: filteredSteps[0].stepNumber, 
              total: data.totalSteps || filteredSteps.length,
              type: filteredSteps[0].type
            }, 'first_executing');
          }
          
          setTimeout(function() {
            replayer.startReplay(0);
          }, 500);
        } else {
          setTimeout(waitForPageLoad, 200);
        }
      };
      
      setTimeout(waitForPageLoad, 500);
    } catch (e) {
      console.error('恢复回放失败:', e);
      sessionStorage.removeItem('__replay_remaining_steps__');
    }
  })();

  console.log('replay-inject.js 加载完成');
})();