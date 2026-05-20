// sidebar-replay.js - replay panel and playback controls
// Extracted from sidebar.js to keep the side panel logic easier to navigate.

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

async function closeReplayPanel() {
  await stopReplayInPage();

  isReplaying = false;
  isReplayPaused = false;
  replayIsNavigating = false;
  stepResults = {};

  var panel = document.getElementById('replayPanel');
  if (panel) panel.classList.add('hidden');

  // ✅ 清空日志
  clearReplayLog();
  renderActionList(actionHistory);

  // ✅ 额外清理一次
  if (replaySteps && replaySteps.length) {
    actionHistory = [].concat(cloneStepsForRecording(replaySteps)).reverse();
    stepCounter = actionHistory.length;
    updateStepCount();
    renderActionList(actionHistory);
  } else {
    renderActionList(actionHistory);
  }
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
    await chrome.runtime.sendMessage({ type: 'clearPendingReplay' }).catch(function() {});

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
    replaySteps = normalizeReplaySteps(replaySteps);

    // 重新编号

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
      replayIsNavigating = false;
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
  replayIsNavigating = false;
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
