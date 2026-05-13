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
  
  console.log('操作追踪器 Content Script 已加载');
  
  // 更新并发送窗口信息
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
  
  // 发送操作
  function sendAction(actionData) {
    if (!isRecording) return;
    
    chrome.runtime.sendMessage({
      type: 'recordAction',
      data: actionData
    }).catch(function() {});
  }
  
  // 获取元素选择器
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
  
  // 发送滚动位置
  function sendScrollPosition() {
    if (!isRecording) return;
    
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
  
  // 获取元素文本
  function getElementText(el) {
    if (!el) return '';
    
    var tagName = (el.tagName || '').toUpperCase();
    
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') return (el.value || el.placeholder || '').substring(0, 100);
    if (tagName === 'IMG') return (el.alt || el.title || '').substring(0, 100);
    if (tagName === 'A' || tagName === 'BUTTON') return (el.textContent || el.innerText || '').trim().substring(0, 100);
    if (el.textContent) return el.textContent.trim().substring(0, 100);
    
    return '';
  }
  
  // 是否可编辑
  function isEditableElement(el) {
    if (!el) return false;
    var tagName = (el.tagName || '').toUpperCase();
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || el.isContentEditable;
  }
  
  // 构建操作数据
  function buildActionData(type, event) {
    var target = event.target;
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
    console.log('记录导航步骤:', window.location.href);
  }
  
  // 监听点击
  document.addEventListener('click', function(e) {
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
    if (!isRecording) return;
    sendAction(buildActionData('rightClick', e));
  });
  
  // 监听双击
  document.addEventListener('dblclick', function(e) {
    if (!isRecording) return;
    sendAction(buildActionData('dblclick', e));
  });

  // 存储每个输入框的最终值（用于聚合）
var pendingInputValues = new Map();
var pendingInputTimers = new Map();
  
  // 监听输入
  document.addEventListener('input', function(e) {
  if (!isRecording) return;
  
  var target = e.target;
  if (!isEditableElement(target)) return;
  
  // 生成输入框的唯一标识
  var inputKey = getElementSelector(target) || target.name || target.id || 'unknown';
  
  // 获取当前值
  var currentValue = target.value || target.textContent || '';
  
  // 存储最终值
  pendingInputValues.set(inputKey, currentValue);
  
  // 清除之前的定时器
  if (pendingInputTimers.has(inputKey)) {
    clearTimeout(pendingInputTimers.get(inputKey));
  }
  
  // ✅ 设置新的定时器，用户停止输入 500ms 后保存最终值
  var timer = setTimeout(function() {
    var finalValue = pendingInputValues.get(inputKey);
    if (finalValue !== undefined) {
      var previousValue = ''; // 可以从之前的记录获取，这里简化
      
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
      console.log('保存最终输入值:', finalValue);
      
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
  window.addEventListener('scroll', function() {
    if (!isRecording) return;
    
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
  
  // 页面卸载前
  window.addEventListener('beforeunload', function() {
  // ✅ 在页面跳转前，保存所有未完成的输入
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
      console.log('页面跳转前保存输入:', history.lastValue);
    }
  });
  
  if (isRecording && scrollTimer) {
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
      
      if (!wasRecording && isRecording) recordNavigationStep();
      if (!isRecording) inputValueTracker.clear();
      
      console.log('录制状态:', isRecording ? '录制中' : '已停止');
      sendResponse({ success: true });
      return false;
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
  
  // 转发回放状态
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    
    if (event.data && (event.data.type === 'REPLAY_STEP_RESULT' || event.data.type === 'REPLAY_STATUS')) {
      chrome.runtime.sendMessage({
        type: event.data.type === 'REPLAY_STEP_RESULT' ? 'replayStepResult' : 'replayStatus',
        data: event.data
      }).catch(function() {});
    }
  });

// ✅ 检查是否需要恢复录制状态（页面跳转后）
(function checkRecordingResume() {
  // 从 sessionStorage 读取录制状态
  var savedState = sessionStorage.getItem('__recording_state__');
  if (savedState) {
    var state = JSON.parse(savedState);
    console.log('检测到待恢复的录制状态:', state);
    
    // 清除保存的状态（避免重复恢复）
    sessionStorage.removeItem('__recording_state__');
    
    // 延迟恢复，确保页面加载完成
    setTimeout(function() {
      isRecording = true;
      console.log('已恢复录制状态，当前页面:', window.location.href);
      
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
      console.log('记录跳转后的页面:', window.location.href);
    }, 1000);
  }
})();

// 在页面即将跳转时保存录制状态
window.addEventListener('beforeunload', function() {
  if (isRecording) {
    // 保存录制状态到 sessionStorage
    sessionStorage.setItem('__recording_state__', JSON.stringify({
      isRecording: true,
      timestamp: new Date().toISOString(),
      previousUrl: window.location.href
    }));
    console.log('页面即将跳转，已保存录制状态');
  }
  
  if (scrollTimer) {
    clearTimeout(scrollTimer);
    sendScrollPosition();
  }
  inputValueTracker.clear();
});
  
  // 初始化
  updateAndNotifyWindowInfo();
  console.log('Content Script 初始化完成');
})();

// 检查是否有待回放的回放步骤
(async function checkAndInjectReplay() {
  var response = await chrome.runtime.sendMessage({ type: 'getPendingReplay' }).catch(function() { return null; });
  var pendingData = response && response.data;
  if (pendingData) {
    console.log('检测到待回放步骤，请求 background 注入回放脚本');
    
    // 通过 background 注入，确保 chrome.runtime 可用
    chrome.runtime.sendMessage({ 
      type: 'injectReplayScript'
    }).catch(function(e) {
      console.log('发送注入请求失败:', e);
    });
    
    // 添加重试机制：如果3秒后还没有回放脚本，再次请求
    setTimeout(function() {
      if (!window.__replayer && !window.__replay_injected) {
        console.log('重试：再次请求注入回放脚本');
        chrome.runtime.sendMessage({ 
          type: 'injectReplayScript'
        }).catch(function(e) {});
      }
    }, 3000);
  }
})();
