# MomoTalk 自动化验收 harness（_test）

> 只用于测试，不修改应用源码（`index.html` / `resources/*.css` / `resources/*.json` 均由 Lead 维护）。

## 快速开始

前提：本地静态服务根目录必须是 `MomoTalk`（默认 `http://127.0.0.1:8765`）；没有服务时 `run.ps1` 会自动用 Node 起 `_test/serve.js`。

```powershell
cd C:\Users\Administrator\Desktop\code\MomoTalk

# 全部场景
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1

# 单个 / 多个场景
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1 -Scenario render
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1 -Scenario render,box-edit,playback

# 截图模式（每个场景一张，保存到 _test\shots\）
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1 -Shot
```

也可以直接双击/运行 `_test\run.cmd`（等价包装）。

运行产物：`_test\last-run\<scenario>.result.json`（断言 JSON）、`<scenario>.dom.html`（dump-dom）、`<scenario>.chrome.stderr.txt`。
退出码：0 = 全部通过，1 = 有 fail / Chrome 执行失败，2 = 环境问题（服务器 / Chrome 不存在）。

## 场景列表

| scenario | 覆盖内容 |
| --- | --- |
| `boot` | harness 自身框架：iframe 加载应用、fetch 改写、联系人列表渲染、`window.__mm` 钩子 |
| `render` | 老师盒子无头像/无名字、学生盒子头像+名字只显示一次、气泡颜色/圆角/内边距/字号行高、盒子间距 18px、气泡间距 6px、聊天背景渐变 |
| `send-append` | 发送新建盒子、同身份追加进上一个盒子、身份不一致弹窗（新建盒子/改身份并追加）、输入框清空、localStorage 持久化 |
| `box-edit` | 长按（550ms）打开盒子编辑：删除某条消息、追加信息、更换发送者、上移/下移、删除信息盒子、单击不误触、图片消息只能删除 |
| `more` | + 按钮打开更多栏与 45° 旋转、输入区上移、183 个表情、点击表情发送、本地图片 input 与压缩 dataURL 发送、回复框多选项编辑与点击选项输出、好感故事固定文案直接发送、长按好感故事不可编辑、点击聊天区关闭更多栏 |
| `playback` | 播放条、`.typing-box` + 3 个 `.typing-dot`、深色打字气泡、动画时长=animationTime(1000ms)、自动结束恢复、停止按钮、滑杆改 1500ms 后动画/预览/持久化同步 |
| `screenshot` | `ChatScreenshot.generate` 返回 canvas（360×dpr2=720）、canvas.toDataURL 可用、点击截图出现 `#screenshot-preview-img` 预览、保存按钮下载 `momotalk_chat_YYYYMMDD_HHmmss.png` |
| `backup` | 自动备份默认 false、开关持久化、关闭时退出聊天不下载、开启后 closeChat 下载 `momotalk_autobackup_YYYYMMDD_HHmmss.json`（version 4 完整数据）、关闭后不再下载 |
| `details` | 更多子栏目隐藏 `.bottom-nav`、返回/切页恢复、更多子页右滑返回、更多主页右滑回列表、聊天页右滑退出、下拉刷新指示器与重新 loadLibrary、popIn/panelIn/pageIn 动画与 slide-in 过渡 |
| `migration` | 只预置 legacyChatsKey（旧扁平 `[{role,text,time}]`）启动：新 chatsKey 被写入、连续同角色合并为信息盒子、旧 key 保留、DOM 渲染一致 |
| `import-export` | 导入 v3 旧格式（扁平 chats + myStudents）：合并为学生/会话、扁平消息转盒子、重复导入按签名去重、导出数据 version=4 且 chats 为盒子数组 |

## 工作原理

`test-harness.html`：

1. `fetch('/index.html')` 取应用 HTML；
2. 在 `</head>` 前注入 prelude `<script>`：覆盖 iframe 内 `window.fetch`，把 `running_datas.json` / `students.json` 按 URL 后缀重写到 `_test/fixtures/`，并记录 fetch/confirm/error 供断言；
3. iframe 打开同源的真实 URL `test-harness.html?frame=1`（这样应用里的 `new URL(..., location.href)` 与相对资源仍以站点根为基准），再由该页面把改写后的 HTML `document.write` 进去；
4. 按 `?scenario=` 预置独立测试 storage（`mm_test_*`）后等待应用就绪，执行断言；
5. 把所有断言（pass/fail + 实际值 + 快照）以 JSON 写到 `<pre id="result">`，完成时置 `window.__testDone = true`；`?shot=1` 时隐藏结果区、iframe 铺满 390×844 视口。

> 测试专用补丁：应用就绪后 harness 会注入一段只用于测试的 `<style>`，关闭 `.round-btn svg` / `#more-panel`（输入区更多栏）的 **CSS transition**。原因是 `--virtual-time-budget` 会快进 timer 但不驱动合成器，transition 的中间/起始值会被读到；keyframe 动画（打字动画、popIn、pageIn）不受影响。

`run.ps1` 用无头 Chrome（`--headless=new --no-sandbox --disable-gpu --user-data-dir=临时目录 --virtual-time-budget=20000`）+ `--dump-dom` 抓取 DOM、解析 `<pre id="result">` 的 JSON 并汇总；Chrome 用 `Start-Process -RedirectStandardOutput/-RedirectStandardError` 启动（不使用命名管道）。

## 已知环境限制

在 DSH 受限沙箱内 Chrome 无法启动（`FATAL:platform_channel.cc(83) ... 拒绝访问 (0x5)`：沙箱禁止命名管道，即使 `--single-process` 也一样），此时 `run.ps1` 会打印该诊断并返回退出码 1。请在**不受该限制的外层环境**（普通 PowerShell / CI / 用户本机）运行本脚本；harness 与断言本身不受影响。

## 最近一次全量结果（应用 final，2026-11-08 13:06–13:08）

由 Lead 以可启动 Chrome 的外层权限执行 `run.ps1`（11 场景 / 230 checks，**0 fail**），产物在 `_test\last-run\`，界面截图在 `_test\shots\preview-*.png`：

| scenario | checks | 结果 |
| --- | --- | --- |
| boot | 5 | PASS |
| render | 27 | PASS |
| send-append | 24 | PASS |
| box-edit | 30 | PASS |
| more | 39 | PASS |
| playback | 25 | PASS |
| screenshot | 15 | PASS |
| backup | 16 | PASS |
| details | 23 | PASS |
| migration | 12 | PASS |
| import-export | 14 | PASS |

## 测试夹具

- `_test/fixtures/running_datas.json`：storage 使用独立键 `mm_test_my_students` / `mm_test_chats` / `mm_test_chats_legacy` / `mm_test_settings`，`app.studentsUrl` 指向 `_test/fixtures/students.json`。
- `_test/fixtures/students.json`：3 个学生（1001 小鸟游星野、1002 圣园未花含泳装皮肤 → 100200、1003 阿慈谷日富美），头像使用本地 `./resources/head.jpg`。

## 其它产物

- `_test/shots/preview-*.png`：390×844 的手机视口最终界面截图（聊天/更多栏/表情面板/盒子编辑/学生设置/通用设置/回复框/好感故事/长图预览/播放打字动画），可人工比对视觉。
- `_test/backup-original/`：改造前的原始 `index.html`、`resources/momotalk.css`、`resources/running_datas.json` 备份，如需回退可直接覆盖回去（旧数据 localStorage 仍兼容）。
