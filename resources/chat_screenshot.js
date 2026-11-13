/*!
 * MomoTalk · 聊天截图模块  v1.3.0
 * ------------------------------------------------------------------
 * 将聊天数据（第 1.2 节的 box / item 结构）绘制成一张长图。
 * 只依赖浏览器原生 API（Canvas 2D），不引用任何外部库 / CDN。
 *
 * 对外接口（契约第 4 节）：
 *   window.ChatScreenshot.generate(options) -> Promise<{ canvas, width, height }>
 *
 *   options = {
 *     boxes:   [ box, ... ],                     // 盒子数组，按时间正序
 *     student: { name: '未花（泳装）', avatar: '图片URL或dataURL' },
 *     width:   360,                              // 逻辑宽度（CSS px），默认 360
 *     dpr:     2,                                // 输出缩放，默认 2
 *     texts:   { reply: '回复', story: '好感故事', imageFail: '图片加载失败' },
 *     imageProxy: ''                             // 可选：远程图片代理模板，默认关闭
 *   }
 *
 *   imageProxy：部分图片域名（如 static.kivo.wiki、gitee）没有 CORS 响应头，
 *   带 crossOrigin='anonymous' 直连会失败，截图中只能画占位。配置一个会返回
 *   CORS 头的图片代理即可回退：模板中的 {url} 会被替换为经过
 *   encodeURIComponent 的图片绝对地址，例如 'https://wsrv.nl/?url={url}'。
 *   默认 '' 表示不启用；只对远程图片（//、http://、https://）生效，
 *   dataURL / 相对路径等本地图片不走代理。
 *   注意：wsrv.nl 等代理只接受 https 上游，http 源图会被拒绝；模块会在代理
 *   失败后把 http 源地址升级为 https:// 再经同一代理模板重试一次。
 *
 *   emoji（社团表情）与图片消息使用同一套尺寸 / 圆角 / 描边规则：最大
 *   220x300、等比缩放，因此聊天页和截图里的社团表情都按图片大小显示，
 *   不再固定为 84x84。
 *
 *   返回的 width / height 为「逻辑（CSS）尺寸」；canvas.width / canvas.height
 *   为逻辑尺寸 * dpr（设备像素）。canvas 不跨域污染，可直接 toDataURL('image/png')。
 *
 * 其它导出（便于测试）：
 *   ChatScreenshot._wrapText(ctxOrMeasure, text, maxWidth) -> string[]
 *   ChatScreenshot._tokenize(text)                         -> token[]
 *   ChatScreenshot._DEFAULTS / ChatScreenshot._COLORS
 *
 * 说明：模块同时支持 <script> 直接引入（挂到 window）与 CommonJS require（便于 node 单测）。
 */
(function (global) {
  'use strict';

  var VERSION = '1.3.0';

  /* ================================================================
   * 一、常量
   * ================================================================ */

  var FONT_STACK =
    '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

  /** 生成 canvas 字体字符串，例如 font(15, false) -> '15px ...' */
  function font(size, bold) {
    return (bold ? 'bold ' : '') + size + 'px ' + FONT_STACK;
  }

  /** 颜色（契约第 5 节） */
  var COLORS = {
    // 气泡
    studentBubble: '#4C5A6E',
    senseiBubble: '#4B8AC9',
    bubbleText: '#FFFFFF',
    // 名字 / 头像
    name: '#333B47',
    avatarBg: '#DFE7EF',
    avatarText: '#7D8B9A',
    // 背景渐变（白 → 极浅蓝灰）
    bgFrom: '#FFFFFF',
    bgMid: '#F7F9FB',
    bgTo: '#EEF4F8',
    // 回复框（浅蓝）
    replyPanelFrom: '#E2EDF3',
    replyPanelTo: '#E9F1F6',
    replyBorder: '#D3E2EB',
    replyBar: '#4B8AC9',
    replyLabel: '#3E5568',
    replyInnerBg: '#FFFFFF',
    replyInnerBorder: '#E4EBF1',
    replyInnerText: '#55636F',
    // 好感故事框（参考游戏原版：浅粉卡片 + 深灰标签 + 粉色按钮 + 绿色播放箭头）
    storyPanelFrom: '#FFF6F8',
    storyPanelTo: '#FDEBF1',
    storyBorder: '#F8D7E2',
    storyHeart: '#F9CFDC',
    storyBar: '#F06A95',
    storyLabel: '#4A4A4A',
    storyBtn: '#F5749A',
    storyBtnText: '#FFFFFF',
    // 旁白
    narration1Text: '#BFBFBF',
    narration2Bg: '#E9E9E9',
    narration2Text: '#333333',
    // 图片失败占位
    placeholderBg: '#E9EEF3',
    placeholderText: '#9AA7B3',
    imageBorder: 'rgba(0,0,0,0.08)'
  };

  /** 默认排版参数（逻辑 px） */
  var DEFAULTS = {
    width: 360,
    dpr: 2,
    padding: 16,
    // 学生头像
    avatarSize: 40,
    avatarGap: 10,
    // 学生名字
    nameSize: 13,
    nameHeight: 18,
    nameGap: 6,
    // 文本气泡
    fontSize: 15,
    lineHeightRatio: 1.45, // 15 * 1.45 ≈ 22
    bubblePadX: 14,
    bubblePadY: 8,
    bubbleRadius: 14,
    maxBubbleRatio: 0.7,
    // 间距
    itemGap: 6,
    boxGap: 18,
    // 图片 / 表情
    imageMaxWidth: 220,
    imageMaxHeight: 300,
    imageRadius: 12,
    // 回复框 / 好感故事框
    panelMaxRatio: 0.78,
    panelPad: 10,
    panelTitleHeight: 18,
    panelGap: 8,
    innerPadX: 12,
    innerPadY: 11,
    innerRadius: 10,
    storyMaxRatio: 0.72,
    storyLabelHeight: 14,
    storyButtonHeight: 34,
    storyButtonRadius: 6,
    // 旁白
    narration1Size: 12,
    narration2Size: 13,
    narration1LineHeight: 18,
    narration2LineHeight: 20,
    narration1MaxRatio: 0.78,
    narration2MaxRatio: 0.8,
    narrationPadX: 14,
    narrationPadY: 8,
    narrationRadius: 8,
    // 兜底
    minHeight: 120
  };

  /** 文案默认值 */
  var TEXT_DEFAULTS = {
    reply: '回复',
    story: '好感故事',
    imageFail: '图片加载失败'
  };

  /* ================================================================
   * 二、基础工具
   * ================================================================ */

  /** 取有限数字，否则用默认值 */
  function num(value, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) ? n : fallback;
  }

  /** 简易 Object.assign（避免依赖较新 API） */
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) target[key] = src[key];
      }
    }
    return target;
  }

  /** 是否中日韩字符（不含标点归属的复杂规则，够用即可） */
  function isCJK(ch) {
    if (!ch) return false;
    var code = ch.codePointAt ? ch.codePointAt(0) : ch.charCodeAt(0);
    return (
      (code >= 0x2e80 && code <= 0x9fff) || // 部首 / 假名 / 汉字
      (code >= 0xf900 && code <= 0xfaff) || // 兼容汉字
      (code >= 0xfe30 && code <= 0xfe4f) || // 竖排标点
      (code >= 0xff00 && code <= 0xffef) || // 全角字符
      (code >= 0x3000 && code <= 0x303f) || // 中文标点
      (code >= 0x20000 && code <= 0x2fa1f) // 扩展区汉字
    );
  }

  /** 圆角矩形路径 */
  function roundRectPath(ctx, x, y, w, h, r) {
    var radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  /** 取名字首字（兼容 emoji / 代理对） */
  function firstChar(text) {
    var chars = Array.from(String(text == null ? '' : text));
    return chars.length ? chars[0] : '';
  }

  /** 单行文本按宽度截断并加省略号 */
  function ellipsize(ctx, text, maxWidth) {
    var str = String(text == null ? '' : text);
    if (!str) return '';
    if (ctx.measureText(str).width <= maxWidth) return str;
    var chars = Array.from(str);
    var out = '';
    for (var i = 0; i < chars.length; i++) {
      var next = out + chars[i];
      if (ctx.measureText(next + '…').width > maxWidth) break;
      out = next;
    }
    return out ? out + '…' : '';
  }

  /* ================================================================
   * 三、文本换行（纯函数，便于 node 测试）
   * ================================================================ */

  /**
   * 把一段文本切成 token：
   *  - 中文字符 → 单个 token（按字换行）
   *  - 连续的非空白、非中文 → 一个 token（英文按单词换行）
   *  - 空白 → 记录为下一个 token 的 spaceBefore（折叠成一个空格）
   * 返回 [{ text, spaceBefore, cjk }]，不处理 \n（由 wrapText 处理段落）。
   */
  function tokenize(text) {
    var src = String(text == null ? '' : text);
    var tokens = [];
    var buf = '';
    var pendingSpace = false;

    function flushWord() {
      if (buf) {
        tokens.push({ text: buf, spaceBefore: pendingSpace, cjk: false });
        buf = '';
        pendingSpace = false;
      }
    }

    var chars = Array.from(src);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '\n' || ch === '\r') {
        // 段落分隔交给 wrapText，这里当作空白处理
        flushWord();
        pendingSpace = false;
        tokens.push({ text: '\n', spaceBefore: false, cjk: false });
        continue;
      }
      if (/\s/.test(ch)) {
        flushWord();
        pendingSpace = true;
        continue;
      }
      if (isCJK(ch)) {
        flushWord();
        tokens.push({ text: ch, spaceBefore: pendingSpace, cjk: true });
        pendingSpace = false;
        continue;
      }
      buf += ch;
    }
    flushWord();
    return tokens;
  }

  /** 去掉行尾空白 */
  function rtrim(text) {
    return String(text).replace(/\s+$/, '');
  }

  /** 把超宽单词按字符拆成若干段（每段都不超过 maxWidth） */
  function splitToWidth(text, maxWidth, measure) {
    var chars = Array.from(String(text));
    var pieces = [];
    var piece = '';
    for (var i = 0; i < chars.length; i++) {
      var next = piece + chars[i];
      if (piece !== '' && measure(next) > maxWidth) {
        pieces.push(piece);
        piece = chars[i];
      } else {
        piece = next;
      }
    }
    pieces.push(piece);
    return pieces;
  }

  /**
   * 自动换行核心（纯函数）。
   * @param {Function} measure   (str) => 宽度
   * @param {string}   text      原始文本，支持 \n
   * @param {number}   maxWidth  单行最大宽度
   * @returns {string[]} 每行文本（不含空尾行）
   */
  function wrapText(measure, text, maxWidth) {
    var lines = [];
    var limit = maxWidth > 0 ? maxWidth : 1;
    var paragraphs = String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split('\n');

    for (var p = 0; p < paragraphs.length; p++) {
      var tokens = tokenize(paragraphs[p]);
      var cur = '';

      if (!tokens.length) {
        lines.push('');
        continue;
      }

      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        var sep = cur !== '' && tok.spaceBefore ? ' ' : '';
        var candidate = cur + sep + tok.text;

        if (measure(candidate) <= limit) {
          cur = candidate;
          continue;
        }

        // 放不下：先结束当前行
        if (cur !== '') {
          lines.push(rtrim(cur));
          cur = '';
        }

        // token 本身可能比整行还宽 → 按字符拆
        var pieces = splitToWidth(tok.text, limit, measure);
        for (var k = 0; k < pieces.length - 1; k++) {
          lines.push(pieces[k]);
        }
        cur = pieces[pieces.length - 1];
      }

      if (cur !== '') lines.push(rtrim(cur));
    }

    // 去掉末尾空行（避免多出空白高度）
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /**
   * 对外暴露的换行函数（契约提到的 ChatScreenshot._wrapText）。
   * 第一个参数既可以是 CanvasRenderingContext2D（使用其当前 font），
   * 也可以是 (str)=>width 的测量函数（node 测试时可直接传假函数）。
   */
  function wrapTextWithContext(ctxOrMeasure, text, maxWidth) {
    var measure;
    if (typeof ctxOrMeasure === 'function') {
      measure = ctxOrMeasure;
    } else if (ctxOrMeasure && typeof ctxOrMeasure.measureText === 'function') {
      measure = function (str) {
        return ctxOrMeasure.measureText(str).width;
      };
    } else {
      // 最后兜底：粗略按 8px / 字符估算
      measure = function (str) {
        return String(str).length * 8;
      };
    }
    return wrapText(measure, text, maxWidth);
  }

  /* ================================================================
   * 四、配置解析
   * ================================================================ */

  function resolveConfig(options) {
    var width = Math.max(160, Math.round(num(options.width, DEFAULTS.width)));
    var dpr = Math.min(4, Math.max(0.5, num(options.dpr, DEFAULTS.dpr)));

    return {
      width: width,
      dpr: dpr,
      // 可选：远程图片代理模板（含 {url}），默认 '' 表示关闭
      imageProxy: typeof options.imageProxy === 'string' ? options.imageProxy : '',
      padding: DEFAULTS.padding,
      avatarSize: DEFAULTS.avatarSize,
      avatarGap: DEFAULTS.avatarGap,
      nameHeight: DEFAULTS.nameHeight,
      nameGap: DEFAULTS.nameGap,
      fontSize: DEFAULTS.fontSize,
      lineHeight: Math.round(DEFAULTS.fontSize * DEFAULTS.lineHeightRatio),
      bubblePadX: DEFAULTS.bubblePadX,
      bubblePadY: DEFAULTS.bubblePadY,
      bubbleRadius: DEFAULTS.bubbleRadius,
      maxBubbleRatio: DEFAULTS.maxBubbleRatio,
      itemGap: DEFAULTS.itemGap,
      boxGap: DEFAULTS.boxGap,
      imageMaxWidth: DEFAULTS.imageMaxWidth,
      imageMaxHeight: DEFAULTS.imageMaxHeight,
      imageRadius: DEFAULTS.imageRadius,
      panelMaxRatio: DEFAULTS.panelMaxRatio,
      panelPad: DEFAULTS.panelPad,
      panelTitleHeight: DEFAULTS.panelTitleHeight,
      panelGap: DEFAULTS.panelGap,
      innerPadX: DEFAULTS.innerPadX,
      innerPadY: DEFAULTS.innerPadY,
      innerRadius: DEFAULTS.innerRadius,
      storyMaxRatio: DEFAULTS.storyMaxRatio,
      storyLabelHeight: DEFAULTS.storyLabelHeight,
      storyButtonHeight: DEFAULTS.storyButtonHeight,
      storyButtonRadius: DEFAULTS.storyButtonRadius,
      narration1Size: DEFAULTS.narration1Size,
      narration2Size: DEFAULTS.narration2Size,
      narration1LineHeight: DEFAULTS.narration1LineHeight,
      narration2LineHeight: DEFAULTS.narration2LineHeight,
      narration1MaxRatio: DEFAULTS.narration1MaxRatio,
      narration2MaxRatio: DEFAULTS.narration2MaxRatio,
      narrationPadX: DEFAULTS.narrationPadX,
      narrationPadY: DEFAULTS.narrationPadY,
      narrationRadius: DEFAULTS.narrationRadius,
      minHeight: DEFAULTS.minHeight,
      // 预生成字体串，避免每帧拼接
      fontText: font(DEFAULTS.fontSize, false),
      fontName: font(DEFAULTS.nameSize, true),
      fontPanelTitle: font(13, true),
      fontStoryLabel: font(12, true),
      fontStoryBtn: font(13, true),
      fontNarration1: font(DEFAULTS.narration1Size, false),
      fontNarration2: font(DEFAULTS.narration2Size, false),
      fontPlaceholder: font(13, false),
      fontAvatar: font(16, true),
      fontEmojiFail: font(12, false)
    };
  }

  function normalizeStudent(student) {
    var src = student && typeof student === 'object' ? student : {};
    return {
      name: src.name == null ? '' : String(src.name),
      avatar: typeof src.avatar === 'string' ? src.avatar : ''
    };
  }

  /* ================================================================
   * 五、图片加载（带缓存 + 失败回退，永不 reject）
   * ================================================================ */

  var IMAGE_CACHE = Object.create(null);

  /** 单次图片加载超时（ms）：直连与代理各自计时 */
  var IMAGE_TIMEOUT = 15000;

  /** 是否远程 URL（协议相对 //、http://、https://）；dataURL / 相对路径返回 false */
  function isRemoteUrl(src) {
    return src.indexOf('//') === 0 || /^https?:\/\//i.test(src);
  }

  /** 远程地址 → 绝对 URL（协议相对用 location.protocol 补全） */
  function toAbsoluteUrl(src) {
    if (src.indexOf('//') === 0) {
      var protocol =
        typeof location !== 'undefined' && location && location.protocol ? location.protocol : 'https:';
      return protocol + src;
    }
    return src;
  }

  /**
   * http:// 绝对地址 → https://。
   * 部分图片代理（如 wsrv.nl）只接受 https 上游，http 源图会被拒绝（返回 404），
   * 所以代理回退失败后再用 https 源重试一次。
   */
  function upgradeToHttps(url) {
    if (/^http:\/\//i.test(url)) return 'https://' + url.slice(7);
    return '';
  }

  /**
   * 用 crossOrigin='anonymous' + no-referrer 加载单个 URL。
   * 成功且尺寸有效 resolve(img)；失败 / 超时一律 resolve(null)，绝不 reject。
   * 每次调用独立 15s 超时，避免某张图卡住整张长图。
   */
  function loadImageOnce(url) {
    return new Promise(function (resolve) {
      var img;
      var timer = null;
      var settled = false;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (img) {
          img.onload = null;
          img.onerror = null;
        }
        resolve(result);
      }

      try {
        img = new Image();
      } catch (e) {
        resolve(null);
        return;
      }

      img.crossOrigin = 'anonymous';
      // 不发送 referrer：部分图床按 referer 拦截请求
      img.referrerPolicy = 'no-referrer';

      img.onload = function () {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        finish(w && h ? img : null);
      };
      img.onerror = function () {
        finish(null);
      };

      timer = setTimeout(function () {
        finish(null);
      }, IMAGE_TIMEOUT);

      try {
        img.src = url;
      } catch (e) {
        finish(null);
      }
    });
  }

  /**
   * 加载单张图片；失败（含跨域失败）resolve(null)，绝不 reject。
   * crossOrigin='anonymous' 保证 canvas 不被污染：跨域无 CORS 头时浏览器会
   * 直接报加载错误 → 走占位，而不是画出被污染的像素。
   *
   * 若配置了 imageProxy（模板含 {url}），远程图片按下面三段依次尝试：
   *   1. 直连（crossOrigin='anonymous' + no-referrer，15s 超时）；
   *   2. 代理：proxy.replace('{url}', encodeURIComponent(绝对地址))；
   *   3. 若第 2 段失败且源地址是 http://，升级为 https:// 后经同一代理模板再试一次
   *      （兼容 wsrv.nl 等只接受 https 上游的代理）。
   * dataURL / 相对路径等本地资源不代理。
   */
  function loadImage(src, imageProxy) {
    if (!src || typeof src !== 'string') return Promise.resolve(null);
    var proxy = typeof imageProxy === 'string' ? imageProxy : '';
    // 缓存 key 必须带上代理配置，避免启用 / 禁用代理时互相串用结果
    var cacheKey = src + '\n' + proxy;
    if (cacheKey in IMAGE_CACHE) return IMAGE_CACHE[cacheKey];

    /** 第 2 / 3 段共用：把绝对地址编码后套进代理模板再加载 */
    function loadByProxy(url) {
      var proxied = proxy.replace('{url}', encodeURIComponent(url));
      if (!proxied) return Promise.resolve(null);
      return loadImageOnce(proxied);
    }

    var promise = loadImageOnce(src).then(function (img) {
      if (img) return img;
      if (!proxy || !isRemoteUrl(src)) return null;
      var absUrl = toAbsoluteUrl(src);
      return loadByProxy(absUrl).then(function (proxiedImg) {
        if (proxiedImg) return proxiedImg;
        // 第 3 段：http 源图升级 https 后重试（同 URL 不重复请求）
        var httpsUrl = upgradeToHttps(absUrl);
        if (!httpsUrl || httpsUrl === absUrl) return null;
        return loadByProxy(httpsUrl);
      });
    });

    IMAGE_CACHE[cacheKey] = promise;
    return promise;
  }

  /** 收集本次渲染需要的全部图片地址（去重） */
  function collectSources(boxes, studentAvatar) {
    var seen = Object.create(null);
    var list = [];
    function add(src) {
      if (typeof src === 'string' && src && !(src in seen)) {
        seen[src] = true;
        list.push(src);
      }
    }
    add(studentAvatar);
    boxes.forEach(function (box) {
      if (!box || !Array.isArray(box.items)) return;
      box.items.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var type = item.type ? String(item.type).toLowerCase() : '';
        if (type === 'image' || type === 'emoji') add(item.src);
      });
    });
    return list;
  }

  /** 并行加载全部图片 → { [src]: { img, width, height } | null } */
  function loadAll(sources, cfg) {
    var imageProxy = cfg && typeof cfg.imageProxy === 'string' ? cfg.imageProxy : '';
    return Promise.all(
      sources.map(function (src) {
        return loadImage(src, imageProxy);
      })
    ).then(function (images) {
      var map = Object.create(null);
      sources.forEach(function (src, index) {
        var img = images[index];
        map[src] = img ? { img: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height } : null;
      });
      return map;
    });
  }

  /* ================================================================
   * 六、布局测量
   * ================================================================ */

  /** 回复框 / 好感故事框的可用宽度 */
  function panelWidthFor(cfg, role, bodyLeft, right) {
    var available = role === 'sensei' ? right - cfg.padding : right - bodyLeft;
    var wanted = Math.round(cfg.width * cfg.panelMaxRatio);
    return Math.max(80, Math.min(wanted, available));
  }

  /** 文本气泡 */
  function measureText(ctx, item, cfg, role, maxBubbleWidth) {
    var text = item.text == null ? '' : String(item.text);
    ctx.font = cfg.fontText;
    var textAreaWidth = Math.max(20, maxBubbleWidth - cfg.bubblePadX * 2);
    var lines = wrapText(function (s) {
      return ctx.measureText(s).width;
    }, text, textAreaWidth);
    if (!lines.length) lines = [''];

    var widest = 0;
    lines.forEach(function (line) {
      widest = Math.max(widest, ctx.measureText(line).width);
    });

    var width = Math.min(maxBubbleWidth, Math.max(cfg.bubblePadX * 2 + 10, Math.ceil(widest) + cfg.bubblePadX * 2));
    var height = lines.length * cfg.lineHeight + cfg.bubblePadY * 2;
    return {
      kind: 'text',
      w: width,
      h: height,
      lines: lines,
      role: role,
      color: role === 'sensei' ? COLORS.senseiBubble : COLORS.studentBubble
    };
  }

  /** 图片 item（最大 220x300，等比；失败给占位尺寸） */
  function measureImage(item, cfg, imageMap, texts) {
    var entry = item.src ? imageMap[item.src] : null;
    var failed = !entry || !entry.img;
    var width, height;
    if (!failed) {
      var scale = Math.min(cfg.imageMaxWidth / entry.width, cfg.imageMaxHeight / entry.height, 1);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      width = Math.max(1, Math.round(entry.width * scale));
      height = Math.max(1, Math.round(entry.height * scale));
    } else {
      width = cfg.imageMaxWidth;
      height = Math.round(cfg.imageMaxWidth * 0.68);
    }
    return {
      kind: 'image',
      w: width,
      h: height,
      img: failed ? null : entry.img,
      src: item.src,
      text: texts.imageFail
    };
  }

  /** 表情 item：与图片消息同样的尺寸规则（最大 220x300，等比；失败给方形占位） */
  function measureEmoji(item, cfg, imageMap, texts) {
    var entry = item.src ? imageMap[item.src] : null;
    var failed = !entry || !entry.img;
    var width, height;
    if (!failed) {
      var scale = Math.min(cfg.imageMaxWidth / entry.width, cfg.imageMaxHeight / entry.height, 1);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      width = Math.max(1, Math.round(entry.width * scale));
      height = Math.max(1, Math.round(entry.height * scale));
    } else {
      width = cfg.imageMaxWidth;
      height = cfg.imageMaxWidth;
    }
    return {
      kind: 'emoji',
      w: width,
      h: height,
      img: failed ? null : entry.img,
      src: item.src,
      text: texts.imageFail
    };
  }

  /** 回复框 item（浅蓝面板 + 多个白色选项内框） */
  function measureReply(ctx, item, cfg, role, texts, bodyLeft, right) {
    var panelWidth = panelWidthFor(cfg, role, bodyLeft, right);
    var title = texts.reply;
    var innerWidth = panelWidth - cfg.panelPad * 2;
    var rawOptions = Array.isArray(item.options) && item.options.length
      ? item.options
      : [item.text == null ? '' : item.text];
    var options = rawOptions.map(function (t) { return String(t == null ? '' : t); }).filter(function (t) { return t !== ''; });
    if (!options.length) options = [''];

    ctx.font = cfg.fontText;
    var optGap = 6;
    var optNodes = options.map(function (text) {
      var lines = wrapText(function (s) {
        return ctx.measureText(s).width;
      }, text, Math.max(20, innerWidth - cfg.innerPadX * 2));
      if (!lines.length) lines = [''];
      return {
        lines: lines,
        h: lines.length * cfg.lineHeight + cfg.innerPadY * 2
      };
    });

    var innerBlockH = 0;
    optNodes.forEach(function (n, i) {
      innerBlockH += n.h + (i < optNodes.length - 1 ? optGap : 0);
    });
    var innerY = cfg.panelPad + cfg.panelTitleHeight + cfg.panelGap;
    var height = innerY + innerBlockH + cfg.panelPad;

    return {
      kind: 'reply',
      w: panelWidth,
      h: height,
      title: title,
      options: optNodes,
      optGap: optGap,
      rel: {
        innerX: cfg.panelPad,
        innerY: innerY,
        innerW: panelWidth - cfg.panelPad * 2
      }
    };
  }

  /** 好感故事框 item（参考原版：浅粉卡片 + 深灰标签 + 粉色按钮 + 绿色播放箭头） */
  function measureStory(ctx, item, cfg, role, texts) {
    var panelWidth = Math.min(
      Math.round(cfg.width * cfg.storyMaxRatio),
      cfg.width - cfg.padding * 2
    );
    var btnWidth = panelWidth - cfg.panelPad * 2;
    var btnTextWidth = Math.max(20, btnWidth - 24);
    ctx.font = cfg.fontStoryBtn;
    var lines = wrapText(function (s) {
      return ctx.measureText(s).width;
    }, item.text == null ? '' : String(item.text), btnTextWidth);
    if (!lines.length) lines = [''];

    var btnHeight = Math.max(cfg.storyButtonHeight, lines.length * cfg.lineHeight + 14);
    var btnY = cfg.panelPad + cfg.storyLabelHeight + cfg.panelGap;
    var height = btnY + btnHeight + cfg.panelPad;

    return {
      kind: 'story',
      w: panelWidth,
      h: height,
      title: texts.story,
      lines: lines,
      rel: {
        labelY: cfg.panelPad,
        btnX: cfg.panelPad,
        btnY: btnY,
        btnW: btnWidth,
        btnH: btnHeight
      }
    };
  }

  /** 旁白 item：旁白1 居中淡灰小字；旁白2 居中灰底黑字 */
  function measureNarration(ctx, item, cfg, kind) {
    var small = kind === 'narration1';
    ctx.font = small ? cfg.fontNarration1 : cfg.fontNarration2;
    var maxWidth = Math.max(60, Math.round(cfg.width * (small ? cfg.narration1MaxRatio : cfg.narration2MaxRatio)));
    var padX = small ? 10 : cfg.narrationPadX;
    var lineHeight = small ? cfg.narration1LineHeight : cfg.narration2LineHeight;
    var text = item.text == null ? '' : String(item.text);
    var lines = wrapText(function (s) {
      return ctx.measureText(s).width;
    }, text, Math.max(30, maxWidth - padX * 2));
    if (!lines.length) lines = [''];

    var widest = 0;
    lines.forEach(function (line) {
      widest = Math.max(widest, ctx.measureText(line).width);
    });

    var width = Math.min(maxWidth, Math.max(small ? 20 : 44, Math.ceil(widest) + padX * 2));
    var height = small
      ? lines.length * lineHeight + 4
      : lines.length * lineHeight + cfg.narrationPadY * 2;

    return {
      kind: kind,
      w: width,
      h: height,
      lines: lines,
      lineHeight: lineHeight
    };
  }

  /** 测量单个 item，返回待绘制的节点；无法识别返回 null */
  function measureItem(ctx, item, cfg, imageMap, role, texts, maxBubbleWidth, bodyLeft, right) {
    var type = item.type == null ? '' : String(item.type).toLowerCase();
    if (type === 'image') return measureImage(item, cfg, imageMap, texts);
    if (type === 'emoji') return measureEmoji(item, cfg, imageMap, texts);
    if (type === 'reply') return measureReply(ctx, item, cfg, role, texts, bodyLeft, right);
    if (type === 'story') return measureStory(ctx, item, cfg, role, texts);
    if (type === 'narration1' || type === 'narration2') return measureNarration(ctx, item, cfg, type);
    if (type === 'text' || item.text != null) return measureText(ctx, item, cfg, role, maxBubbleWidth);
    return null;
  }

  /**
   * 计算整张图的布局。
   * @returns {{ nodes: Array, height: number }}
   */
  function buildLayout(ctx, boxes, cfg, imageMap, texts, student) {
    var nodes = [];
    var cursor = cfg.padding;
    var bodyLeft = cfg.padding + cfg.avatarSize + cfg.avatarGap;
    var right = cfg.width - cfg.padding;
    var maxBubbleWidth = Math.max(
      60,
      Math.min(Math.round(cfg.width * cfg.maxBubbleRatio), right - bodyLeft)
    );
    var avatarEntry = student.avatar ? imageMap[student.avatar] : null;
    var avatarImg = avatarEntry && avatarEntry.img ? avatarEntry.img : null;

    boxes.forEach(function (box) {
      if (!box || !Array.isArray(box.items)) return;
      var role = box.role === 'sensei' ? 'sensei' : 'student';
      var isStudent = role === 'student';

      var items = box.items.filter(function (item) {
        return item && typeof item === 'object';
      });
      if (!items.length) return;

      // 先测量所有 item
      var measured = [];
      items.forEach(function (item) {
        var node = measureItem(ctx, item, cfg, imageMap, role, texts, maxBubbleWidth, bodyLeft, right);
        if (node) measured.push(node);
      });
      if (!measured.length) return;

      var bodyHeight = 0;
      measured.forEach(function (node, index) {
        bodyHeight += node.h + (index < measured.length - 1 ? cfg.itemGap : 0);
      });
      var headerHeight = isStudent ? cfg.nameHeight + cfg.nameGap : 0;
      var boxHeight = Math.max(headerHeight + bodyHeight, isStudent ? cfg.avatarSize : 0);

      var boxTop = cursor;
      var bodyTop = boxTop + headerHeight;

      // 学生：头像 + 名字（每个盒子只画一次）
      if (isStudent) {
        nodes.push({
          kind: 'avatar',
          x: cfg.padding,
          y: boxTop,
          w: cfg.avatarSize,
          h: cfg.avatarSize,
          img: avatarImg,
          name: student.name
        });
        if (student.name) {
          nodes.push({
            kind: 'name',
            x: bodyLeft,
            y: boxTop,
            w: right - bodyLeft,
            h: cfg.nameHeight,
            text: student.name
          });
        }
      }

      // 依次放置 item
      var itemY = bodyTop;
      measured.forEach(function (node, index) {
        node.y = itemY;
        if (node.kind === 'reply' || node.kind === 'story' ||
            node.kind === 'narration1' || node.kind === 'narration2') {
          // 回复框 / 好感故事框 / 旁白在聊天页与截图里都居中显示
          node.x = Math.max(cfg.padding, Math.round((cfg.width - node.w) / 2));
        } else {
          node.x = isStudent ? bodyLeft : right - node.w;
        }
        node.isFirstItem = index === 0;
        nodes.push(node);
        itemY += node.h + (index < measured.length - 1 ? cfg.itemGap : 0);
      });

      cursor = boxTop + boxHeight + cfg.boxGap;
    });

    var contentHeight = cursor > cfg.padding ? cursor - cfg.boxGap - cfg.padding : 0;
    var height = Math.max(cfg.minHeight, Math.round(cfg.padding * 2 + contentHeight));
    return { nodes: nodes, height: height };
  }

  /* ================================================================
   * 七、绘制
   * ================================================================ */

  /** 白 → 极浅蓝灰背景渐变 */
  function drawBackground(ctx, cfg, height) {
    var gradient = ctx.createLinearGradient(0, 0, cfg.width, height);
    gradient.addColorStop(0, COLORS.bgFrom);
    gradient.addColorStop(0.55, COLORS.bgMid);
    gradient.addColorStop(1, COLORS.bgTo);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cfg.width, height);
  }

  /** 以 cover 方式绘制图片（用于圆形头像） */
  function drawImageCover(ctx, img, dx, dy, dw, dh) {
    var iw = img.naturalWidth || img.width || 0;
    var ih = img.naturalHeight || img.height || 0;
    if (!iw || !ih) return;
    var scale = Math.max(dw / iw, dh / ih);
    var sw = dw / scale;
    var sh = dh / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, dx, dy, dw, dh);
  }

  function drawAvatar(ctx, node, cfg) {
    var size = node.w;
    var cx = node.x + size / 2;
    var cy = node.y + size / 2;
    var radius = size / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();

    if (node.img) {
      ctx.clip();
      drawImageCover(ctx, node.img, node.x, node.y, size, size);
    } else {
      // 头像失败：浅灰圆 + 名字首字
      ctx.fillStyle = COLORS.avatarBg;
      ctx.fill();
      var initial = firstChar(node.name);
      if (initial) {
        ctx.fillStyle = COLORS.avatarText;
        ctx.font = cfg.fontAvatar;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initial, cx, cy + 0.5);
      }
    }
    ctx.restore();
  }

  function drawName(ctx, node, cfg) {
    ctx.font = cfg.fontName;
    ctx.fillStyle = COLORS.name;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var label = ellipsize(ctx, node.text, node.w);
    if (label) ctx.fillText(label, node.x, node.y + node.h / 2);
  }

  function drawTextBubble(ctx, node, cfg) {
    // 信息盒子里的第一条文本气泡带一个小尖角，后续气泡不带（与聊天页样式一致）
    if (node.isFirstItem && node.role) {
      var tailTop = node.y + Math.min(9, Math.max(4, node.h * 0.24));
      ctx.beginPath();
      if (node.role === 'sensei') {
        ctx.moveTo(node.x + node.w, tailTop);
        ctx.lineTo(node.x + node.w + 7, tailTop + 6);
        ctx.lineTo(node.x + node.w, tailTop + 12);
      } else {
        ctx.moveTo(node.x, tailTop);
        ctx.lineTo(node.x - 7, tailTop + 6);
        ctx.lineTo(node.x, tailTop + 12);
      }
      ctx.closePath();
      ctx.fillStyle = node.color;
      ctx.fill();
    }

    roundRectPath(ctx, node.x, node.y, node.w, node.h, cfg.bubbleRadius);
    ctx.fillStyle = node.color;
    ctx.fill();

    ctx.font = cfg.fontText;
    ctx.fillStyle = COLORS.bubbleText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < node.lines.length; i++) {
      ctx.fillText(
        node.lines[i],
        node.x + cfg.bubblePadX,
        node.y + cfg.bubblePadY + cfg.lineHeight / 2 + i * cfg.lineHeight
      );
    }
  }

  /** 图片 / 表情失败时的灰色占位块 */
  function drawPlaceholder(ctx, node, cfg, textFont) {
    roundRectPath(ctx, node.x, node.y, node.w, node.h, Math.min(cfg.imageRadius, 14));
    ctx.fillStyle = COLORS.placeholderBg;
    ctx.fill();
    ctx.font = textFont;
    ctx.fillStyle = COLORS.placeholderText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var label = ellipsize(ctx, node.text, node.w - 16);
    if (label) ctx.fillText(label, node.x + node.w / 2, node.y + node.h / 2);
  }

  function drawImageBubble(ctx, node, cfg) {
    if (!node.img) {
      drawPlaceholder(ctx, node, cfg, cfg.fontPlaceholder);
      return;
    }
    ctx.save();
    roundRectPath(ctx, node.x, node.y, node.w, node.h, cfg.imageRadius);
    ctx.clip();
    ctx.drawImage(node.img, node.x, node.y, node.w, node.h);
    ctx.restore();

    // 细边框，避免浅色图片与浅色背景粘连
    roundRectPath(ctx, node.x, node.y, node.w, node.h, cfg.imageRadius);
    ctx.strokeStyle = COLORS.imageBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 表情气泡：与图片消息统一（同圆角裁剪 + 细描边），尺寸也走图片规则 */
  function drawEmojiBubble(ctx, node, cfg) {
    if (!node.img) {
      drawPlaceholder(ctx, node, cfg, cfg.fontEmojiFail);
      return;
    }
    ctx.save();
    roundRectPath(ctx, node.x, node.y, node.w, node.h, cfg.imageRadius);
    ctx.clip();
    ctx.drawImage(node.img, node.x, node.y, node.w, node.h);
    ctx.restore();

    roundRectPath(ctx, node.x, node.y, node.w, node.h, cfg.imageRadius);
    ctx.strokeStyle = COLORS.imageBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 面板标题：左侧竖条 + 文字 */
  function drawPanelTitle(ctx, node, cfg, barColor, labelColor) {
    var barWidth = 3;
    var barHeight = 14;
    var barX = node.x + cfg.panelPad;
    var barY = node.y + cfg.panelPad + (cfg.panelTitleHeight - barHeight) / 2;

    roundRectPath(ctx, barX, barY, barWidth, barHeight, 1.5);
    ctx.fillStyle = barColor;
    ctx.fill();

    ctx.font = cfg.fontPanelTitle;
    ctx.fillStyle = labelColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // 自定义标题过长时截断，避免溢出面板
    var labelMaxWidth = Math.max(20, node.w - cfg.panelPad * 2 - barWidth - 7);
    var label = ellipsize(ctx, node.title, labelMaxWidth);
    if (label) {
      ctx.fillText(label, barX + barWidth + 7, node.y + cfg.panelPad + cfg.panelTitleHeight / 2);
    }
  }

  /** 面板底部的横向分隔线 */
  function drawPanelDivider(ctx, node, cfg, color) {
    var y = Math.round(node.y + cfg.panelPad + cfg.panelTitleHeight + 2) + 0.5;
    ctx.beginPath();
    ctx.moveTo(node.x + cfg.panelPad, y);
    ctx.lineTo(node.x + node.w - cfg.panelPad, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 回复框：浅蓝渐变面板 + 蓝色竖条标题 + 多个白色选项内框 */
  function drawReplyPanel(ctx, node, cfg) {
    var rel = node.rel;

    var gradient = ctx.createLinearGradient(0, node.y, 0, node.y + node.h);
    gradient.addColorStop(0, COLORS.replyPanelFrom);
    gradient.addColorStop(1, COLORS.replyPanelTo);
    roundRectPath(ctx, node.x, node.y, node.w, node.h, 12);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = COLORS.replyBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    drawPanelTitle(ctx, node, cfg, COLORS.replyBar, COLORS.replyLabel);
    drawPanelDivider(ctx, node, cfg, 'rgba(75,138,201,0.25)');

    var innerX = node.x + rel.innerX;
    var y = node.y + rel.innerY;
    ctx.font = cfg.fontText;
    ctx.fillStyle = COLORS.replyInnerText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (node.options || []).forEach(function (opt, i) {
      roundRectPath(ctx, innerX, y, rel.innerW, opt.h, cfg.innerRadius);
      ctx.fillStyle = COLORS.replyInnerBg;
      ctx.fill();
      ctx.strokeStyle = COLORS.replyInnerBorder;
      ctx.stroke();
      ctx.fillStyle = COLORS.replyInnerText;
      for (var k = 0; k < opt.lines.length; k++) {
        ctx.fillText(
          opt.lines[k],
          innerX + rel.innerW / 2,
          y + cfg.innerPadY + cfg.lineHeight / 2 + k * cfg.lineHeight
        );
      }
      y += opt.h + (i < node.options.length - 1 ? (node.optGap || 6) : 0);
    });
  }

  /** 心形路径（好感故事卡片右上的浅粉心形水印） */
  function heartPath(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h);
    ctx.bezierCurveTo(x - w * 0.18, y + h * 0.62, x + w * 0.02, y + h * 0.1, x + w * 0.27, y + h * 0.12);
    ctx.bezierCurveTo(x + w * 0.43, y + h * 0.13, x + w * 0.5, y + h * 0.24, x + w / 2, y + h * 0.3);
    ctx.bezierCurveTo(x + w * 0.5, y + h * 0.24, x + w * 0.57, y + h * 0.13, x + w * 0.73, y + h * 0.12);
    ctx.bezierCurveTo(x + w * 0.98, y + h * 0.1, x + w * 1.18, y + h * 0.62, x + w / 2, y + h);
    ctx.closePath();
  }

  /** 好感故事框：浅粉卡片 + 浅粉心形水印 + 深灰标签 + 粉色按钮 */
  function drawStoryPanel(ctx, node, cfg) {
    var rel = node.rel;

    // 卡片背景（浅粉渐变）
    var gradient = ctx.createLinearGradient(0, node.y, 0, node.y + node.h);
    gradient.addColorStop(0, COLORS.storyPanelFrom);
    gradient.addColorStop(1, COLORS.storyPanelTo);
    roundRectPath(ctx, node.x, node.y, node.w, node.h, 10);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = COLORS.storyBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 右上角心形水印（超出卡片的部分被裁剪）
    ctx.save();
    roundRectPath(ctx, node.x, node.y, node.w, node.h, 10);
    ctx.clip();
    heartPath(ctx, node.x + node.w - 62, node.y - 20, 100, 92);
    ctx.fillStyle = COLORS.storyHeart;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();

    // 标题：粉色竖条 + 深灰色文字
    var barX = node.x + cfg.panelPad + 2;
    var labelCy = node.y + rel.labelY + cfg.storyLabelHeight / 2;
    roundRectPath(ctx, barX, labelCy - 6, 3, 12, 1.5);
    ctx.fillStyle = COLORS.storyBar;
    ctx.fill();
    ctx.font = cfg.fontStoryLabel;
    ctx.fillStyle = COLORS.storyLabel;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var labelMaxWidth = Math.max(20, node.w - cfg.panelPad * 2 - 14);
    var label = ellipsize(ctx, node.title, labelMaxWidth);
    if (label) ctx.fillText(label, barX + 7, labelCy);

    // 粉色按钮
    var btnX = node.x + rel.btnX;
    var btnY = node.y + rel.btnY;
    roundRectPath(ctx, btnX, btnY, rel.btnW, rel.btnH, cfg.storyButtonRadius);
    ctx.fillStyle = COLORS.storyBtn;
    ctx.fill();

    // 白色按钮文字（居中）
    ctx.font = cfg.fontStoryBtn;
    ctx.fillStyle = COLORS.storyBtnText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var textCenterX = btnX + rel.btnW / 2;
    var offset = ((node.lines.length - 1) * cfg.lineHeight) / 2;
    var centerY = btnY + rel.btnH / 2;
    for (var i = 0; i < node.lines.length; i++) {
      ctx.fillText(node.lines[i], textCenterX, centerY - offset + i * cfg.lineHeight);
    }
  }

  /** 旁白：旁白1 居中淡灰小字 / 旁白2 居中灰底黑字 */
  function drawNarration(ctx, node, cfg) {
    var small = node.kind === 'narration1';
    if (!small) {
      roundRectPath(ctx, node.x, node.y, node.w, node.h, cfg.narrationRadius);
      ctx.fillStyle = COLORS.narration2Bg;
      ctx.fill();
    }
    ctx.font = small ? cfg.fontNarration1 : cfg.fontNarration2;
    ctx.fillStyle = small ? COLORS.narration1Text : COLORS.narration2Text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var startY = node.y + (small ? 2 : cfg.narrationPadY) + node.lineHeight / 2;
    for (var i = 0; i < node.lines.length; i++) {
      ctx.fillText(node.lines[i], node.x + node.w / 2, startY + i * node.lineHeight);
    }
  }

  /** 按节点类型分发绘制 */
  function drawNodes(ctx, nodes, cfg) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      switch (node.kind) {
        case 'avatar':
          drawAvatar(ctx, node, cfg);
          break;
        case 'name':
          drawName(ctx, node, cfg);
          break;
        case 'text':
          drawTextBubble(ctx, node, cfg);
          break;
        case 'image':
          drawImageBubble(ctx, node, cfg);
          break;
        case 'emoji':
          drawEmojiBubble(ctx, node, cfg);
          break;
        case 'reply':
          drawReplyPanel(ctx, node, cfg);
          break;
        case 'story':
          drawStoryPanel(ctx, node, cfg);
          break;
        case 'narration1':
        case 'narration2':
          drawNarration(ctx, node, cfg);
          break;
        default:
          break;
      }
    }
  }

  /* ================================================================
   * 八、对外 API
   * ================================================================ */

  function createCanvas(cfg, height) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cfg.width * cfg.dpr));
    canvas.height = Math.max(1, Math.round(height * cfg.dpr));
    // 页面里直接按逻辑尺寸展示
    canvas.style.width = cfg.width + 'px';
    canvas.style.height = height + 'px';
    return canvas;
  }

  /**
   * 生成聊天长图。
   * @param {Object} options 见文件头注释 / 契约第 4 节
   * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number}>}
   */
  function generate(options) {
    return new Promise(function (resolve, reject) {
      var opts = options && typeof options === 'object' ? options : {};
      var cfg, boxes, student, texts, sources;

      try {
        if (typeof document === 'undefined' || !document.createElement) {
          throw new Error('ChatScreenshot: 当前环境没有 document，无法创建 canvas');
        }
        cfg = resolveConfig(opts);
        boxes = Array.isArray(opts.boxes) ? opts.boxes : [];
        student = normalizeStudent(opts.student);
        texts = assign({}, TEXT_DEFAULTS, opts.texts && typeof opts.texts === 'object' ? opts.texts : {});
        sources = collectSources(boxes, student.avatar);
      } catch (error) {
        reject(error);
        return;
      }

      // 先把图片全部加载完（失败会得到 null），再测量与绘制
      loadAll(sources, cfg).then(
        function (imageMap) {
          try {
            var measureCanvas = document.createElement('canvas');
            measureCanvas.width = 1;
            measureCanvas.height = 1;
            var mctx = measureCanvas.getContext('2d');
            if (!mctx) throw new Error('ChatScreenshot: 无法创建 2D 测量上下文');

            var layout = buildLayout(mctx, boxes, cfg, imageMap, texts, student);
            var canvas = createCanvas(cfg, layout.height);
            var ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('ChatScreenshot: 无法创建 2D 绘图上下文');

            ctx.save();
            ctx.scale(cfg.dpr, cfg.dpr);
            drawBackground(ctx, cfg, layout.height);
            drawNodes(ctx, layout.nodes, cfg);
            ctx.restore();

            resolve({ canvas: canvas, width: cfg.width, height: layout.height });
          } catch (error) {
            reject(error);
          }
        },
        function (error) {
          reject(error);
        }
      );
    });
  }

  var ChatScreenshot = {
    version: VERSION,
    generate: generate,
    // ---- 纯函数 / 常量导出，便于测试 ----
    _wrapText: wrapTextWithContext,
    _tokenize: tokenize,
    _ellipsize: ellipsize,
    _DEFAULTS: DEFAULTS,
    _COLORS: COLORS,
    _TEXT_DEFAULTS: TEXT_DEFAULTS
  };

  if (typeof window !== 'undefined') {
    window.ChatScreenshot = ChatScreenshot;
  }
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = ChatScreenshot;
  }
  // 兜底：非浏览器环境也可取到（例如某些测试沙箱）
  if (global && typeof global === 'object') {
    global.ChatScreenshot = ChatScreenshot;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {});
