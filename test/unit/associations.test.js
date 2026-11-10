'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { conflictingKeys, withoutKeys } = require('../../lib/associations');

test('finds keys that open .alo files as another language', () => {
    assert.deepEqual(conflictingKeys({ '*.alo': 'html' }), ['*.alo']);
    assert.deepEqual(conflictingKeys({ '**/*.alo': 'html', '*.blade.php': 'html', 'pages/**/*.ALO': 'django-html' }), ['**/*.alo', 'pages/**/*.ALO']);
});

test('leaves alone keys that are fine', () => {
    assert.deepEqual(conflictingKeys({ '*.alo': 'alo', '*.html': 'django-html' }), []);
    assert.deepEqual(conflictingKeys(undefined), []);
    assert.deepEqual(conflictingKeys({}), []);
});

test('withoutKeys keeps the other associations, or removes the setting when none are left', () => {
    assert.deepEqual(withoutKeys({ '*.alo': 'html', '*.blade.php': 'html' }, ['*.alo']), { '*.blade.php': 'html' });
    assert.equal(withoutKeys({ '*.alo': 'html' }, ['*.alo']), undefined);
});
