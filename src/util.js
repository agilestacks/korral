const util = require('util');
const {pick} = require('lodash');

function noop() {
    return undefined;
}

function dump(obj) {
    console.log(util.inspect(obj, {depth: 10, showHidden: false}));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function trimAxiosVerbosity(error) {
    if (error.isAxiosError) {
        return pick(error, ['message', 'reason', 'code',
            'config.url', 'config.baseURL', 'config.timeout',
            'request.method', 'request.path',
            'response.status', 'response.statusText', 'response.data']);
    }
    return error;
}

function basename(uri) {
    const i = uri.lastIndexOf('/');
    if (i > 0 && i < uri.length - 1) return uri.substr(1 + i);
    return uri;
}

function path(uri) {
    const i = uri.indexOf('://');
    if (i > 0 && i < uri.length - 3) return uri.substr(3 + i);
    return uri;
}

module.exports = {noop, dump, sleep, trimAxiosVerbosity, basename, path};
