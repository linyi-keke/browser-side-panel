# 浏览器操作追踪器 (Browser Action Recorder)

> 一款功能强大的 Chrome 扩展，用于录制和回放浏览器操作，支持自动化测试、Bug 复现和用户行为分析。

---

## 📋 目录

- [功能特性](#功能特性)
- [版本信息](#版本信息)
- [文件结构](#文件结构)
- [安装指南](#安装指南)
- [使用说明](#使用说明)
- [API 说明](#api-说明)
- [技术架构](#技术架构)
- [权限说明](#权限说明)
- [常见问题](#常见问题)
- [开发指南](#开发指南)
- [更新日志](#更新日志)

---

## ✨ 功能特性

### 录制功能
- ✅ **操作录制**：自动记录点击、输入、滚动、键盘等操作
- ✅ **跨页面录制**：页面跳转后自动保持录制状态
- ✅ **跨标签页录制**：支持标签页切换记录
- ✅ **窗口信息**：实时记录窗口尺寸、视口大小
- ✅ **元素定位**：智能生成元素选择器（ID、Name、Class、XPath）

### 回放功能
- ✅ **自动回放**：一键回放录制的操作步骤
- ✅ **速度调节**：支持 0.5x、1x、2x、3x 回放速度
- ✅ **跨页面回放**：自动处理页面跳转，继续执行剩余步骤
- ✅ **高亮显示**：回放时高亮当前操作元素
- ✅ **暂停/恢复**：支持暂停和恢复回放

### 数据管理
- ✅ **导入/导出**：JSON 格式导入导出录制数据
- ✅ **步骤编辑**：修改步骤名称、坐标、输入内容
- ✅ **步骤删除**：删除不需要的操作步骤
- ✅ **操作筛选**：按类型筛选操作记录

### UI 特性
- ✅ **深色主题**：现代化的深色界面设计
- ✅ **实时日志**：显示回放执行的详细信息
- ✅ **进度显示**：回放进度条和步骤状态
- ✅ **窗口信息**：实时显示窗口和视口尺寸

---

## 📦 版本信息

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v7.0 | 2026-05-10 | 代码模块化重构 |
| v6.9 | 2026-05-09 | 修复跨页面回放状态更新 |
| v6.5 | 2026-05-08 | 添加跨页面回放功能 |
| v5.0 | 2026-05-01 | 添加回放功能 |
| v4.2 | 2026-04-25 | 初始版本 |

---

## 📁 文件结构

```
extension/
├── manifest.json                 # 扩展配置文件
├── background.js                 # 后台服务脚本
├── content.js                    # 页面注入脚本
├── replay-inject.js              # 回放执行脚本
├── sidebar.html                  # 侧边栏界面
├── sidebar.css                   # 侧边栏样式
├── sidebar.js                    # 侧边栏主逻辑
└── README.md                     # 说明文档
```

### 核心文件说明

| 文件 | 职责 | 大小 |
|------|------|------|
| `background.js` | 录制会话管理、消息路由、存储管理 | ~32KB |
| `content.js` | DOM 事件监听、操作记录、窗口信息 | ~20KB |
| `replay-inject.js` | 回放执行、元素查找、事件模拟 | ~28KB |
| `sidebar.js` | UI 渲染、用户交互、回放控制 | ~48KB |
| `sidebar.css` | 侧边栏样式定义 | ~22KB |
| `sidebar.html` | 侧边栏界面结构 | ~8KB |

---

## 🔧 安装指南

### 前置要求
- Chrome 浏览器版本 ≥ 114（支持 SidePanel API）
- 或 Edge 浏览器版本 ≥ 114

### 安装步骤

1. **下载扩展文件**
   ```bash
   git clone https://github.com/your-repo/browser-action-recorder.git
   # 或直接下载 ZIP 文件并解压
   ```

2. **打开 Chrome 扩展管理页面**
   - 地址栏输入：`chrome://extensions/`
   - 或点击菜单 → 更多工具 → 扩展程序

3. **启用开发者模式**
   - 点击页面右上角的「开发者模式」开关

4. **加载扩展**
   - 点击「加载已解压的扩展程序」
   - 选择扩展文件夹

5. **验证安装**
   - 工具栏出现扩展图标 📐
   - 点击图标打开侧边栏

---

## 📖 使用说明

### 基础使用流程

```
1. 打开侧边栏 → 2. 点击「录制」 → 3. 执行操作 → 4. 点击「停止」 → 5. 导出文件
```

### 录制操作

1. **开始录制**
   - 点击扩展图标打开侧边栏
   - 点击「⏺️ 录制」按钮
   - 状态变为「录制中」，开始记录操作

2. **执行操作**
   - 在页面上正常浏览、点击、输入
   - 所有操作自动记录到侧边栏列表
   - 支持的操作类型：点击、输入、滚动、按键、页面跳转

3. **停止录制**
   - 点击「⏹️ 停止」按钮
   - 自动弹出导出对话框
   - 输入文件名和备注，确认导出

### 回放操作

1. **导入文件**
   - 点击「📥 导入」按钮
   - 选择之前导出的 JSON 文件
   - 回放面板自动显示

2. **执行回放**
   - 点击「▶️ 播放」按钮
   - 自动执行录制的操作步骤
   - 可调节回放速度（0.5x ~ 3x）

3. **控制回放**
   - ⏸️ 暂停：暂停当前回放
   - ⏹️ 停止：停止回放并清理状态

### 编辑操作

1. **编辑步骤名称**
   - 点击步骤编号（如 #1）
   - 输入自定义名称
   - 保存后显示在列表中

2. **修改步骤信息**
   - 点击步骤卡片的「✏️」按钮
   - 可修改：步骤名称、坐标、输入内容、URL
   - 点击保存更新

3. **删除步骤**
   - 点击步骤卡片的「🗑️」按钮
   - 确认删除后步骤重新编号

---

## 🔌 API 说明

### 消息类型

#### 录制相关
| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `startRecording` | sidebar → background | 开始录制 |
| `stopRecording` | sidebar → background | 停止录制 |
| `recordAction` | content → background | 记录操作 |
| `recordingStopped` | background → sidebar | 录制停止通知 |

#### 回放相关
| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `startReplayScript` | sidebar → content | 开始回放 |
| `stopReplayScript` | sidebar → content | 停止回放 |
| `pauseReplayScript` | sidebar → content | 暂停回放 |
| `resumeReplayScript` | sidebar → content | 恢复回放 |
| `replayStepResult` | content → sidebar | 步骤执行结果 |
| `replayStatus` | content → sidebar | 回放状态更新 |

#### UI 更新
| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `actionHistoryUpdated` | background → sidebar | 操作历史更新 |
| `windowInfoUpdated` | content → sidebar | 窗口信息更新 |
| `urlChanged` | background → sidebar | URL 变化通知 |
| `tabSwitched` | background → sidebar | 标签页切换通知 |

### 操作类型

```javascript
// 支持的操作类型
ACTION_TYPES = {
  CLICK: 'click',           // 鼠标点击
  RIGHT_CLICK: 'rightClick', // 右键点击
  DBL_CLICK: 'dblclick',     // 双击
  SCROLL: 'scroll',          // 页面滚动
  RESIZE: 'resize',          // 窗口调整
  FOCUS: 'focus',            // 聚焦输入框
  INPUT: 'input',            // 输入内容
  KEYDOWN: 'keydown',        // 按键操作
  SUBMIT: 'submit',          // 表单提交
  NAVIGATION: 'navigation'   // 页面导航
}
```

### 数据格式

#### 操作步骤格式
```json
{
  "type": "click",
  "x": 100,
  "y": 200,
  "timestamp": "2026-05-10T10:30:00.000Z",
  "target": {
    "tagName": "BUTTON",
    "id": "submitBtn",
    "className": "btn-primary",
    "textContent": "提交",
    "selector": "#submitBtn"
  },
  "stepNumber": 1,
  "stepName": "点击提交按钮"
}
```

#### 导出文件格式
```json
{
  "name": "录制_20260510_103000",
  "description": "测试用例：登录流程",
  "exportTime": "2026-05-10T10:30:00.000Z",
  "totalSteps": 5,
  "steps": [...]
}
```

---

## 🏗️ 技术架构

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        Chrome Extension                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │  Sidebar    │◄──►│ Background  │◄──►│   Content   │     │
│  │   (UI)      │    │  (Service)  │    │   Script    │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Renderer  │    │   Storage   │    │  Recorder   │     │
│  │   ReplayUI  │    │  SessionMgr │    │  Selector   │     │
│  │   LogPanel  │    │  MsgRouter  │    │  Replayer   │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  chrome.storage │
                    │  sessionStorage │
                    └─────────────────┘
```

### 通信流程

```
用户操作 → content.js 监听
    ↓ (chrome.runtime.sendMessage)
background.js 接收并存储
    ↓ (chrome.storage.local)
sidebar.js 显示操作历史
    ↓ (用户导出)
JSON 文件
    ↓ (导入回放)
replay-inject.js 执行
    ↓ (chrome.runtime.sendMessage)
sidebar.js 更新状态
```

### 关键技术

| 技术 | 用途 |
|------|------|
| Chrome Extension MV3 | 扩展框架 |
| Service Worker | 后台服务 |
| SidePanel API | 侧边栏界面 |
| Storage API | 数据持久化 |
| Scripting API | 动态注入脚本 |
| WebNavigation API | 导航事件监听 |
| Session Storage | 跨页面状态保持 |

---

## 🔒 权限说明

| 权限 | 用途 | 必要性 |
|------|------|--------|
| `activeTab` | 获取当前活动标签页 | ✅ 必需 |
| `storage` | 存储录制数据 | ✅ 必需 |
| `downloads` | 导出 JSON 文件 | ✅ 必需 |
| `tabs` | 标签页管理 | ✅ 必需 |
| `sidePanel` | 侧边栏界面 | ✅ 必需 |
| `scripting` | 注入内容脚本 | ✅ 必需 |
| `webNavigation` | 导航事件监听 | ✅ 必需 |
| `unlimitedStorage` | 无限制存储 | ⚠️ 可选 |
| `<all_urls>` | 访问所有网站 | ✅ 必需 |

---

## ❓ 常见问题

### Q1: 点击扩展图标没有反应？
**A**: 确保 Chrome 版本 ≥ 114（支持 SidePanel API）。检查方法：
- 地址栏输入 `chrome://version/` 查看版本
- 如果版本过低，请升级 Chrome

### Q2: 录制后没有显示操作？
**A**: 
1. 确认录制状态显示「录制中」
2. 刷新当前页面重新开始录制
3. 检查控制台是否有错误信息（F12）

### Q3: 回放时点击不到元素？
**A**: 
1. 使用 0.5x 速度回放，增加等待时间
2. 编辑步骤，修改元素选择器
3. 页面可能未完全加载，手动调整延迟

### Q4: 跨页面回放卡住？
**A**: 
1. 点击「停止」按钮清理状态
2. 重新导入文件开始回放
3. 确保录制时正确记录了页面跳转

### Q5: 如何清理所有录制数据？
**A**: 
- 点击侧边栏「🗑️ 清空」按钮
- 或在 Chrome 设置中清除扩展数据

### Q6: 回放速度过快？
**A**: 
- 点击「速度」按钮选择 0.5x
- 或在 JSON 文件中调整步骤延迟

---

## 🛠️ 开发指南

### 本地开发

1. **克隆仓库**
   ```bash
   git clone https://github.com/your-repo/browser-action-recorder.git
   cd browser-action-recorder
   ```

2. **加载扩展**
   - 打开 `chrome://extensions/`
   - 开启开发者模式
   - 加载已解压的扩展程序

3. **调试**
   - 右键扩展图标 → 检查弹出内容（调试 sidebar）
   - 点击 background.js 的「Service Worker」链接
   - 在页面按 F12 调试 content script

### 代码修改指南

#### 添加新的操作类型

1. 在 `content.js` 中添加事件监听
   ```javascript
   document.addEventListener('newevent', function(e) {
     if (!isRecording) return;
     sendAction(buildActionData('newType', e));
   });
   ```

2. 在 `replay-inject.js` 中添加执行方法
   ```javascript
   ActionReplayer.prototype.executeNewType = async function(step) {
     // 模拟操作逻辑
     return true;
   };
   ```

3. 在 `executeStep` 的 switch 中添加分支
   ```javascript
   case 'newType':
     success = await self.executeNewType(step);
     break;
   ```

#### 修改 UI 样式

- 编辑 `sidebar.css` 文件
- 支持热更新：修改后刷新侧边栏即可

#### 修改数据存储

- 录制数据：`chrome.storage.local`
- 临时状态：`sessionStorage`
- 全局设置：`localStorage`

### 构建发布

1. **打包扩展**
   ```bash
   # 选择所有文件，打包为 ZIP
   zip -r extension.zip . -x "*.git*" "*.DS_Store"
   ```

2. **提交到 Chrome 网上应用店**
   - 注册开发者账号（一次性费用 $5）
   - 上传 ZIP 文件
   - 填写商店信息
   - 提交审核（通常 1-3 天）

---

## 📝 更新日志

### v7.0 (2026-05-10)
- 🔄 代码模块化重构
- 🐛 修复跨页面回放状态更新问题
- ✨ 添加全局停止标志，防止误恢复
- 📝 完善日志系统，添加去重功能

### v6.9 (2026-05-09)
- 🐛 修复页面跳转后后续步骤不执行的问题
- ✨ 增加导航超时检测机制
- 🎨 优化回放日志显示

### v6.5 (2026-05-08)
- ✨ 实现跨页面回放自动恢复
- 🐛 修复 Enter 键重复提交问题
- 🎨 改进元素查找策略（支持文本匹配）

### v5.0 (2026-05-01)
- ✨ 添加回放功能
- ✨ 支持回放速度调节
- ✨ 添加执行日志面板

### v4.2 (2026-04-25)
- 🎉 初始版本发布
- ✨ 基础录制功能
- ✨ 侧边栏界面
- ✨ 导入导出功能

---

## 📄 许可证

MIT License

Copyright (c) 2026 Browser Action Recorder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions...

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

## 📧 联系方式

- 项目主页：[GitHub Repository]
- 问题反馈：[Issues]
- 邮箱：support@example.com

---

*最后更新：2026-05-10*
