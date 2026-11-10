'use strict';

const { spawn } = require('child_process');
const vscode = require('vscode');

// Runs Alo's CLI (`alo dev`, `alo build`) for a project in a terminal panel of its own.
// VS Code's own Node runs it (ELECTRON_RUN_AS_NODE), so nothing has to be installed.
//
// It is a Pseudoterminal: this extension owns the terminal, writes the process output into it,
// and can read that output, e.g. to find the dev server's URL.
function runAlo({ name, core, root, args, onOutput, onExit }) {
    const write = new vscode.EventEmitter();
    const close = new vscode.EventEmitter();
    let child = null;
    let exited = false;

    const pty = {
        onDidWrite: write.event,
        onDidClose: close.event,
        open() {
            child = spawn(process.execPath, [core.bin, ...args], {
                cwd: root,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
            });
            write.fire(`> alo ${args.join(' ')}\r\n\r\n`);
            const show = (data) => {
                const text = data.toString();
                // A terminal needs \r\n to start a new line at the left edge.
                write.fire(text.replace(/\r?\n/g, '\r\n'));
                onOutput?.(text);
            };
            child.stdout.on('data', show);
            child.stderr.on('data', show);
            child.on('error', (err) => write.fire(`\r\n${err.message}\r\n`));
            child.on('exit', (code) => {
                exited = true;
                write.fire(`\r\n[alo ${args[0]} stopped${code ? ` with code ${code}` : ''}]\r\n`);
                onExit?.(code ?? 0);
            });
        },
        // Closing the terminal panel stops the process.
        close() {
            if (child && !exited) child.kill();
        },
        // Ctrl+C in the terminal.
        handleInput(data) {
            if (data === '\x03' && child && !exited) child.kill('SIGINT');
        },
    };

    const terminal = vscode.window.createTerminal({ name, pty, iconPath: new vscode.ThemeIcon('flame') });
    terminal.show(true);
    return {
        terminal,
        stop() {
            if (child && !exited) child.kill();
        },
    };
}

module.exports = { runAlo };
