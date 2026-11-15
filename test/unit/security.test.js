'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../../alo-core/core/markdown.js');
const { evaluate } = require('../../alo-core/core/expression.js');
const { childEnv } = require('../../lib/child-env.js');

test('markdown escapes raw HTML', () => {
    assert.ok(!renderMarkdown('<script>alert(1)</script>').includes('<script'));
    assert.ok(!renderMarkdown('hello <img src=x onerror=alert(1)> there').includes('<img'));
    assert.ok(!renderMarkdown('<img src=x onerror=alert(1)>').includes('<img'));
});

test('markdown drops dangerous link and image schemes', () => {
    assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('javascript:'));
    assert.ok(!renderMarkdown('[x](JaVa\tScript:alert(1))').includes('href'));
    assert.ok(!renderMarkdown('[x](data:text/html,<script>alert(1)</script>)').includes('data:'));
    assert.ok(!renderMarkdown('![x](vbscript:msgbox(1))').includes('<img'));
    assert.ok(renderMarkdown('[x](https://example.com)').includes('href="https://example.com"'));
    assert.ok(renderMarkdown('[x](mailto:a@b.c)').includes('href="mailto:a@b.c"'));
});

test('markdown escapes attribute values', () => {
    const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1))');
    assert.ok(!/"onmouseover=/.test(html));
});

test('expressions cannot reach Function, process or the prototype chain', () => {
    const payloads = [
        'constructor.constructor("return process")()',
        'this.constructor',
        '__proto__',
        '({}).__proto__',
        '[].constructor.constructor("return process")()',
        'process.env',
        'require("fs")',
        'globalThis',
        'eval("1")',
    ];
    for (const code of payloads) {
        assert.throws(() => evaluate(code, {}, {}), `should fail: ${code}`);
    }
});

test('expressions still work', () => {
    assert.equal(evaluate('data.a + 1', { data: { a: 2 } }, {}), 3);
});

test('child processes get a small environment', () => {
    process.env.ALO_TEST_SECRET = 'x';
    const env = childEnv();
    delete process.env.ALO_TEST_SECRET;
    assert.equal(env.ALO_TEST_SECRET, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
});

test('the bundled Alo has no dynamic code execution', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..', 'alo-core');
    const forbidden = [/new Function\s*\(/, /\beval\s*\(/, /require\(['"](node:)?vm['"]\)/];
    for (const folder of ['core', 'cli', 'bin']) {
        for (const file of fs.readdirSync(path.join(root, folder)).filter((f) => f.endsWith('.js'))) {
            const code = fs
                .readFileSync(path.join(root, folder, file), 'utf8')
                .split('\n')
                .filter((line) => !/^\s*\/\//.test(line))
                .join('\n');
            for (const pattern of forbidden) {
                assert.ok(!pattern.test(code), `${folder}/${file} matches ${pattern}`);
            }
        }
    }
});
