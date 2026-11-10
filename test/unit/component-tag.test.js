'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { componentTagAt, attributeName } = require('../../lib/component-tag');

// `|` marks the cursor.
function tagAt(textWithCursor) {
    const offset = textWithCursor.indexOf('|');
    return componentTagAt(textWithCursor.replace('|', ''), offset);
}

test('finds the component name under the cursor', () => {
    assert.deepEqual(tagAt('<p><Blog.Post|Card post="x" /></p>'), { name: 'Blog.PostCard', start: 4, end: 17 });
    assert.deepEqual(tagAt('<p><|Card /></p>'), { name: 'Card', start: 4, end: 8 });
    assert.deepEqual(tagAt('<p><Card| /></p>'), { name: 'Card', start: 4, end: 8 });
    assert.deepEqual(tagAt('</Ca|rd>'), { name: 'Card', start: 2, end: 6 });
    assert.deepEqual(tagAt('<A /><Ca|rd />'), { name: 'Card', start: 6, end: 10 });
});

test('nothing for HTML tags, attributes, scripts, comments and {{ }}', () => {
    assert.equal(tagAt('<di|v class="a">'), null);
    assert.equal(tagAt('<Card ti|tle="a" />'), null);
    assert.equal(tagAt('<script>\nconst a = "<Ca|rd>"\n</script>'), null);
    assert.equal(tagAt('<!-- <Ca|rd> -->'), null);
    assert.equal(tagAt('{{ a <Ca|rd }}'), null);
});

test('attributeName turns props.postDate into post-date', () => {
    assert.equal(attributeName('postDate'), 'post-date');
    assert.equal(attributeName('title'), 'title');
});
