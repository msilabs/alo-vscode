'use strict';

// Must run before anything else is required, using syntax old Node versions can parse.
const MIN_NODE_MAJOR = 22;
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
    process.stderr.write(
        '✖ Error: Alo needs Node.js ' + MIN_NODE_MAJOR + ' or newer. ' +
            'You have v' + process.versions.node + '.\n\n' +
            '  Hint: install a current LTS version from https://nodejs.org\n',
    );
    process.exit(1);
}

const { AloError, suggest } = require('../core/errors.js');
const log = require('./log.js');
const { version } = require('../package.json');

const COMMANDS = ['init', 'dev', 'build', 'new'];
const FLAGS_BY_COMMAND = {
    init: [],
    dev: ['port', 'base'],
    build: ['base'],
    new: [],
};
const VALUE_FLAGS = ['port', 'base'];

const HELP = `Alo — a lightweight static web framework (v${version})

Usage:
  alo init [folder]                  create a new project
  alo dev [--port 3000] [--base /]   dev server with live reload
  alo build [--base /]               production build into dist/
  alo new page blog/first-post       pages/blog/first-post/page.alo
  alo new layout blog                pages/blog/layout.alo
  alo new component blog/PostCard    components/blog/PostCard.alo
  alo new post blog/hello-world      data/blog/<today's date>-hello-world.md
  alo --help                         show this help
  alo --version                      show the version

Inside a project, run: node alo <command>`;

function parseArgs(argv) {
    const positionals = [];
    const flags = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--help') {
            flags.help = true;
            continue;
        }
        if (arg === '--version') {
            flags.version = true;
            continue;
        }
        if (!arg.startsWith('-')) {
            positionals.push(arg);
            continue;
        }

        let name = arg.replace(/^-+/, '');
        let value;
        const equals = name.indexOf('=');
        if (equals !== -1) {
            value = name.slice(equals + 1);
            name = name.slice(0, equals);
        }

        if (!VALUE_FLAGS.includes(name)) {
            const close = suggest(name, [...VALUE_FLAGS, 'help', 'version']);
            throw new AloError({
                message: `Unknown flag \`${arg}\`.`,
                hint: close
                    ? `Did you mean \`--${close}\`?`
                    : 'Alo only has `--port` and `--base`. Run `alo --help` for everything.',
            });
        }

        if (value === undefined) {
            value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) {
                throw new AloError({
                    message: `\`--${name}\` needs a value.`,
                    hint: name === 'port' ? 'For example: `--port 3000`' : 'For example: `--base /my-repo/`',
                });
            }
            i++;
        }
        flags[name] = value;
    }

    return { positionals, flags };
}

function validateFlags(command, flags) {
    for (const name of VALUE_FLAGS) {
        if (flags[name] === undefined) continue;
        if (!FLAGS_BY_COMMAND[command].includes(name)) {
            throw new AloError({
                message: `\`--${name}\` does not work with \`alo ${command}\`.`,
                hint:
                    name === 'port'
                        ? '`--port` only works with `alo dev`.'
                        : '`--base` only works with `alo dev` and `alo build`.',
            });
        }
    }

    if (flags.port !== undefined) {
        const port = Number(flags.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new AloError({
                message: `Invalid \`--port\` value \`${flags.port}\`.`,
                hint: 'Use a whole number from 1 to 65535, e.g. `--port 3000`.',
            });
        }
        flags.port = port;
    }
}

async function runCommand(command, args, flags) {
    if (command === 'build') {
        const { build } = require('./build.js');
        await build({ root: process.cwd(), base: flags.base ?? '/' });
        return;
    }
    if (command === 'init') {
        require('./scaffold.js').init(process.cwd(), args[0]);
        return;
    }
    if (command === 'new') {
        require('./scaffold.js').create(process.cwd(), args);
        return;
    }
    if (command === 'dev') {
        const { startDevServer } = require('./dev-server.js');
        const server = await startDevServer({ root: process.cwd(), port: flags.port ?? 3000, base: flags.base ?? '/' });
        const stop = () => server.close().then(() => process.exit(0));
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        return;
    }
    throw new AloError({ message: `Unknown command \`alo ${command}\`.` });
}

async function main(argv) {
    const { positionals, flags } = parseArgs(argv);

    if (flags.version) {
        log.info(version);
        return;
    }

    const [command] = positionals;
    if (flags.help || command === undefined) {
        log.info(HELP);
        return;
    }

    if (!COMMANDS.includes(command)) {
        const close = suggest(command, COMMANDS);
        throw new AloError({
            message: `Unknown command \`${command}\`.`,
            hint: close
                ? `Did you mean \`alo ${close}\`? Run \`alo --help\` for all commands.`
                : 'Run `alo --help` for all commands.',
        });
    }

    validateFlags(command, flags);
    await runCommand(command, positionals.slice(1), flags);
}

main(process.argv.slice(2)).catch((err) => {
    if (err instanceof AloError) {
        log.error(err);
    } else {
        log.bug(err);
    }
    process.exitCode = 1;
});
