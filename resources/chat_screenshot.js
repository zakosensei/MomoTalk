/*!
 * MomoTalk · 聊天截图模块  v1.0.0
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
 *     texts:   { reply: '回复', story: '好感故事', imageFail: '图片加载失败' }
 *   }
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

  var VERSION = '1.0.0';

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
    // 好感故事框（粉色）
    storyPanelFrom: '#FFECF2',
    storyPanelTo: '#FFE3EA',
    storyBorder: '#FFD9E3',
    storyBar: '#EE8FA4',
    storyLabel: '#7C5862',
    storyBtnFrom: '#F4A3B1',
    storyBtnTo: '#E8899C',
    storyBtnText: '#FFFFFF',
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
    emojiSize: 84,
    // 回复框 / 好感故事框
    panelMaxRatio: 0.78,
    panelPad: 10,
    panelTitleHeight: 18,
    panelGap: 8,
    innerPadX: 12,
    innerPadY: 11,
    innerRadius: 10,
    storyButtonHeight: 38,
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
      emojiSize: DEFAULTS.emojiSize,
      panelMaxRatio: DEFAULTS.panelMaxRatio,
      panelPad: DEFAULTS.panelPad,
      panelTitleHeight: DEFAULTS.panelTitleHeight,
      panelGap: DEFAULTS.panelGap,
      innerPadX: DEFAULTS.innerPadX,
      innerPadY: DEFAULTS.innerPadY,
      innerRadius: DEFAULTS.innerRadius,
      storyButtonHeight: DEFAULTS.storyButtonHeight,
      minHeight: DEFAULTS.minHeight,
      // 预生成字体串，避免每帧拼接
      fontText: font(DEFAULTS.fontSize, false),
      fontName: font(DEFAULTS.nameSize, true),
      fontPanelTitle: font(13, true),
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

  /**
   * 加载单张图片；失败（含跨域失败）resolve(null)，绝不 reject。
   * crossOrigin='anonymous' 保证 canvas 不被污染：跨域无 CORS 头时浏览器会
   * 直接报加载错误 → 走占位，而不是画出被污染的像素。
   */
  function loadImage(src) {
    if (!src || typeof src !== 'string') return Promise.resolve(null);
    if (src in IMAGE_CACHE) return IMAGE_CACHE[src];

    var promise = new Promise(function (resolve) {
      var img;
      try {
        img = new Image();
      } catch (e) {
        resolve(null);
        return;
      }
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var w = img.naturalWidth || img.width || 0;
        var h = img.naturalHeight || img.height || 0;
        resolve(w && h ? img : null);
      };
      img.onerror = function () {
        resolve(null);
      };
      try {
        img.src = src;
      } catch (e) {
        resolve(null);
      }
    });

    IMAGE_CACHE[src] = promise;
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
  function loadAll(sources) {
    return Promise.all(
      sources.map(function (src) {
        return loadImage(src);
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

  /** 表情 item（固定 84x84） */
  function measureEmoji(item, cfg, imageMap, texts) {
    var entry = item.src ? imageMap[item.src] : null;
    return {
      kind: 'emoji',
      w: cfg.emojiSize,
      h: cfg.emojiSize,
      img: entry && entry.img ? entry.img : null,
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

  /** 好感故事框 item（粉色面板 + 渐变按钮，标题固定） */
  function measureStory(ctx, item, cfg, role, texts, bodyLeft, right) {
    var panelWidth = panelWidthFor(cfg, role, bodyLeft, right);
    var title = texts.story;
    var btnWidth = panelWidth - cfg.panelPad * 2;
    var btnTextWidth = Math.max(20, btnWidth - 24);
    ctx.font = cfg.fontText;
    var lines = wrapText(function (s) {
      return ctx.measureText(s).width;
    }, item.text == null ? '' : String(item.text), btnTextWidth);
    if (!lines.length) lines = [''];

    var btnHeight = Math.max(cfg.storyButtonHeight, lines.length * cfg.lineHeight + 20);
    var btnY = cfg.panelPad + cfg.panelTitleHeight + cfg.panelGap;
    var height = btnY + btnHeight + cfg.panelPad;

    return {
      kind: 'story',
      w: panelWidth,
      h: height,
      title: title,
      lines: lines,
      rel: { btnX: cfg.panelPad, btnY: btnY, btnW: btnWidth, btnH: btnHeight }
    };
  }

  /** 测量单个 item，返回待绘制的节点；无法识别返回 null */
  function measureItem(ctx, item, cfg, imageMap, role, texts, maxBubbleWidth, bodyLeft, right) {
    var type = item.type == null ? '' : String(item.type).toLowerCase();
    if (type === 'image') return measureImage(item, cfg, imageMap, texts);
    if (type === 'emoji') return measureEmoji(item, cfg, imageMap, texts);
    if (type === 'reply') return measureReply(ctx, item, cfg, role, texts, bodyLeft, right);
    if (type === 'story') return measureStory(ctx, item, cfg, role, texts, bodyLeft, right);
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
        if (node.kind === 'reply' || node.kind === 'story') {
          // 回复框 / 好感故事框在聊天页与截图里都居中显示
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

  /** 以 contain 方式绘制图片（用于表情，保持比例、居中） */
  function drawImageContain(ctx, img, x, y, w, h) {
    var iw = img.naturalWidth || img.width || 0;
    var ih = img.naturalHeight || img.height || 0;
    if (!iw || !ih) return;
    var scale = Math.min(w / iw, h / ih);
    var dw = iw * scale;
    var dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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

  function drawEmojiBubble(ctx, node, cfg) {
    if (!node.img) {
      drawPlaceholder(ctx, node, cfg, cfg.fontEmojiFail);
      return;
    }
    drawImageContain(ctx, node.img, node.x, node.y, node.w, node.h);
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

  /** 好感故事框：粉色渐变面板 + 粉色竖条标题 + 粉红渐变按钮 */
  function drawStoryPanel(ctx, node, cfg) {
    var rel = node.rel;

    var gradient = ctx.createLinearGradient(0, node.y, 0, node.y + node.h);
    gradient.addColorStop(0, COLORS.storyPanelFrom);
    gradient.addColorStop(1, COLORS.storyPanelTo);
    roundRectPath(ctx, node.x, node.y, node.w, node.h, 12);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = COLORS.storyBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    drawPanelTitle(ctx, node, cfg, COLORS.storyBar, COLORS.storyLabel);
    drawPanelDivider(ctx, node, cfg, 'rgba(238,143,164,0.3)');

    // 渐变按钮
    var btnX = node.x + rel.btnX;
    var btnY = node.y + rel.btnY;
    var btnGradient = ctx.createLinearGradient(0, btnY, 0, btnY + rel.btnH);
    btnGradient.addColorStop(0, COLORS.storyBtnFrom);
    btnGradient.addColorStop(1, COLORS.storyBtnTo);
    roundRectPath(ctx, btnX, btnY, rel.btnW, rel.btnH, 8);
    ctx.fillStyle = btnGradient;
    ctx.fill();

    ctx.font = cfg.fontText;
    ctx.fillStyle = COLORS.storyBtnText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var centerY = btnY + rel.btnH / 2;
    var offset = ((node.lines.length - 1) * cfg.lineHeight) / 2;
    for (var i = 0; i < node.lines.length; i++) {
      ctx.fillText(node.lines[i], btnX + rel.btnW / 2, centerY - offset + i * cfg.lineHeight);
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
      loadAll(sources).then(
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
