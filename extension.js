'use strict';

const vscode = require('vscode');

function activate(context) {
    const hello = vscode.commands.registerCommand('alo.hello', () => {
        vscode.window.showInformationMessage('আলো এক্সটেনশন চালু আছে!');
    });

    context.subscriptions.push(hello);
}

function deactivate() {}

module.exports = { activate, deactivate };
