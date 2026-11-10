'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expressionContext, loopVariables, pathAt, describe, mergeItems, dataLocation } = require('../../lib/expressions');

// `|` marks the cursor.
const at = (textWithCursor) => [textWithCursor.replace('|', ''), textWithCursor.indexOf('|')];

test('what is being typed inside {{ }}', () => {
    assert.deepEqual(expressionContext(...at('<p>{{ data.| }}</p>')), { path: ['data'], partial: '', start: 11 });
    assert.deepEqual(expressionContext(...at('<p>{{ data.site.na| }}</p>')), { path: ['data', 'site'], partial: 'na', start: 16 });
    assert.deepEqual(expressionContext(...at('<p>{{ data?.site?.| }}</p>')), { path: ['data', 'site'], partial: '', start: 18 });
    assert.deepEqual(expressionContext(...at('<p>{{ da| }}</p>')), { path: [], partial: 'da', start: 6 });
    assert.deepEqual(expressionContext(...at('<div>{{{ item.| }}}</div>')).path, ['item']);
    assert.deepEqual(expressionContext(...at('<p>{{ data.|')).path, ['data'], 'unclosed at the end of the file');
});

test('also in for, if and else-if on <template>', () => {
    assert.deepEqual(expressionContext(...at('<template for="f in data.| ">')).path, ['data']);
    assert.deepEqual(expressionContext(...at('<template if="item.| ">')).path, ['item']);
});

test('nothing where there is no expression or no plain path', () => {
    assert.equal(expressionContext(...at('<p>data.| {{ x }}</p>')), null, 'plain text');
    assert.equal(expressionContext(...at('<li if="item.| ">')), null, 'logic on an element is not run');
    assert.equal(expressionContext(...at('<script>\n const a = data.|\n</script>')), null, 'inside <script>');
    assert.equal(expressionContext(...at('<p>{{ foo().| }}</p>')), null, 'after a call');
    assert.equal(expressionContext(...at('<p>{{ "a".| }}</p>')), null, 'after a string');
});

test('loop variables around the cursor', () => {
    const text = '<template for="post in data.blog">\n <template for="(t, i) in post.tags">\n {{ t| }}</template></template>';
    assert.deepEqual(loopVariables(...at(text)), [
        { name: 'post', index: null, source: ['data', 'blog'] },
        { name: 't', index: 'i', source: ['post', 'tags'] },
    ]);
    assert.deepEqual(loopVariables(...at('<template for="post in data.blog"></template> {{ | }}')), [], 'the loop is closed');
});

test('pathAt reads the path up to the word under the cursor', () => {
    assert.deepEqual(pathAt(...at('<p>{{ data.si|te.name }}</p>')), { segments: ['data', 'site'], start: 6, end: 15 });
    assert.deepEqual(pathAt(...at('<p>{{ data.site.na|me.length }}</p>')).segments, ['data', 'site', 'name']);
    assert.equal(pathAt(...at('<p>{{ x.y().da|ta }}</p>')), null);
});

test('describe and mergeItems', () => {
    assert.equal(describe('hello'), 'text: hello');
    assert.equal(describe([1, 2]), 'list of 2');
    assert.equal(describe(3), 'number: 3');
    assert.deepEqual(Object.keys(mergeItems([{ a: 1 }, { b: 2, a: 3 }])), ['a', 'b']);
});

test('dataLocation finds the file and the line of a key', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alo-vscode-data-'));
    fs.mkdirSync(path.join(root, 'data', 'shop'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'site.json'), '{\n    "name": "A",\n    "social": {\n        "github": "x"\n    }\n}\n');
    fs.writeFileSync(path.join(root, 'data', 'footer-links.json'), '[]');
    fs.writeFileSync(path.join(root, 'data', 'shop', 'settings.json'), '{\n  "currency": "BDT"\n}');
    const toKey = (name) => name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
    const where = (p) => {
        const found = dataLocation(root, p.split('.'), toKey);
        return found && `${path.relative(root, found.file)}:${found.line}`;
    };
    assert.equal(where('data.site'), 'data/site.json:0');
    assert.equal(where('data.site.name'), 'data/site.json:1');
    assert.equal(where('data.site.social.github'), 'data/site.json:3');
    assert.equal(where('data.footerLinks'), 'data/footer-links.json:0');
    assert.equal(where('data.shop.settings.currency'), 'data/shop/settings.json:1');
    assert.equal(where('data.shop'), null, 'a folder');
    assert.equal(where('data.nope'), null);
});
