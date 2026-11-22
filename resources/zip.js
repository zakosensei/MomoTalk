/*
 * MomoTalk 极简 ZIP 读写（无第三方依赖）
 *
 * 用途：自定义学生（含表情差分）的 .zip 导入 / 导出。
 *
 *   MomoZip.create([{ path: '学生名/001.jpg', data: Uint8Array | string | Blob }])
 *       → Promise<Blob>            （优先 deflate，环境不支持时退回 store）
 *   MomoZip.read(File | Blob | ArrayBuffer)
 *       → Promise<[{ path, data: Uint8Array, lastModified }]>
 *   MomoZip.decodeText(uint8) / MomoZip.encodeText(string)
 *   MomoZip.dataUrlToBytes(dataUrl) / MomoZip.bytesToDataUrl(bytes, mime)
 *
 * 支持：store(0) / deflate(8)、UTF-8 文件名（通用标志位 bit 11）、
 * ZIP64 不处理（本项目导出文件远小于 4GB）、加密不支持。
 */
(function (global) {
    'use strict';

    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

    function encodeText(str) {
        if (enc) return enc.encode(String(str == null ? '' : str));
        // 理论兜底（TextEncoder 不可用的老环境）
        var s = unescape(encodeURIComponent(String(str == null ? '' : str)));
        var out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
        return out;
    }

    function decodeText(bytes) {
        if (dec) return dec.decode(bytes);
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    // zip 文件名解码：自带 UTF-8 标志位（bit 11）时按 UTF-8；
    // 否则先试 UTF-8，出现替换字符（\uFFFD）再退回 GBK（Windows 自带压缩工具常见）。
    function decodeName(bytes, flag) {
        var text = decodeText(bytes);
        if (flag & 0x0800) return text;
        if (text.indexOf('\uFFFD') < 0) return text;
        try {
            var gbk = new TextDecoder('gbk');
            var alt = gbk.decode(bytes);
            if (alt && alt.indexOf('\uFFFD') < 0) return alt;
        } catch (e) { /* 不支持 gbk 时保持 UTF-8 结果 */ }
        return text;
    }

    function concatBytes(chunksDiv, total) {
        var out = new Uint8Array(total);
        var off = 0;
        chunksDiv.forEach(function (c) { out.set(c, off); off += c.length; });
        return out;
    }

    // ---------------------------------------------------------------- 压缩
    function streamThrough(bytes, kind) {
        return new Promise(function (resolve) {
            var Ctor = kind === 'deflate' ? global.CompressionStream : global.DecompressionStream;
            if (typeof Ctor !== 'function') { resolve(null); return; }
            try {
                var stream = new Blob([bytes]).stream().pipeThrough(new Ctor('deflate-raw'));
                new Response(stream).arrayBuffer().then(function (buf) {
                    resolve(new Uint8Array(buf));
                }).catch(function () { resolve(null); });
            } catch (e) {
                resolve(null);
            }
        });
    }

    function deflateRaw(bytes) {
        return streamThrough(bytes, 'deflate');
    }

    function inflateRaw(bytes) {
        return streamThrough(bytes, 'inflate');
    }

    // ---------------------------------------------------------------- 日期
    function dosDateTime(src) {
        var d = (src instanceof Date && !isNaN(src.getTime())) ? src : new Date();
        var year = d.getFullYear();
        if (year < 1980) { year = 1980; }
        var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1F);
        var date = (((year - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
        return { time: time, date: date };
    }

    function parseDosDateTime(time, date) {
        var year = 1980 + ((date >> 9) & 0x7F);
        var month = ((date >> 5) & 0x0F) || 1;
        var day = (date & 0x1F) || 1;
        var hours = (time >> 11) & 0x1F;
        var minutes = (time >> 5) & 0x3F;
        var seconds = (time & 0x1F) * 2;
        return new Date(year, month - 1, day, hours, minutes, seconds);
    }

    // ---------------------------------------------------------------- 写入
    function toBytes(data) {
        if (data == null) return Promise.resolve(new Uint8Array(0));
        if (data instanceof Uint8Array) return Promise.resolve(data);
        if (typeof data === 'string') return Promise.resolve(encodeText(data));
        if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            return data.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
        }
        if (Array.isArray(data)) return Promise.resolve(new Uint8Array(data));
        return Promise.resolve(encodeText(String(data)));
    }

    /**
     * entries: [{ path: 'a/b.txt', data: Uint8Array|string|Blob, date?: Date, compress?: boolean }]
     * 返回 Promise<Blob>
     */
    function create(entries) {
        var list = Array.isArray(entries) ? entries.slice() : [];
        var prepared = [];
        return list.reduce(function (chain, entry) {
            return chain.then(function () {
                var path = String((entry && entry.path) || '').replace(/\\/g, '/').replace(/^\/+/, '');
                if (!path) return null;
                return toBytes(entry.data).then(function (raw) {
                    var wantDeflate = entry.compress !== false && raw.length > 64;
                    var task = wantDeflate ? deflateRaw(raw) : Promise.resolve(null);
                    return task.then(function (packed) {
                        var useDeflate = !!packed && packed.length < raw.length;
                        var dt = dosDateTime(entry.date);
                        prepared.push({
                            path: path,
                            raw: raw,
                            body: useDeflate ? packed : raw,
                            method: useDeflate ? 8 : 0,
                            time: dt.time,
                            date: dt.date,
                            crc: crc32(raw)
                        });
                    });
                });
            });
        }, Promise.resolve()).then(function () {
            var localParts = [];
            var centralParts = [];
            var offset = 0;
            var count = prepared.length;

            prepared.forEach(function (item) {
                var nameBytes = encodeText(item.path);
                var flag = 0x0800; // UTF-8 文件名
                var localHeader = new Uint8Array(30 + nameBytes.length);
                var lv = new DataView(localHeader.buffer);
                lv.setUint32(0, 0x04034B50, true);
                lv.setUint16(4, 20, true);          // version needed
                lv.setUint16(6, flag, true);
                lv.setUint16(8, item.method, true);
                lv.setUint16(10, item.time, true);
                lv.setUint16(12, item.date, true);
                lv.setUint32(14, item.crc, true);
                lv.setUint32(18, item.body.length, true);
                lv.setUint32(22, item.raw.length, true);
                lv.setUint16(26, nameBytes.length, true);
                lv.setUint16(28, 0, true);          // extra len
                localHeader.set(nameBytes, 30);

                var centralHeader = new Uint8Array(46 + nameBytes.length);
                var cv = new DataView(centralHeader.buffer);
                cv.setUint32(0, 0x02014B50, true);
                cv.setUint16(4, 20, true);          // version made by
                cv.setUint16(6, 20, true);          // version needed
                cv.setUint16(8, flag, true);
                cv.setUint16(10, item.method, true);
                cv.setUint16(12, item.time, true);
                cv.setUint16(14, item.date, true);
                cv.setUint32(16, item.crc, true);
                cv.setUint32(20, item.body.length, true);
                cv.setUint32(24, item.raw.length, true);
                cv.setUint16(28, nameBytes.length, true);
                cv.setUint16(30, 0, true);          // extra len
                cv.setUint16(32, 0, true);          // comment len
                cv.setUint16(34, 0, true);          // disk number
                cv.setUint16(36, 0, true);          // internal attrs
                cv.setUint32(38, 0, true);          // external attrs
                cv.setUint32(42, offset, true);     // local header offset
                centralHeader.set(nameBytes, 46);

                localParts.push(localHeader, item.body);
                centralParts.push(centralHeader);
                offset += localHeader.length + item.body.length;
            });

            var centralSize = centralParts.reduce(function (n, p) { return n + p.length; }, 0);
            var eocd = new Uint8Array(22);
            var ev = new DataView(eocd.buffer);
            ev.setUint32(0, 0x06054B50, true);
            ev.setUint16(4, 0, true);
            ev.setUint16(6, 0, true);
            ev.setUint16(8, count, true);
            ev.setUint16(10, count, true);
            ev.setUint32(12, centralSize, true);
            ev.setUint32(16, offset, true);
            ev.setUint16(20, 0, true);

            var all = localParts.concat(centralParts, [eocd]);
            var total = all.reduce(function (n, p) { return n + p.length; }, 0);
            return new Blob([concatBytes(all, total)], { type: 'application/zip' });
        });
    }

    // ---------------------------------------------------------------- 读取
    function readSource(src) {
        if (!src) return Promise.resolve(null);
        if (src instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(src));
        if (src instanceof Uint8Array) return Promise.resolve(src);
        if (typeof Blob !== 'undefined' && src instanceof Blob) {
            return src.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
        }
        return Promise.resolve(null);
    }

    function findEOCD(bytes) {
        var min = Math.max(0, bytes.length - 22 - 65535);
        for (var i = bytes.length - 22; i >= min; i--) {
            if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B &&
                bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 返回 Promise<[{ path, data: Uint8Array, lastModified: Date }]>
     */
    function read(src) {
        return readSource(src).then(function (bytes) {
            if (!bytes || bytes.length < 22) throw new Error('不是有效的 zip 文件');
            var eocd = findEOCD(bytes);
            if (eocd < 0) throw new Error('不是有效的 zip 文件（缺少目录结束记录）');
            var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            var count = view.getUint16(eocd + 10, true);
            var cdOffset = view.getUint32(eocd + 16, true);
            var cdSize = view.getUint32(eocd + 12, true);
            if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
                throw new Error('暂不支持 ZIP64 格式');
            }

            var out = [];
            var records = [];
            var p = cdOffset;
            for (var i = 0; i < count; i++) {
                if (p + 46 > bytes.length) break;
                if (view.getUint32(p, true) !== 0x02014B50) throw new Error('zip 中央目录损坏');
                var flag = view.getUint16(p + 8, true);
                var method = view.getUint16(p + 10, true);
                var time = view.getUint16(p + 12, true);
                var date = view.getUint16(p + 14, true);
                var compSize = view.getUint32(p + 20, true);
                var rawSize = view.getUint32(p + 24, true);
                var nameLen = view.getUint16(p + 28, true);
                var extraLen = view.getUint16(p + 30, true);
                var commentLen = view.getUint16(p + 32, true);
                var localOffset = view.getUint32(p + 42, true);
                var nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
                var path = decodeName(nameBytes, flag).replace(/\\/g, '/');
                p += 46 + nameLen + extraLen + commentLen;
                if (!path || /\/$/.test(path)) continue; // 目录条目

                if (localOffset + 30 > bytes.length) continue;
                if (view.getUint32(localOffset, true) !== 0x04034B50) continue;
                var lNameLen = view.getUint16(localOffset + 26, true);
                var lExtraLen = view.getUint16(localOffset + 28, true);
                var dataStart = localOffset + 30 + lNameLen + lExtraLen;
                var body = bytes.subarray(dataStart, dataStart + compSize);
                records.push({
                    path: path,
                    method: method,
                    body: body,
                    rawSize: rawSize,
                    lastModified: parseDosDateTime(time, date)
                });
            }

            // 顺序解压（避免大量图片同时解压占满内存）；每轮的变量都用参数捕获，
            // 不能直接用 for 循环里的 var（闭包会读到最后一轮的值）
            var chain = Promise.resolve();
            records.forEach(function (rec) {
                chain = chain.then(function () {
                    if (rec.method === 0) {
                        out.push({ path: rec.path, data: new Uint8Array(rec.body), lastModified: rec.lastModified });
                        return null;
                    }
                    if (rec.method !== 8) throw new Error('不支持的 zip 压缩方式：' + rec.method);
                    return inflateRaw(rec.body).then(function (decoded) {
                        if (!decoded) throw new Error('无法解压 zip 条目：' + rec.path);
                        if (rec.rawSize && decoded.length !== rec.rawSize) {
                            throw new Error('zip 条目大小不匹配：' + rec.path);
                        }
                        out.push({ path: rec.path, data: decoded, lastModified: rec.lastModified });
                    });
                });
            });
            return chain.then(function () { return out; });
        });
    }

    // ---------------------------------------------------------------- 工具
    var EXT_MIME = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml'
    };

    function mimeForPath(path) {
        var m = /\.([a-z0-9]+)$/i.exec(String(path || ''));
        if (!m) return 'application/octet-stream';
        return EXT_MIME[m[1].toLowerCase()] || 'application/octet-stream';
    }

    var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var B64_LOOKUP = null;

    // 纯 JS 的 base64（不依赖 atob / Buffer，浏览器与 Node 行为一致）
    function bytesToBase64(bytes) {
        var out = '';
        var len = bytes.length;
        var i = 0;
        for (; i + 2 < len; i += 3) {
            var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] +
                B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
        }
        var rest = len - i;
        if (rest === 1) {
            var n1 = bytes[i] << 16;
            out += B64_ALPHABET[(n1 >> 18) & 63] + B64_ALPHABET[(n1 >> 12) & 63] + '==';
        } else if (rest === 2) {
            var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
            out += B64_ALPHABET[(n2 >> 18) & 63] + B64_ALPHABET[(n2 >> 12) & 63] +
                B64_ALPHABET[(n2 >> 6) & 63] + '=';
        }
        return out;
    }

    function base64ToBytes(b64) {
        if (!B64_LOOKUP) {
            B64_LOOKUP = {};
            for (var k = 0; k < B64_ALPHABET.length; k++) B64_LOOKUP[B64_ALPHABET[k]] = k;
        }
        var s = String(b64 || '').replace(/[^A-Za-z0-9+/]/g, '');
        if (!s.length) return new Uint8Array(0);
        var padding = (String(b64).match(/=+$/) || [''])[0].length;
        var byteLen = Math.floor(s.length * 3 / 4) - (padding ? (padding - 1) : 0);
        // 更稳妥：按 4 个字符一段计算实际字节数
        byteLen = Math.floor(s.length / 4) * 3;
        if (s.length % 4 === 2) byteLen += 1;
        else if (s.length % 4 === 3) byteLen += 2;
        var out = new Uint8Array(byteLen);
        var oi = 0;
        for (var i = 0; i < s.length; i += 4) {
            var c0 = B64_LOOKUP[s[i]] || 0;
            var c1 = B64_LOOKUP[s[i + 1]] || 0;
            var c2 = B64_LOOKUP[s[i + 2]] || 0;
            var c3 = B64_LOOKUP[s[i + 3]] || 0;
            var n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
            if (oi < byteLen) out[oi++] = (n >> 16) & 0xFF;
            if (oi < byteLen) out[oi++] = (n >> 8) & 0xFF;
            if (oi < byteLen) out[oi++] = n & 0xFF;
        }
        return out;
    }

    function bytesToDataUrl(bytes, mime) {
        return 'data:' + (mime || 'application/octet-stream') + ';base64,' + bytesToBase64(bytes);
    }

    function dataUrlToBytes(dataUrl) {
        var s = String(dataUrl || '');
        var m = /^data:([^;,]*)(;base64)?,(.*)$/i.exec(s);
        if (!m) return null;
        if (m[2]) return base64ToBytes(m[3]);
        // 非 base64 的 dataURL：按 URI 解码
        try { return encodeText(decodeURIComponent(m[3])); } catch (e) { return null; }
    }

    var api = {
        create: create,
        read: read,
        crc32: crc32,
        encodeText: encodeText,
        decodeText: decodeText,
        mimeForPath: mimeForPath,
        bytesToDataUrl: bytesToDataUrl,
        dataUrlToBytes: dataUrlToBytes,
        bytesToBase64: bytesToBase64,
        base64ToBytes: base64ToBytes
    };

    global.MomoZip = api;
    if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
