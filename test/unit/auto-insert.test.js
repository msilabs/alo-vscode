'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { closingTag, expandBraces } = require('../../lib/auto-insert');

test('closingTag closes normal and component tags', () => {
    assert.equal(closingTag('<template>\n  <div>', ''), '</div>');
    assert.equal(closingTag('<Blog.PostCard title="a">', ''), '</Blog.PostCard>');
    assert.equal(closingTag('<template if="a > 1">', ''), '</template>');
    assert.equal(closingTag('<script>', ''), '</script>');
    assert.equal(closingTag('<script></script>\n<p>', ''), '</p>');
});

test('closingTag leaves alone what must not be closed', () => {
    assert.equal(closingTag('<template if="a >', '"'), null, '> inside an attribute value');
    assert.equal(closingTag('<Card />', ''), null, 'self-closing');
    assert.equal(closingTag('<br>', ''), null, 'void element');
    assert.equal(closingTag('<script>\nconst x = "<b>', ''), null, 'inside <script>');
    assert.equal(closingTag('<!-- <div>', ''), null, 'inside a comment');
    assert.equal(closingTag('<p>', '</p>'), null, 'already closed');
});

test('expandBraces turns {{ into {{ | }} and {{ { into {{{ | }}}', () => {
    assert.deepEqual(expandBraces('<p>{{', '}}</p>'), { removeBefore: 2, removeAfter: 2, open: '{{ ', close: ' }}' });
    assert.deepEqual(expandBraces('<p>{{', '</p>'), { removeBefore: 2, removeAfter: 0, open: '{{ ', close: ' }}' });
    assert.deepEqual(expandBraces('<p>{{ {', '} }}</p>'), { removeBefore: 4, removeAfter: 4, open: '{{{ ', close: ' }}}' });
    assert.deepEqual(expandBraces('<a href="{{', '}}">'), { removeBefore: 2, removeAfter: 2, open: '{{ ', close: ' }}' });
});

test('expandBraces skips escapes, <style> and <script>', () => {
    assert.equal(expandBraces('<p>\\{{', '}}'), null);
    assert.equal(expandBraces('<style>\na {{', '}}'), null);
    assert.equal(expandBraces('<script>\nconst a = {{', '}}'), null);
});
