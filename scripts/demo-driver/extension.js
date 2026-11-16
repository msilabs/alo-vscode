'use strict';

// Plays one README demo, chosen by scripts/screenshots.sh, using VS Code's own commands instead of key presses.
// It talks to the script through files in ALO_SHOTS_DIR: it writes `ready`, waits for `go`, then writes `done`.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args) => vscode.commands.executeCommand(command, args);

async function typeSlowly(text) {
    for (const char of text) {
        await run('type', { text: char });
        await sleep(130);
    }
}

function moveTo(line, character) {
    const editor = vscode.window.activeTextEditor;
    const position = new vscode.Position(line - 1, character - 1);
    editor.selection = new vscode.Selection(position, position);
}

const scenes = {
    async overview() {
        moveTo(11, 9);
        await run('type', { text: '<' });
        await sleep(2500);
    },

    async data() {
        moveTo(11, 9);
        await sleep(800);
        await typeSlowly('{{');
        await sleep(400);
        await typeSlowly('data.');
        await sleep(2000);
        await typeSlowly('site.');
        await sleep(2500);
        await typeSlowly('na');
        await sleep(800);
        await run('acceptSelectedSuggestion');
        await sleep(2000);
    },

    async quickFix() {
        moveTo(8, 11);
        await sleep(1200);
        await run('editor.action.quickFix');
        await sleep(2000);
        await run('acceptSelectedCodeAction');
        await sleep(2500);
    },
};

async function activate() {
    const dir = process.env.ALO_SHOTS_DIR;
    if (!dir) return;
    const scene = scenes[fs.readFileSync(path.join(dir, 'scene'), 'utf8').trim()];

    while (!vscode.window.activeTextEditor?.document.fileName.endsWith('page.alo')) await sleep(200);
    // give Alo time to check the page and show its errors
    await sleep(4000);
    fs.writeFileSync(path.join(dir, 'ready'), '');

    while (!fs.existsSync(path.join(dir, 'go'))) await sleep(100);
    await scene();
    fs.writeFileSync(path.join(dir, 'done'), '');
}

module.exports = { activate };
