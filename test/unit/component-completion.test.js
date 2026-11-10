'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { componentNameStart } = require('../../lib/component-completion');

// `|` marks the cursor.
function startAt(textWithCursor) {
    const offset = textWithCursor.indexOf('|');
    return componentNameStart(textWithCursor.replace('|', ''), offset);
}

test('finds where a component name starts after <', () => {
    assert.equal(startAt('<template>\n  <|\n</template>'), 14);
    assert.equal(startAt('<template>\n  <Ca|\n</template>'), 14);
    assert.equal(startAt('<p><Blog.Po|</p>'), 4);
    assert.equal(startAt('<p><bl|</p>'), 4);
    assert.equal(startAt('<script></script>\n<|'), 19);
    assert.equal(startAt('<p>{{ a }}<|</p>'), 11);
});

test('no component names where a tag cannot start', () => {
    assert.equal(startAt('<p></|</p>'), -1, 'closing tag');
    assert.equal(startAt('<script>\n const a = <|\n</script>'), -1, 'inside <script>');
    assert.equal(startAt('<style>\n a <|\n</style>'), -1, 'inside <style>');
    assert.equal(startAt('<!-- <| -->'), -1, 'inside a comment');
    assert.equal(startAt('<p>{{ a <| b }}</p>'), -1, 'comparison inside {{ }}');
    assert.equal(startAt('<p>{{ a <|'), -1, 'unclosed {{ at the end of the file');
    assert.equal(startAt('<p>{{ a <|\n<div>'), -1, 'unclosed {{ in the middle');
    assert.equal(startAt('<p>hello|</p>'), -1, 'plain text');
});
