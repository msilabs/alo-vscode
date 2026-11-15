'use strict';

// Only these variables reach `alo dev` and `alo build`: what Node and the OS need to run, and
// `alo`'s own setting. Tokens and other secrets in the editor's environment stay out.
const PASSED_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];

function childEnv() {
    const env = { ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' };
    for (const name of PASSED_ENV) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    return env;
}

module.exports = { childEnv };
