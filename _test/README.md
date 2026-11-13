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
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1 -Scenario merge,playback-reply,screenshot-fallback
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1 -Scenario multi-session,split,clear-data,favicon
powershell -NoProfile -ExecutionPolicy Bypass -File .\_test\run.ps1 -Scenario more,narration,screenshot

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
| `multi-session` | 新数据模型（`{id:chatId, studentId, unread, addedAt}`，chatId=`时间戳_studentId`）：picker 连点同一学生两次得到两个独立会话、picker 已添加状态「＋ 再添加一个」、chats 以 chatId 为 key、列表 2 个 `.contact-item[data-id=chatId]` 名称不带编号且含淡灰 `.contact-dates`（创建/修改）、两会话消息互不串、localStorage 新模型、`buildExportData` version=5 且 myStudents 含 studentId |
| `box-edit` | 长按（550ms）打开盒子编辑：删除某条消息、追加信息、更换发送者、上移/下移、删除信息盒子、单击不误触、图片消息只能删除 |
| `merge` | 长按编辑面板「与上一个信息盒子合并」：第 1 个盒子按钮 disabled、上一个盒子发送者不同时 disabled + title、同角色相邻盒子合并后盒子数 -1 / items 按顺序拼接 / localStorage 同步 / 面板重开在合并后的盒子上（共 N 条信息）+ toast |
| `split` | 长按编辑面板多选（`.box-edit-row .box-edit-check[data-index]`）+「独立为一个信息盒子」：未勾选时 disabled，勾选第 1、3 条后原盒剩 1 条 / 新盒 2 条（顺序保持）/ 新盒插在原盒之后 / role 相同 / time=now / localStorage 与 DOM 同步；全选时原盒被移除、新盒取代原位置且不留空盒 |
| `more` | + 按钮打开更多栏与 45° 旋转、输入区上移、**6 个入口（表情/图片/回复/好感故事/旁白1/旁白2）**、183 个表情、点击表情发送、**社团表情放大到与图片消息同宽（220px 白框、5px 内边距、12px 圆角、同阴影，正方形）**、本地图片 input 与压缩 dataURL 发送、**回复框编辑器默认只有 1 个空输入框（不再预填「嗯？还好吧……」），「＋ 添加选项」最多 6 个，保存至少 1 个非空**、非播放模式点击回复选项仅提示「回复框只能在播放模式中选择」（数据/DOM 不变，不写回 localStorage）、**好感故事框按游戏原版重绘断言（.story-heart / .story-btn-text 存在且 .story-play 绿色箭头不存在、label rgb(74,74,74)、bar rgb(240,106,149)、粉色按钮 rgb(245,116,154) 白字 + padding 12px 且文字水平居中、面板渐变 255,246,248→253,235,241、宽约 250px、card-box 居中）**、长按好感故事不可编辑、点击聊天区关闭更多栏 |
| `narration` | 旁白1/旁白2：6 个 more 入口与 label 文案、老师/学生身份下均不被禁用（学生身份只有 reply/story 置灰）；点击打开「发送旁白N」编辑器（空 textarea / placeholder / hint），发送后 role=sensei、item type=narration1/2、text 与 localStorage 同步；DOM `.narration.narration1`（居中 rgb(191,191,191)/12px/无气泡背景）与 `.narration.narration2`（居中灰底 rgb(233,233,233)/黑字 rgb(51,51,51)/圆角 8px/按内容收缩居中），旁白盒 card-box 且无头像/名字；长按旁白盒可编辑（旁白行有「编辑」，保存后 text 更新、type 不变、列表预览/localStorage 同步）；播放时旁白直接出现无打字动画、回复选择后盒内仍有旁白保持 card-box、播放结束真实数据不变；截图 `ChatScreenshot._COLORS` 新键与新值（无 storyPlay 键）、story+旁白 canvas 的粉色按钮（无箭头）/灰色旁白2底块/旁白文字像素下限，且绿色箭头像素=0 |
| `playback` | 播放条、`.typing-box` + 3 个 `.typing-dot`、深色打字气泡、动画时长=animationTime(1000ms)、自动结束恢复、停止按钮、滑杆改 1500ms 后动画/预览/持久化同步 |
| `playback-reply` | 播放到回复框：进度文案「请选择一个回复以继续」+ 播放视图渲染选项；点击后播放视图出现所选文本气泡；**不写回真实 chats / localStorage（仍是 reply）**；播放结束后 DOM 恢复 `.reply-panel`、options 与播放前一致、localStorage 未变 |
| `screenshot` | `ChatScreenshot.generate` 返回 canvas（360×dpr2=720）、canvas.toDataURL 可用、**截图里社团表情与图片消息使用同一尺寸规则（同样大小的 canvas 高度）且逻辑高度 >=250px**、点击截图出现 `#screenshot-preview-img` 预览、保存按钮下载 `momotalk_chat_YYYYMMDD_HHmmss.png` |
| `screenshot-fallback` | 远程图片 CORS 代理回退（不依赖外网）：页面源 `127.0.0.1` 直连 `localhost` 同端口头像必失败（对照组画占位底色 #DFE7EF）；传 `imageProxy` 模板（`{url}` 占位替换成编码后的远程地址）后先直连失败再走代理，`getImageData` 采样头像中心 (72,72) 不是占位底色、头像区域占位像素占比 <20%、canvas 未被污染 |
| `backup` | 自动备份默认 false、开关持久化、关闭时退出聊天不下载、开启后 closeChat 下载 `momotalk_autobackup_YYYYMMDD_HHmmss.json`（version 5 完整数据、myStudents 含 studentId）、关闭后不再下载 |
| `details` | 更多子栏目隐藏 `.bottom-nav`、返回/切页恢复、更多子页右滑返回、更多主页右滑回列表、聊天页右滑退出、下拉刷新指示器与重新 loadLibrary、popIn/panelIn/pageIn 动画与 slide-in 过渡 |
| `clear-data` | 通用设置底部 `#btn-clear-local-data`「删除本地数据」：computed color=rgb(216,92,118)、点击弹确认框（含「删除本地数据」「不可恢复」）、取消不清除、确认后 `mm_test_*` / `momotalk_*` 全部清空并触发 `location.reload`（reload 前后都不断言应用 DOM） |
| `favicon` | `resources/running_datas.json` 的 `app.favicon` 指向 `./resources/MomoTalk_favicon.png`、`index.html` 静态 `<link id="favicon">` 初始 href 一致、applyFavicons 后 `<link>` href 指向该 PNG、PNG 尺寸 192×192 且四角 alpha=0、非全透明、响应为 PNG 签名 |
| `migration` | 只预置 legacyChatsKey（旧扁平 `[{role,text,time}]`）与旧格式 myStudents：新 chatsKey 被写入、连续同角色合并为信息盒子、旧 key 保留、旧 myStudents 自动迁移为新模型（id=chatId='1001'、studentId=1001）、`chats['1001']` 继续可用、DOM 渲染一致 |
| `import-export` | 导入 v4 旧备份（numeric id + 盒子结构）按 chatId 对齐并入、v5 备份导入、同一次导入内重复 chatId 去重、重复导入按签名去重；导出 version=5、myStudents 含 studentId、chats 以 chatId 为 key 且每盒含 items |

## 工作原理

`test-harness.html`：

1. `fetch('/index.html')` 取应用 HTML；
2. 在 `</head>` 前注入 prelude `<script>`：覆盖 iframe 内 `window.fetch`，把 `running_datas.json` / `students.json` 按 URL 后缀重写到 `_test/fixtures/`，并记录 fetch/confirm/error 供断言；
3. iframe 打开同源的真实 URL `test-harness.html?frame=1`（这样应用里的 `new URL(..., location.href)` 与相对资源仍以站点根为基准），再由该页面把改写后的 HTML `document.write` 进去；
4. 按 `?scenario=` 预置独立测试 storage（`mm_test_*`）后等待应用就绪，执行断言；
5. 把所有断言（pass/fail + 实际值 + 快照）以 JSON 写到 `<pre id="result">`，完成时置 `window.__testDone = true`；`?shot=1` 时隐藏结果区、iframe 铺满 390×844 视口。

> 测试专用补丁：应用就绪后 harness 会注入一段只用于测试的 `<style>`，关闭 `.round-btn svg` / `#more-panel`（输入区更多栏）的 **CSS transition**。原因是 `--virtual-time-budget` 会快进 timer 但不驱动合成器，transition 的中间/起始值会被读到；keyframe 动画（打字动画、popIn、pageIn）不受影响。
>
> 真实配置补丁（favicon）：`_test/fixtures/running_datas.json` 的 `app.favicon` 仍停在旧值，而 `/resources/*` 属于应用源码、不在 harness 维护范围。harness 会额外 fetch 真实 `resources/running_datas.json`，只把其中的 `app.favicon` 注入 iframe 内配置（`configPatch`），再由应用 `applyFavicons` 应用；其余 app/storage 配置仍用 fixture，保持测试隔离。

`run.ps1` 用无头 Chrome（`--headless=new --no-sandbox --disable-gpu --user-data-dir=临时目录 --virtual-time-budget=20000`）+ `--dump-dom` 抓取 DOM、解析 `<pre id="result">` 的 JSON 并汇总；Chrome 用 `Start-Process -RedirectStandardOutput/-RedirectStandardError` 启动（不使用命名管道）。

## 已知环境限制

在 DSH 受限沙箱内 Chrome 无法启动（`FATAL:platform_channel.cc(83) ... 拒绝访问 (0x5)`：沙箱禁止命名管道，即使 `--single-process` 也一样），此时 `run.ps1` 会打印该诊断并返回退出码 1。请在**不受该限制的外层环境**（普通 PowerShell / CI / 用户本机）运行本脚本；harness 与断言本身不受影响。

若在 DSH 工具会话中运行，`_test/serve.js` 会在 Chrome 断开连接（dump-dom 结束时 abort）时偶发退出，表现为某个场景的 `<scenario>.dom.html` 变成 Chrome 的 `127.0.0.1` 错误页 / `result.json` 缺失（或应用渲染「无法读取配置文件」）。`run.ps1` 已内置自愈：每个场景前检查服务器、退出则自动重启；若某场景因此出现基础设施失败（结果缺失 / Chrome 错误页 / 配置读取失败 / 只有 harness error），会自动重启服务器并重试该场景（`-Retries` 默认 2；断言失败不会重试）；node 版服务器反复退出时会自动切换为 `python -m http.server` 兜底。汇总最后一行会打印中途重启次数。仍建议先用独立进程启动服务器并 `-BaseUrl` 复用。

## 最近一次全量结果（2026-11-13，19 场景 / 442 checks，0 fail）

qa-harness 与 Lead 各独立执行一次 `run.ps1`：均为 **19 场景 / 442 checks，0 fail**（好感故事绿色箭头移除后：`more` 61 checks、`narration` 54 checks，其余场景不变）。产物在 `_test\last-run\`；界面截图由 Lead 更新（`preview-more/story/screenshot/reply-editor` 等），qa-harness 本轮未跑 `-Shot`：

| scenario | checks | 结果 |
| --- | --- | --- |
| boot | 5 | PASS |
| render | 27 | PASS |
| send-append | 24 | PASS |
| multi-session | 26 | PASS |
| box-edit | 30 | PASS |
| merge | 21 | PASS |
| split | 23 | PASS |
| more | 61 | PASS |
| narration | 54 | PASS |
| playback | 25 | PASS |
| playback-reply | 17 | PASS |
| screenshot | 18 | PASS |
| screenshot-fallback | 11 | PASS |
| backup | 16 | PASS |
| details | 23 | PASS |
| clear-data | 17 | PASS |
| favicon | 10 | PASS |
| migration | 15 | PASS |
| import-export | 19 | PASS |

> 本轮（2026-11-13 傍晚）变化：新增 `narration` 场景覆盖「旁白1/旁白2」入口（6 个 more tile、老师/学生身份均可用）、发送编辑器（空 textarea/placeholder/hint → role=sensei、item type=narration1/2、localStorage/DOM 同步）、旁白样式（`.narration1` 居中 rgb(191,191,191)/12px/无气泡；`.narration2` 居中灰底 rgb(233,233,233)/黑字 rgb(51,51,51)/圆角 8px/按内容收缩居中）、长按编辑（类型不变、预览/localStorage 同步）、播放（无打字动画直接出现、回复选择后盒内仍有旁白保持 card-box、结束后真实数据不变）、截图 `ChatScreenshot._COLORS` 新键与新值及 story+旁白 canvas 的粉色按钮/灰色旁白2/旁白文字像素下限（绿色箭头像素=0）；`more` 场景同步改为「6 个入口 + 回复框编辑器默认 1 个空输入（不再预填默认文案，最多 6 个）+ 好感故事原版重绘 DOM 断言（含无箭头 / 按钮 padding 12px 文字居中）」。
>
> 2026-11-13 更晚的调整：好感故事按钮的绿色播放箭头已移除——harness 同步删除 `.story-play` 存在断言与截图绿色箭头像素下限，改为「`.story-play` 不存在 + 截图绿色像素=0」，`_COLORS` 断言去掉 `storyPlay/storyPlayOutline`。
>
> 更早一轮（同日）新增 `multi-session` / `split` / `clear-data` / `favicon` 四个场景，并把 `migration`、`backup`、`import-export` 升级到新数据模型（chatId/studentId、导出 version=5、重复 chatId 去重）；`merge`/`playback-reply`/`screenshot-fallback` 及 `more` 回复框改写继续保留。

## 测试夹具

- `_test/fixtures/running_datas.json`：storage 使用独立键 `mm_test_my_students` / `mm_test_chats` / `mm_test_chats_legacy` / `mm_test_settings`，`app.studentsUrl` 指向 `_test/fixtures/students.json`。
- `_test/fixtures/students.json`：3 个学生（1001 小鸟游星野、1002 圣园未花含泳装皮肤 → 100200、1003 阿慈谷日富美），头像使用本地 `./resources/head.jpg`。

## 其它产物

- `_test/shots/preview-*.png`：390×844 的手机视口最终界面截图（聊天/更多栏/表情面板/盒子编辑/学生设置/通用设置/回复框/好感故事/长图预览/播放打字动画），可人工比对视觉。
- `_test/backup-original/`：改造前的原始 `index.html`、`resources/momotalk.css`、`resources/running_datas.json` 备份，如需回退可直接覆盖回去（旧数据 localStorage 仍兼容）。
