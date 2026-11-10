'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { expressionRanges, isInside, htmlView } = require('../../lib/embedded');

const view = (text) => htmlView(text, expressionRanges(text));

test('htmlView blanks {{ }} and {{{ }}} but keeps every position', () => {
    assert.equal(view('<p>{{ a }}</p>'), '<p>       </p>');
    assert.equal(view('<a href="/{{ x }}/">'), '<a href="/       /">');
    assert.equal(view('{{{ item.body }}}x'), '                 x');
    assert.equal(view('{{ a +\n b }}<i>'), '      \n     <i>');
});

test('expressionRanges skips escapes, comments, <script> and <style>', () => {
    assert.deepEqual(expressionRanges('\\{{ x }}'), []);
    assert.deepEqual(expressionRanges('<script>const a={{b:1}};</script>{{ c }}'), [[33, 40]]);
    assert.deepEqual(expressionRanges('<style>a{}</style>'), []);
    assert.deepEqual(expressionRanges('<!-- {{ x }} -->{{ y }}'), [[16, 23]]);
});

test('an unclosed {{ only runs to the end of its line', () => {
    assert.equal(view('<p>{{ a\n<div>'), '<p>    \n<div>');
});

test('isInside is true only between the braces', () => {
    const ranges = expressionRanges('<p>{{ a }}</p>');
    assert.deepEqual([3, 4, 9, 10].map((offset) => isInside(offset, ranges)), [false, true, true, false]);
});
