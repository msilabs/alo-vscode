'use strict';

const { formatDiagnostic } = require('../core/errors.js');

const COLORS = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
};

function useColor(stream) {
    if (process.env.NO_COLOR) return false;
    return Boolean(stream.isTTY);
}

function paint(stream, color, text) {
    if (!useColor(stream)) return text;
    return COLORS[color] + text + COLORS.reset;
}

function printDiagnostic(icon, label, color, diagnostic, source) {
    const stream = process.stderr;
    const [location, ...rest] = formatDiagnostic(diagnostic, source);
    const header = location ? `${icon} ${label}: ${location}` : `${icon} ${label}:`;
    stream.write(paint(stream, color, header) + '\n' + rest.join('\n') + '\n\n');
}

function error(diagnostic, source) {
    printDiagnostic('✖', 'Error', 'red', diagnostic, source);
}

function warn(diagnostic, source) {
    printDiagnostic('⚠', 'Warning', 'yellow', diagnostic, source);
}

function bug(err) {
    const stream = process.stderr;
    stream.write(paint(stream, 'red', '✖ Unexpected error (probably a bug in Alo):') + '\n');
    stream.write(String(err && err.stack ? err.stack : err) + '\n');
}

function info(message) {
    process.stdout.write(message + '\n');
}

function success(message) {
    process.stdout.write(paint(process.stdout, 'green', '✔ ' + message) + '\n');
}

function dim(message) {
    process.stdout.write(paint(process.stdout, 'dim', message) + '\n');
}

module.exports = { error, warn, bug, info, success, dim };
