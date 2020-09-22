const util = require('util');

function noop() {
    return undefined;
}

function dump(obj) {
    console.log(util.inspect(obj, {depth: 5, showHidden: false}));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {noop, dump, sleep};
