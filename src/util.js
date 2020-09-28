const util = require('util');
const {pick} = require('lodash');

function noop() {
    return undefined;
}

function dump(obj) {
    console.log(util.inspect(obj, {depth: 6, showHidden: false}));
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

module.exports = {noop, dump, sleep, trimAxiosVerbosity};
