'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createFsReader, writeOutput, count } = require('./build.js');
const { compile } = require('../core/compile.js');
const { normalizeBase } = require('../core/base-path.js');
const { formatDiagnostic, AloError } = require('../core/errors.js');
const log = require('./log.js');

const WATCHED = ['pages', 'components', 'data', 'global', 'public'];
const DEBOUNCE_MS = 100;
const PORT_ATTEMPTS = 20;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
};

function escapeHtml(text) {
    return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function reloadScript(base) {
    return `<script>(() => { const source = new EventSource(${JSON.stringify(base + '__alo/reload')}); source.onmessage = (event) => { if (event.data === 'reload') location.reload(); }; })();</script>`;
}

function errorPage(err, base) {
    const text =
        err instanceof AloError
            ? 'Error: ' + formatDiagnostic(err).join('\n').trimStart()
            : String(err && err.stack ? err.stack : err);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alo: build error</title>
<style>
body { margin: 0; padding: 2rem; background: #1b1b1f; color: #f2f2f2; font: 15px/1.6 ui-monospace, Menlo, Consolas, monospace; }
h1 { margin-top: 0; color: #ff6b6b; font: 600 1.2rem system-ui, sans-serif; }
pre { white-space: pre-wrap; padding: 1rem; border-left: 4px solid #ff6b6b; background: #26262b; }
p { color: #a0a0a8; font-family: system-ui, sans-serif; }
</style>
</head>
<body>
<h1>✖ Build error</h1>
<pre>${escapeHtml(text)}</pre>
<p>Fix the file and save it; this page reloads by itself.</p>
${reloadScript(base)}
</body>
</html>
`;
}

// A reader that keeps file contents between builds; the watcher forgets only the files that changed.
function createCachingReader(root) {
    const reader = createFsReader(root);
    const texts = new Map();
    return {
        exists: reader.exists,
        list: reader.list,
        read(file) {
            if (!texts.has(file)) texts.set(file, reader.read(file));
            return texts.get(file);
        },
        forget(file) {
            if (file === null) texts.clear();
            else texts.delete(file);
        },
    };
}

function listen(server, port, host) {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve(server.address().port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
    });
}

// Starts the dev server. Returns { url, port, close() }.
// options.silent hides the console messages (used by tests).
async function startDevServer({ root, port = 3000, base: rawBase = '/', host = 'localhost', silent = false }) {
    const base = normalizeBase(rawBase);
    const out = path.join(root, '.alo', 'dev');
    const reader = createCachingReader(root);
    const cache = { sfc: new Map(), data: new Map() };
    const clients = new Set();
    const say = (fn, ...args) => {
        if (!silent) fn(...args);
    };
    let state = { error: null };

    function broadcast() {
        for (const client of clients) client.write('data: reload\n\n');
    }

    function rebuild() {
        const started = performance.now();
        try {
            const result = compile({ reader, mode: 'dev', base, cache });
            const next = out + '.next';
            fs.rmSync(next, { recursive: true, force: true });
            writeOutput(root, next, result);
            fs.rmSync(out, { recursive: true, force: true });
            fs.renameSync(next, out);
            state = { error: null };
            for (const warning of result.warnings) say(log.warn, warning);
            return { ok: true, ms: Math.round(performance.now() - started), pages: result.files.filter((f) => f.path.endsWith('.html')).length };
        } catch (err) {
            state = { error: err };
            for (const warning of err.warnings ?? []) say(log.warn, warning);
            if (err instanceof AloError) say(log.error, err);
            else say(log.bug, err);
            return { ok: false };
        }
    }

    function send(res, status, headers, body, method) {
        res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
        res.end(method === 'HEAD' ? undefined : body);
    }

    function serveFile(res, file, status, method) {
        const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        let body = fs.readFileSync(file);
        if (type.startsWith('text/html')) body = body.toString('utf8').replace(/<\/body>(?![\s\S]*<\/body>)/, `${reloadScript(base)}\n</body>`);
        send(res, status, { 'Content-Type': type }, body, method);
    }

    function notFound(res, method) {
        const page = path.join(out, '404.html');
        if (fs.existsSync(page)) return serveFile(res, page, 404, method);
        return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found (404)', method);
    }

    function handle(req, res) {
        const method = req.method;
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { Allow: 'GET, HEAD' }, '', method);

        const url = new URL(req.url, 'http://localhost');
        let pathname;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad URL', method);
        }

        if (pathname === base + '__alo/reload') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            res.write('retry: 1000\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
        }

        if (!pathname.startsWith(base)) {
            if (pathname === '/' || pathname + '/' === base) return send(res, 302, { Location: base }, '', method);
            return notFound(res, method);
        }

        const relative = pathname.slice(base.length);
        const wantsPage = relative === '' || relative.endsWith('/') || relative.endsWith('.html') || !path.extname(relative);
        if (state.error && wantsPage) {
            return send(res, 500, { 'Content-Type': 'text/html; charset=utf-8' }, errorPage(state.error, base), method);
        }

        const target = path.resolve(out, ...relative.split('/').filter(Boolean));
        if (target !== out && !target.startsWith(out + path.sep)) return notFound(res, method);

        if (relative === '' || relative.endsWith('/')) {
            const index = path.join(target, 'index.html');
            return fs.existsSync(index) ? serveFile(res, index, 200, method) : notFound(res, method);
        }
        if (fs.existsSync(target) && fs.statSync(target).isFile()) return serveFile(res, target, 200, method);
        if (fs.existsSync(path.join(target, 'index.html'))) {
            return send(res, 301, { Location: pathname + '/' + url.search }, '', method);
        }
        return notFound(res, method);
    }

    // Watches the five project folders; the project root is watched too, so a folder created later is picked up.
    const watchers = new Map();
    let timer = null;
    let changed = new Set();

    function schedule(file) {
        changed.add(file);
        clearTimeout(timer);
        timer = setTimeout(() => {
            for (const name of changed) reader.forget(name);
            changed = new Set();
            const result = rebuild();
            if (result.ok) say(log.success, `Rebuilt ${count(result.pages, 'page')} in ${result.ms}ms`);
            broadcast();
        }, DEBOUNCE_MS);
    }

    function watchFolder(name) {
        const dir = path.join(root, name);
        if (watchers.has(name) || !fs.existsSync(dir)) return;
        const watcher = fs.watch(dir, { recursive: true }, (_, filename) => {
            schedule(filename ? `${name}/${String(filename).split(path.sep).join('/')}` : null);
        });
        watcher.on('error', () => {
            watcher.close();
            watchers.delete(name);
        });
        watchers.set(name, watcher);
    }

    for (const name of WATCHED) watchFolder(name);
    const rootWatcher = fs.watch(root, (_, filename) => {
        const name = filename ? String(filename) : null;
        if (name && WATCHED.includes(name)) {
            watchFolder(name);
            schedule(null);
        }
    });

    const first = rebuild();
    if (first.ok) say(log.success, `Built ${count(first.pages, 'page')} in ${first.ms}ms`);

    const server = http.createServer(handle);
    let actual = null;
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
        const tryPort = port === 0 ? 0 : port + attempt;
        try {
            actual = await listen(server, tryPort, host);
            break;
        } catch (err) {
            if (err.code !== 'EADDRINUSE' || port === 0) throw err;
        }
    }
    if (actual === null) {
        throw new AloError({ message: `Ports ${port} to ${port + PORT_ATTEMPTS - 1} are all in use.`, hint: 'Pick another port, e.g. `--port 4000`.' });
    }

    const url = `http://${host}:${actual}${base}`;
    if (port !== 0 && actual !== port) say(log.info, `Port ${port} was in use, so the server started on ${actual}.`);
    say(log.info, `\nAlo dev server running at ${url}\nPress Ctrl+C to stop\n`);

    async function close() {
        clearTimeout(timer);
        rootWatcher.close();
        for (const watcher of watchers.values()) watcher.close();
        for (const client of clients) client.end();
        await new Promise((resolve) => server.close(resolve));
    }

    return { url, port: actual, close };
}

module.exports = { startDevServer, MIME_TYPES };
