'use strict';

// The `files.associations` keys that open `.alo` files as some other language,
// like `"*.alo": "html"`, which `alo init` writes for editors without this extension.
function conflictingKeys(associations) {
    if (!associations || typeof associations !== 'object') return [];
    return Object.keys(associations).filter((key) => /\.alo$/i.test(key) && associations[key] !== 'alo');
}

// A copy of `associations` without those keys, or undefined when nothing is left,
// so that an empty `files.associations` is removed from the settings file entirely.
function withoutKeys(associations, keys) {
    const rest = Object.fromEntries(Object.entries(associations).filter(([key]) => !keys.includes(key)));
    return Object.keys(rest).length > 0 ? rest : undefined;
}

module.exports = { conflictingKeys, withoutKeys };
