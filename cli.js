const {difference, isEmpty} = require('lodash');

function usage(code = 1) {
    console.log(`Usage: korral [--help] [--context=<context>] [--debug] [--trace] <command>

Print cluster cost:
    korral print

Push cluster cost metrics to SuperHub Metrics Service:
    korral push [--interval=60] [--endpoint=https://api.superhub.io]

*not implemented* Expose cluster cost metrics over HTTP in Prometheus format:
    korral expose [--interval=60] [--port=8005]
`);
    process.exit(code);
}

function parseArgs() {
    const known = ['print', 'push', 'expose',
        'debug', 'trace', 'help',
        'context', 'interval', 'endpoint', 'port'];
    const argv = [];
    const opts = {};
    process.argv.slice(2).forEach((arg) => {
        if (arg.startsWith('--')) {
            const [k, v = true] = arg.replace(/^--/, '').split('=');
            opts[k] = v;
        } else {
            argv.push(arg);
        }
    });
    const extra = difference(Object.keys(opts).concat(argv), known);
    if (extra.length) {
        console.log(`error: unknown command-line argument: ${extra.join(' ')}`);
        usage();
    }
    if (opts.help) usage(0);
    if (opts.trace) opts.debug = true;
    return {argv, opts};
}

function defaultConfig({argv, opts}) {
    return {
        argv: isEmpty(argv) ? ['print'] : argv,
        opts: {
            endpoint: process.env.HUB_API || 'https://api.superhub.io',
            interval: '60',
            port: '8005',
            ...opts
        }
    };
}

module.exports = {parseArgs, defaultConfig};
