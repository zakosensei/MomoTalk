// Minimal static file server for the MomoTalk QA harness.
// Usage: node serve.js <rootDir> <port>
// Started automatically by run.ps1 when nothing is listening on the port.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.resolve(__dirname, '..'));
const port = Number(process.argv[3] || 8765);
const host = '127.0.0.1';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.zip': 'application/zip',
    '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://' + host + ':' + port).pathname);
    } catch (e) {
        res.writeHead(400); res.end('bad request'); return;
    }
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(root, urlPath));
    if (!filePath.startsWith(root)) {
        res.writeHead(403); res.end('forbidden'); return;
    }
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 ' + urlPath);
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Content-Length': stat.size,
            'Cache-Control': 'no-store'
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => { try { res.end(); } catch (e) { /* ignore */ } });
        stream.pipe(res);
    });
});

server.listen(port, host, () => {
    console.log('[serve] ' + root + ' -> http://' + host + ':' + port + '/');
});

server.on('error', (err) => {
    console.error('[serve] failed: ' + err.message);
    process.exit(1);
});
