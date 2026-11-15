'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findAdharRoot } = require('../../lib/adhar');

function make(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alo-vscode-adhar-'));
    for (const [file, text] of Object.entries(files)) {
        const full = path.join(dir, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    return dir;
}

test('web/ next to the adhar script and api/ is an Adhar full stack site', () => {
    const dir = make({ adhar: '#!/usr/bin/env node', 'api/index.js': '', 'web/pages/page.alo': '' });
    assert.equal(findAdharRoot(path.join(dir, 'web')), dir);
});

test('other Alo projects are not', () => {
    const plain = make({ 'pages/page.alo': '' });
    assert.equal(findAdharRoot(plain), null);
    const noApi = make({ adhar: '', 'web/pages/page.alo': '' });
    assert.equal(findAdharRoot(path.join(noApi, 'web')), null);
    const otherName = make({ adhar: '', 'api/x.js': '', 'site/pages/page.alo': '' });
    assert.equal(findAdharRoot(path.join(otherName, 'site')), null);
});
