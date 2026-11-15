'use strict';

// A small, safe expression evaluator for `{{ }}`, `if`, `else-if` and `for`.
// It reads the expression with its own tokenizer and parser and walks the result.
// Nothing is ever compiled to JavaScript: no `new Function`, no `eval`.
//
// Supported: numbers, strings, template literals, regular expressions, `true`/`false`/`null`,
// array and object literals (with spread), `.` `?.` `[]`, calls, `new` for a few built-ins,
// unary, binary, logical and `??` operators, `a ? b : c`, `typeof`, `in`, and arrow functions
// with an expression body (for `.map(x => x.title)`).
// Writes such as `data.x = 1` and `delete data.x` are parsed only so that data, which is frozen,
// can answer with its "cannot be changed" error. Not supported: `++`, `function`, `class`, statements, `this`.

const { AloError, suggest } = require('./errors.js');

const cache = new Map();

// V8 messages for writes to frozen objects, e.g. `.sort()` or `.push()`.
const FROZEN_WRITE = /read only property|not extensible|Cannot delete property|Cannot redefine property|Cannot define property/;

const MAX_DEPTH = 100;
const BLOCKED_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'caller', 'callee', 'arguments']);

const SAFE_OBJECT = Object.freeze({
    keys: Object.keys,
    values: Object.values,
    entries: Object.entries,
    fromEntries: Object.fromEntries,
    hasOwn: Object.hasOwn,
    assign: Object.assign,
});

const GLOBALS = Object.freeze({
    __proto__: null,
    undefined,
    NaN,
    Infinity,
    Math,
    JSON,
    Date,
    Intl,
    Number,
    String,
    Boolean,
    Array,
    RegExp,
    Map,
    Set,
    Object: SAFE_OBJECT,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
});

const ALLOWED_CONSTRUCTORS = new Set(
    [Date, RegExp, Map, Set, Array, Intl.NumberFormat, Intl.DateTimeFormat, Intl.PluralRules, Intl.ListFormat, Intl.RelativeTimeFormat, Intl.Collator, Intl.Segmenter].filter(Boolean),
);

const FUNCTION_CONSTRUCTORS = new Set(
    [Function, async function () {}, function* () {}, async function* () {}].map((fn) => (fn === Function ? Function : Object.getPrototypeOf(fn).constructor)),
);

const UNSUPPORTED_WORDS = new Set([
    'function', 'class', 'var', 'let', 'const', 'this', 'instanceof', 'async', 'await', 'yield',
    'import', 'super', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'throw', 'try', 'catch',
]);
const KEYWORD_OPERATORS = new Set(['typeof', 'void', 'in']);

const PUNCTUATORS = [
    '...', '===', '!==', '>>>', '**', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '??', '?.', '=>',
    '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '?', ':', ',', '.', '(', ')', '[', ']', '{', '}', '=',
];

const BINARY_PRECEDENCE = {
    '??': 1, '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
    '==': 6, '!=': 6, '===': 6, '!==': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7, in: 7,
    '<<': 8, '>>': 8, '>>>': 8,
    '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11,
};

const DEFAULT_SYNTAX_HINT = 'Expressions use a safe part of JavaScript: values, operators, `.`, `?.`, method calls, template literals and arrow functions. Statements and `function` are not available.';
const ASSIGNMENT_HINT = 'Expressions only read data, they cannot change it. Make a new value instead: use `toReversed()`, `toSorted()` or `slice()`.';

class ExpressionSyntaxError extends Error {
    constructor(message, hint = DEFAULT_SYNTAX_HINT) {
        super(message);
        this.hint = hint;
    }
}

function syntaxError(message, hint) {
    throw new ExpressionSyntaxError(message, hint);
}

// ---------------------------------------------------------------- tokenizer

const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/y;
const NAME_START = /^[\p{ID_Start}$_]/u;
const NAME = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;

function isDigit(ch) {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

function hexValue(text, start, length) {
    const digits = text.slice(start, start + length);
    if (digits.length !== length || !/^[0-9a-fA-F]+$/.test(digits)) syntaxError('Invalid escape sequence in a string');
    return Number.parseInt(digits, 16);
}

// `i` points at the character after the backslash. Returns [text, nextIndex].
function readEscape(src, i) {
    const ch = src[i];
    switch (ch) {
        case 'n': return ['\n', i + 1];
        case 't': return ['\t', i + 1];
        case 'r': return ['\r', i + 1];
        case 'b': return ['\b', i + 1];
        case 'f': return ['\f', i + 1];
        case 'v': return ['\v', i + 1];
        case '0': return isDigit(src[i + 1]) ? ['0', i + 1] : ['\0', i + 1];
        case 'x': return [String.fromCharCode(hexValue(src, i + 1, 2)), i + 3];
        case 'u': {
            if (src[i + 1] === '{') {
                const close = src.indexOf('}', i);
                if (close < 0) syntaxError('Invalid escape sequence in a string');
                const code = Number.parseInt(src.slice(i + 2, close), 16);
                if (!(code <= 0x10ffff)) syntaxError('Invalid escape sequence in a string');
                return [String.fromCodePoint(code), close + 1];
            }
            return [String.fromCharCode(hexValue(src, i + 1, 4)), i + 5];
        }
        case '\r': return ['', src[i + 1] === '\n' ? i + 2 : i + 1];
        case '\n': return ['', i + 1];
        default: {
            const point = String.fromCodePoint(src.codePointAt(i));
            return [point, i + point.length];
        }
    }
}

function readString(src, start) {
    const quote = src[start];
    let value = '';
    let i = start + 1;
    while (i < src.length) {
        const ch = src[i];
        if (ch === quote) return { value, end: i + 1 };
        if (ch === '\n') break;
        if (ch === '\\') {
            const [text, next] = readEscape(src, i + 1);
            value += text;
            i = next;
        } else {
            value += ch;
            i++;
        }
    }
    return syntaxError('A string is not closed');
}

function readTemplate(src, start, depth) {
    const quasis = [];
    const expressions = [];
    let current = '';
    let i = start + 1;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '`') {
            quasis.push(current);
            return { quasis, expressions, end: i + 1 };
        }
        if (ch === '\\') {
            const [text, next] = readEscape(src, i + 1);
            current += text;
            i = next;
        } else if (ch === '$' && src[i + 1] === '{') {
            quasis.push(current);
            current = '';
            const inner = tokenize(src, i + 2, true, depth + 1);
            expressions.push(inner.tokens);
            i = inner.end + 1;
        } else {
            current += ch;
            i++;
        }
    }
    return syntaxError('A template literal is not closed');
}

function readRegex(src, start) {
    let i = start + 1;
    let inClass = false;
    while (i < src.length) {
        const ch = src[i];
        if (ch === '\n') break;
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
            const pattern = src.slice(start + 1, i);
            let end = i + 1;
            while (/[A-Za-z]/.test(src[end] ?? '')) end++;
            const flags = src.slice(i + 1, end);
            try {
                new RegExp(pattern, flags);
            } catch {
                syntaxError('Invalid regular expression');
            }
            return { pattern, flags, end };
        }
        i++;
    }
    return syntaxError('A regular expression is not closed');
}

function regexAllowed(tokens) {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.type === 'name') return KEYWORD_OPERATORS.has(last.value);
    if (last.type === 'punct') return last.value !== ')' && last.value !== ']' && last.value !== '}';
    return false;
}

// With `inTemplate`, stops at the `}` that closes `${` and returns its index in `end`.
function tokenize(src, start, inTemplate, depth) {
    if (depth > MAX_DEPTH) syntaxError('The expression is nested too deeply');
    const tokens = [];
    let braces = 0;
    let i = start;

    while (i < src.length) {
        const ch = src[i];

        if (/\s/u.test(ch)) {
            i++;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') {
            const end = src.indexOf('\n', i);
            i = end < 0 ? src.length : end + 1;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            if (end < 0) syntaxError('A comment is not closed');
            i = end + 2;
            continue;
        }

        if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
            NUMBER.lastIndex = i;
            const text = NUMBER.exec(src)[0];
            i += text.length;
            if (NAME_START.test(src[i] ?? '') || isDigit(src[i])) syntaxError('Invalid number');
            tokens.push({ type: 'number', value: Number(text.replaceAll('_', '')) });
            continue;
        }

        NAME.lastIndex = i;
        const name = NAME.exec(src);
        if (name) {
            tokens.push({ type: 'name', value: name[0] });
            i += name[0].length;
            continue;
        }

        if (ch === '"' || ch === "'") {
            const { value, end } = readString(src, i);
            tokens.push({ type: 'string', value });
            i = end;
            continue;
        }

        if (ch === '`') {
            const { quasis, expressions, end } = readTemplate(src, i, depth);
            tokens.push({ type: 'template', quasis, expressions });
            i = end;
            continue;
        }

        if (ch === '/' && regexAllowed(tokens)) {
            const { pattern, flags, end } = readRegex(src, i);
            tokens.push({ type: 'regex', pattern, flags });
            i = end;
            continue;
        }

        let punct = PUNCTUATORS.find((p) => src.startsWith(p, i));
        if (punct === '?.' && isDigit(src[i + 2])) punct = '?';
        if (!punct) syntaxError(`Unexpected character \`${ch}\``);

        if (inTemplate) {
            if (punct === '{') braces++;
            if (punct === '}') {
                if (braces === 0) return { tokens, end: i };
                braces--;
            }
        }
        tokens.push({ type: 'punct', value: punct });
        i += punct.length;
    }

    if (inTemplate) syntaxError('`${` in a template literal is not closed');
    return { tokens, end: i };
}

// ---------------------------------------------------------------- parser

function tokenText(token) {
    switch (token.type) {
        case 'punct':
        case 'name':
            return `\`${token.value}\``;
        case 'number':
            return `\`${token.value}\``;
        case 'string':
            return 'string';
        case 'template':
            return 'template literal';
        default:
            return 'regular expression';
    }
}

class Parser {
    constructor(tokens, depth = 0) {
        this.tokens = tokens;
        this.pos = 0;
        this.depth = depth;
    }

    parse() {
        const node = this.parseTernary();
        if (this.pos < this.tokens.length) this.unexpected(this.peek());
        return node;
    }

    peek(offset = 0) {
        return this.tokens[this.pos + offset];
    }

    isPunct(value, offset = 0) {
        const token = this.peek(offset);
        return token !== undefined && token.type === 'punct' && token.value === value;
    }

    isWord(value) {
        const token = this.peek();
        return token !== undefined && token.type === 'name' && token.value === value;
    }

    eat(value) {
        if (!this.isPunct(value)) return false;
        this.pos++;
        return true;
    }

    expect(value) {
        if (!this.eat(value)) this.unexpected(this.peek());
    }

    unexpected(token) {
        if (!token) syntaxError('The expression ends too early');
        if (token.type === 'punct' && token.value === '=') syntaxError('Assignment is not supported in expressions', ASSIGNMENT_HINT);
        if (token.type === 'name' && UNSUPPORTED_WORDS.has(token.value)) syntaxError(`\`${token.value}\` is not supported in expressions`);
        return syntaxError(`Unexpected ${tokenText(token)}`);
    }

    enter() {
        if (++this.depth > MAX_DEPTH) syntaxError('The expression is nested too deeply');
    }

    leave() {
        this.depth--;
    }

    isIdentifierToken(token) {
        return token !== undefined && token.type === 'name' && !UNSUPPORTED_WORDS.has(token.value) && !KEYWORD_OPERATORS.has(token.value) && token.value !== 'new';
    }

    isArrowStart() {
        if (this.isIdentifierToken(this.peek()) && this.isPunct('=>', 1)) return true;
        if (!this.isPunct('(')) return false;
        let level = 0;
        for (let i = this.pos; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            if (token.type !== 'punct') continue;
            if (token.value === '(') level++;
            if (token.value === ')' && --level === 0) {
                const after = this.tokens[i + 1];
                return after !== undefined && after.type === 'punct' && after.value === '=>';
            }
        }
        return false;
    }

    parsePattern() {
        const token = this.peek();
        if (this.eat('[')) {
            const elements = [];
            while (!this.isPunct(']')) {
                elements.push(this.parsePattern());
                if (!this.eat(',')) break;
            }
            this.expect(']');
            return { type: 'ArrayPattern', elements };
        }
        if (this.eat('{')) {
            const props = [];
            while (!this.isPunct('}')) {
                const key = this.peek();
                if (!key || (key.type !== 'name' && key.type !== 'string')) this.unexpected(key);
                this.pos++;
                const value = this.eat(':') ? this.parsePattern() : { type: 'Identifier', name: key.value };
                props.push({ key: key.value, value });
                if (!this.eat(',')) break;
            }
            this.expect('}');
            return { type: 'ObjectPattern', props };
        }
        if (!this.isIdentifierToken(token)) this.unexpected(token);
        this.pos++;
        return { type: 'Identifier', name: token.value };
    }

    parseArrow() {
        const params = [];
        if (this.eat('(')) {
            while (!this.isPunct(')')) {
                params.push(this.parsePattern());
                if (!this.eat(',')) break;
            }
            this.expect(')');
        } else {
            params.push(this.parsePattern());
        }
        this.expect('=>');
        if (this.isPunct('{')) {
            syntaxError('An arrow function needs an expression body', 'Write `x => x.title`. To return an object, wrap it in parentheses: `x => ({ a: x })`.');
        }
        return { type: 'Arrow', params, body: this.parseTernary() };
    }

    parseTernary() {
        this.enter();
        try {
            if (this.isArrowStart()) return this.parseArrow();
            const test = this.parseBinary(1);
            if (this.isPunct('=') && test.type === 'Member') {
                this.pos++;
                return { type: 'Assign', target: test, value: this.parseTernary() };
            }
            if (!this.eat('?')) return test;
            const consequent = this.parseTernary();
            this.expect(':');
            const alternate = this.parseTernary();
            return { type: 'Conditional', test, consequent, alternate };
        } finally {
            this.leave();
        }
    }

    binaryOperator() {
        const token = this.peek();
        if (!token) return null;
        if (token.type === 'punct' && Object.hasOwn(BINARY_PRECEDENCE, token.value)) return token.value;
        if (token.type === 'name' && token.value === 'in') return 'in';
        return null;
    }

    parseBinary(minPrecedence) {
        let left = this.parseUnary();
        for (;;) {
            const op = this.binaryOperator();
            if (!op) return left;
            const precedence = BINARY_PRECEDENCE[op];
            if (precedence < minPrecedence) return left;
            this.pos++;
            const right = this.parseBinary(op === '**' ? precedence : precedence + 1);
            const logical = op === '&&' || op === '||' || op === '??';
            left = { type: logical ? 'Logical' : 'Binary', op, left, right };
        }
    }

    parseUnary() {
        const token = this.peek();
        if (this.isWord('delete')) {
            this.pos++;
            const target = this.parseUnary();
            if (target.type !== 'Member') syntaxError('`delete` needs a property, e.g. `delete post.title`', ASSIGNMENT_HINT);
            return { type: 'Delete', target };
        }
        const isOperator =
            token !== undefined &&
            ((token.type === 'punct' && ['!', '-', '+', '~'].includes(token.value)) || (token.type === 'name' && (token.value === 'typeof' || token.value === 'void')));
        if (!isOperator) return this.parsePostfix();
        this.pos++;
        this.enter();
        try {
            return { type: 'Unary', op: token.value, argument: this.parseUnary() };
        } finally {
            this.leave();
        }
    }

    propertyName() {
        const token = this.peek();
        if (!token || token.type !== 'name') this.unexpected(token);
        this.pos++;
        return token.value;
    }

    parseArguments() {
        const args = [];
        while (!this.isPunct(')')) {
            args.push(this.parseElement());
            if (!this.eat(',')) break;
        }
        this.expect(')');
        return args;
    }

    parseElement() {
        if (this.eat('...')) return { type: 'Spread', argument: this.parseTernary() };
        return this.parseTernary();
    }

    parseNew() {
        this.pos++;
        let callee = this.parsePrimary();
        for (;;) {
            if (this.eat('.')) {
                callee = { type: 'Member', object: callee, key: this.propertyName(), computed: false, optional: false };
            } else if (this.eat('[')) {
                const property = this.parseTernary();
                this.expect(']');
                callee = { type: 'Member', object: callee, property, computed: true, optional: false };
            } else {
                break;
            }
        }
        const args = this.eat('(') ? this.parseArguments() : [];
        return { type: 'New', callee, args };
    }

    parsePostfix() {
        let node = this.isWord('new') ? this.parseNew() : this.parsePrimary();
        let hasOptional = false;
        for (;;) {
            if (this.eat('.')) {
                node = { type: 'Member', object: node, key: this.propertyName(), computed: false, optional: false };
            } else if (this.eat('?.')) {
                hasOptional = true;
                if (this.eat('(')) {
                    node = { type: 'Call', callee: node, args: this.parseArguments(), optional: true };
                } else if (this.eat('[')) {
                    const property = this.parseTernary();
                    this.expect(']');
                    node = { type: 'Member', object: node, property, computed: true, optional: true };
                } else {
                    node = { type: 'Member', object: node, key: this.propertyName(), computed: false, optional: true };
                }
            } else if (this.eat('[')) {
                const property = this.parseTernary();
                this.expect(']');
                node = { type: 'Member', object: node, property, computed: true, optional: false };
            } else if (this.eat('(')) {
                node = { type: 'Call', callee: node, args: this.parseArguments(), optional: false };
            } else if (this.peek()?.type === 'template') {
                return syntaxError('Tagged templates are not supported in expressions');
            } else {
                break;
            }
        }
        return hasOptional ? { type: 'Chain', expression: node } : node;
    }

    parseObject() {
        const props = [];
        while (!this.isPunct('}')) {
            if (this.eat('...')) {
                props.push({ kind: 'spread', argument: this.parseTernary() });
            } else if (this.eat('[')) {
                const keyNode = this.parseTernary();
                this.expect(']');
                this.expect(':');
                props.push({ kind: 'prop', keyNode, value: this.parseTernary() });
            } else {
                const token = this.peek();
                if (!token || !['name', 'string', 'number'].includes(token.type)) this.unexpected(token);
                this.pos++;
                const key = String(token.value);
                if (this.eat(':')) {
                    props.push({ kind: 'prop', key, value: this.parseTernary() });
                } else if (token.type === 'name' && (this.isPunct(',') || this.isPunct('}'))) {
                    props.push({ kind: 'prop', key, value: { type: 'Identifier', name: key } });
                } else {
                    this.unexpected(this.peek());
                }
            }
            if (!this.eat(',')) break;
        }
        this.expect('}');
        return { type: 'Object', props };
    }

    parsePrimary() {
        const token = this.peek();
        if (!token) this.unexpected(token);

        switch (token.type) {
            case 'number':
            case 'string':
                this.pos++;
                return { type: 'Literal', value: token.value };
            case 'template':
                this.pos++;
                return {
                    type: 'Template',
                    quasis: token.quasis,
                    expressions: token.expressions.map((tokens) => new Parser(tokens, this.depth).parse()),
                };
            case 'regex':
                this.pos++;
                return { type: 'Regex', pattern: token.pattern, flags: token.flags };
            case 'name':
                if (token.value === 'true' || token.value === 'false') {
                    this.pos++;
                    return { type: 'Literal', value: token.value === 'true' };
                }
                if (token.value === 'null') {
                    this.pos++;
                    return { type: 'Literal', value: null };
                }
                if (!this.isIdentifierToken(token)) this.unexpected(token);
                this.pos++;
                return { type: 'Identifier', name: token.value };
            default:
                break;
        }

        if (this.eat('(')) {
            const inner = this.parseTernary();
            this.expect(')');
            return inner;
        }
        if (this.eat('[')) {
            const elements = [];
            while (!this.isPunct(']')) {
                elements.push(this.parseElement());
                if (!this.eat(',')) break;
            }
            this.expect(']');
            return { type: 'Array', elements };
        }
        if (this.eat('{')) return this.parseObject();
        return this.unexpected(token);
    }
}

function parseExpression(code) {
    const { tokens } = tokenize(code, 0, false, 0);
    return new Parser(tokens).parse();
}

// ---------------------------------------------------------------- evaluator

const SHORT_CIRCUIT = Symbol('short-circuit');
const NOT_FOUND = Symbol('not-found');

function ownerText(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'Member' && !node.computed) {
        const owner = ownerText(node.object);
        return owner === null ? null : `${owner}${node.optional ? '?.' : '.'}${node.key}`;
    }
    return null;
}

function isBlocked(name) {
    return typeof name === 'string' && (BLOCKED_NAMES.has(name) || name.startsWith('__'));
}

function fail(ctx, message, hint) {
    throw new AloError({ ...ctx.location, message, hint: hint ?? `Expression: \`${ctx.code}\`` });
}

function lookup(name, env, ctx) {
    for (let scope = env; scope; scope = scope.parent) {
        if (scope.vars.has(name)) return scope.vars.get(name);
    }
    if (Object.hasOwn(ctx.scope, name)) return ctx.scope[name];
    if (Object.hasOwn(GLOBALS, name)) return GLOBALS[name];
    return NOT_FOUND;
}

function notDefined(name, ctx) {
    const names = Object.keys(ctx.scope);
    const close = suggest(name, names);
    const available = names.map((item) => `\`${item}\``).join(', ');
    return fail(ctx, `\`${name}\` is not defined.`, (close ? `Did you mean \`${close}\`? ` : '') + `Available here: ${available}.`);
}

function getProperty(object, key, ctx) {
    const name = typeof key === 'number' ? key : String(key);
    if (isBlocked(name)) fail(ctx, `Reading \`${name}\` is not allowed in expressions.`, 'Expressions can only read plain data and call safe methods.');
    return object[name];
}

function emptyRead(node, object, ctx) {
    const empty = object === null ? 'null' : 'undefined';
    const property = node.computed ? null : node.key;
    if (property === null) fail(ctx, `Cannot read a property of \`${empty}\`.`, 'If the value may be missing, use `?.`. In a component, check that the prop is passed.');
    const owner = ownerText(node.object);
    return fail(
        ctx,
        owner ? `\`${owner}\` is \`${empty}\`, so \`.${property}\` cannot be read.` : `Cannot read \`.${property}\` of \`${empty}\`.`,
        `If the value may be missing, use \`?.\`, e.g. \`${owner ?? 'x'}?.${property}\`. In a component, check that the prop is passed.`,
    );
}

function bindPattern(pattern, value, env, ctx) {
    if (pattern.type === 'Identifier') {
        env.vars.set(pattern.name, value);
    } else if (pattern.type === 'ArrayPattern') {
        const items = [...value];
        pattern.elements.forEach((element, index) => bindPattern(element, items[index], env, ctx));
    } else {
        if (value === null || value === undefined) fail(ctx, `Cannot take values out of \`${value}\`.`);
        for (const { key, value: target } of pattern.props) {
            bindPattern(target, getProperty(value, key, ctx), env, ctx);
        }
    }
}

function evaluateArguments(list, env, ctx) {
    const values = [];
    for (const item of list) {
        if (item.type === 'Spread') values.push(...evaluateNode(item.argument, env, ctx));
        else values.push(evaluateNode(item, env, ctx));
    }
    return values;
}

function binary(op, a, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '**': return a ** b;
        case '==': return a == b; // eslint-disable-line eqeqeq
        case '!=': return a != b; // eslint-disable-line eqeqeq
        case '===': return a === b;
        case '!==': return a !== b;
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        case '>=': return a >= b;
        case '<<': return a << b;
        case '>>': return a >> b;
        case '>>>': return a >>> b;
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        default: return a in b;
    }
}

function evaluateCall(node, env, ctx) {
    const callee = node.callee;
    let target;
    let fn;

    if (callee.type === 'Member') {
        target = evaluateNode(callee.object, env, ctx);
        if (target === null || target === undefined) {
            if (callee.optional) throw SHORT_CIRCUIT;
            emptyRead(callee, target, ctx);
        }
        fn = getProperty(target, callee.computed ? evaluateNode(callee.property, env, ctx) : callee.key, ctx);
    } else {
        fn = evaluateNode(callee, env, ctx);
    }

    if (node.optional && (fn === null || fn === undefined)) throw SHORT_CIRCUIT;
    if (typeof fn !== 'function') {
        const owner = ownerText(callee);
        fail(ctx, `${owner ? `\`${owner}\`` : 'This value'} is not a function.`);
    }
    if (FUNCTION_CONSTRUCTORS.has(fn)) fail(ctx, 'This function is not allowed in expressions.');
    return Reflect.apply(fn, target, evaluateArguments(node.args, env, ctx));
}

function evaluateObject(node, env, ctx) {
    const result = {};
    for (const prop of node.props) {
        if (prop.kind === 'spread') {
            const source = evaluateNode(prop.argument, env, ctx);
            for (const key of Object.keys(Object(source))) {
                if (isBlocked(key)) fail(ctx, `Using \`${key}\` is not allowed in expressions.`);
                result[key] = source[key];
            }
            continue;
        }
        const key = prop.keyNode ? String(evaluateNode(prop.keyNode, env, ctx)) : prop.key;
        if (isBlocked(key)) fail(ctx, `Using \`${key}\` is not allowed in expressions.`);
        result[key] = evaluateNode(prop.value, env, ctx);
    }
    return result;
}

function evaluateNode(node, env, ctx) {
    switch (node.type) {
        case 'Literal':
            return node.value;
        case 'Identifier': {
            const value = lookup(node.name, env, ctx);
            return value === NOT_FOUND ? notDefined(node.name, ctx) : value;
        }
        case 'Template': {
            let text = node.quasis[0];
            node.expressions.forEach((expression, index) => {
                text += String(evaluateNode(expression, env, ctx)) + node.quasis[index + 1];
            });
            return text;
        }
        case 'Regex':
            return new RegExp(node.pattern, node.flags);
        case 'Array': {
            const result = [];
            for (const element of node.elements) {
                if (element.type === 'Spread') result.push(...evaluateNode(element.argument, env, ctx));
                else result.push(evaluateNode(element, env, ctx));
            }
            return result;
        }
        case 'Object':
            return evaluateObject(node, env, ctx);
        case 'Unary': {
            if (node.op === 'typeof' && node.argument.type === 'Identifier' && lookup(node.argument.name, env, ctx) === NOT_FOUND) return 'undefined';
            const value = evaluateNode(node.argument, env, ctx);
            switch (node.op) {
                case '!': return !value;
                case '-': return -value;
                case '+': return +value;
                case '~': return ~value;
                case 'typeof': return typeof value;
                default: return undefined;
            }
        }
        case 'Binary':
            return binary(node.op, evaluateNode(node.left, env, ctx), evaluateNode(node.right, env, ctx));
        case 'Logical': {
            const left = evaluateNode(node.left, env, ctx);
            if (node.op === '&&') return left ? evaluateNode(node.right, env, ctx) : left;
            if (node.op === '||') return left ? left : evaluateNode(node.right, env, ctx);
            return left ?? evaluateNode(node.right, env, ctx);
        }
        case 'Conditional':
            return evaluateNode(node.test, env, ctx) ? evaluateNode(node.consequent, env, ctx) : evaluateNode(node.alternate, env, ctx);
        case 'Member': {
            const object = evaluateNode(node.object, env, ctx);
            if (object === null || object === undefined) {
                if (node.optional) throw SHORT_CIRCUIT;
                emptyRead(node, object, ctx);
            }
            return getProperty(object, node.computed ? evaluateNode(node.property, env, ctx) : node.key, ctx);
        }
        case 'Call':
            return evaluateCall(node, env, ctx);
        case 'New': {
            const constructor = evaluateNode(node.callee, env, ctx);
            if (!ALLOWED_CONSTRUCTORS.has(constructor)) {
                const owner = ownerText(node.callee);
                fail(ctx, `${owner ? `\`new ${owner}\`` : '`new`'} is not allowed in expressions.`, 'Allowed: `new Date`, `new RegExp`, `new Map`, `new Set`, `new Array` and the `new Intl.*` formatters.');
            }
            return Reflect.construct(constructor, evaluateArguments(node.args, env, ctx));
        }
        case 'Assign':
        case 'Delete': {
            const target = node.target;
            const object = evaluateNode(target.object, env, ctx);
            if (object === null || object === undefined) emptyRead(target, object, ctx);
            const key = target.computed ? evaluateNode(target.property, env, ctx) : target.key;
            const name = typeof key === 'number' ? key : String(key);
            if (isBlocked(name)) fail(ctx, `Changing \`${name}\` is not allowed in expressions.`);
            if (node.type === 'Delete') return delete object[name];
            const value = evaluateNode(node.value, env, ctx);
            object[name] = value;
            return value;
        }
        case 'Chain':
            try {
                return evaluateNode(node.expression, env, ctx);
            } catch (err) {
                if (err === SHORT_CIRCUIT) return undefined;
                throw err;
            }
        case 'Arrow':
            return (...args) => {
                const inner = { vars: new Map(), parent: env };
                node.params.forEach((param, index) => bindPattern(param, args[index], inner, ctx));
                return evaluateNode(node.body, inner, ctx);
            };
        default:
            return fail(ctx, 'This kind of expression is not supported.');
    }
}

// ---------------------------------------------------------------- public

function compileExpression(code, location) {
    let ast = cache.get(code);
    if (ast) return ast;

    try {
        ast = parseExpression(code);
    } catch (err) {
        if (!(err instanceof ExpressionSyntaxError)) throw err;
        throw new AloError({
            ...location,
            message: `Cannot parse the expression \`${code}\``,
            hint: `${err.message}. ${err.hint}`,
        });
    }
    cache.set(code, ast);
    return ast;
}

// location: { file, line, column, source } — used only for error messages.
function evaluate(code, scope, location) {
    const ast = compileExpression(code, location);
    const ctx = { code, scope, location };

    try {
        return evaluateNode(ast, null, ctx);
    } catch (err) {
        if (err instanceof AloError) {
            // Errors raised deep inside data proxies do not know where the expression is.
            if (!err.file) Object.assign(err, location);
            throw err;
        }

        const unreadable = err instanceof TypeError && /^Cannot read properties of (undefined|null) \(reading '(.+)'\)$/.exec(err.message);
        if (unreadable) {
            const [, empty, property] = unreadable;
            throw new AloError({
                ...location,
                message: `Cannot read \`.${property}\` of \`${empty}\`.`,
                hint: `If the value may be missing, use \`?.\`, e.g. \`x?.${property}\`. In a component, check that the prop is passed.`,
            });
        }

        if (err instanceof TypeError && FROZEN_WRITE.test(err.message)) {
            throw new AloError({
                ...location,
                message: `Data cannot be changed: \`${code}\``,
                hint: 'Make a new value instead: use `toReversed()`, `toSorted()` or `slice()`.',
            });
        }

        throw new AloError({
            ...location,
            message: `Error while evaluating an expression: ${err.message}`,
            hint: `Expression: \`${code}\``,
        });
    }
}

module.exports = { evaluate };
