'use strict';

// Runs test/editor/index.js inside a separate, throwaway VS Code with this extension loaded:
//
//   node test/editor/run.js                    clean settings
//   node test/editor/run.js --user-settings    with a copy of your own settings.json
//   node test/editor/run.js --alo-as-html      a project whose settings open .alo files as HTML,
//                                              as `alo init` writes them
//   --restricted                               (with any of the above) opens the folder untrusted,
//                                              in Restricted Mode
//
// Needs VS Code on macOS at the default place (or set VSCODE_BIN) and the `alo` repo next to this one.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// Kept short on purpose: VS Code's socket path inside the user data folder must stay under 103 characters.
const TEMP = path.join(ROOT, '.vscode-test');
const WORKSPACE = path.join(TEMP, 'ws');
const USER_DATA = path.join(TEMP, 'ud');
const RESULTS = path.join(TEMP, 'results.txt');
const EXAMPLE = path.resolve(ROOT, '..', 'alo', 'example');
const CODE = process.env.VSCODE_BIN || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const USER_SETTINGS = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');

// Every run starts from a fresh copy of Alo's example, so tests never touch the real files.
for (const dir of [WORKSPACE, USER_DATA]) fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(RESULTS, { force: true });
fs.cpSync(EXAMPLE, WORKSPACE, {
    recursive: true,
    filter: (source) => !/[\\/](dist|\.alo|node_modules|\.DS_Store)$/.test(source),
});

const ALO_AS_HTML = process.argv.includes('--alo-as-html');
if (ALO_AS_HTML) {
    fs.mkdirSync(path.join(WORKSPACE, '.vscode'), { recursive: true });
    fs.writeFileSync(
        path.join(WORKSPACE, '.vscode', 'settings.json'),
        JSON.stringify({ 'files.associations': { '*.alo': 'html', '*.foo': 'bar' } }, null, 4),
    );
}

if (process.argv.includes('--user-settings')) {
    fs.mkdirSync(path.join(USER_DATA, 'User'), { recursive: true });
    fs.copyFileSync(USER_SETTINGS, path.join(USER_DATA, 'User', 'settings.json'));
}

// Only HOME and PATH are passed on. Variables from a running VS Code (or its terminal) would make
// this instance act as plain Node or join the running window instead of starting its own.
spawnSync(
    CODE,
    [
        `--extensionDevelopmentPath=${ROOT}`,
        `--extensionTestsPath=${path.join(__dirname, 'index.js')}`,
        `--user-data-dir=${USER_DATA}`,
        `--extensions-dir=${path.join(TEMP, 'extensions')}`,
        // `--restricted` keeps Workspace Trust on, so the folder opens in Restricted Mode like a new download.
        ...(process.argv.includes('--restricted') ? [] : ['--disable-workspace-trust']),
        '--skip-welcome',
        '--skip-release-notes',
        WORKSPACE,
    ],
    { env: { HOME: process.env.HOME, PATH: process.env.PATH, ALO_TEST_SCENARIO: ALO_AS_HTML ? 'alo-as-html' : process.argv.includes('--restricted') ? 'restricted' : '' }, stdio: 'ignore' },
);

const results = fs.existsSync(RESULTS) ? fs.readFileSync(RESULTS, 'utf8') : 'ERROR no results: VS Code did not run the tests\n';
process.stdout.write(results);
const failed = /^(FAIL|ERROR)/m.test(results) || !results.includes('\nDONE');
process.exit(failed ? 1 : 0);
