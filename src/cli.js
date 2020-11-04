const {difference, isEmpty} = require('lodash');

function usage(code = 1) {
    console.log(`Usage: korral [--help] [--context=<context>] [--cloud=aws|gcp|azure] [--debug] [--trace] <command>

Print cluster cost:
    korral print [--namespaces]

Push cluster cost metrics to SuperHub Metrics Service:
    korral push [--interval=60] [--endpoint=https://api.superhub.io] [--key=$METRICS_API_SECRET]

Export cluster cost metrics over HTTP in Prometheus format:
    korral export [--check] [--port=9897] [--path=/metrics] [--labels=pod_owner,release,app.kubernetes.io/name]

Asking for pod_owner label will traverse Kubernetes resource hierarchy to determine top-most controller resource
name to assign to the label (deployment, statefulset, etc.).
If no label exist on the pod/deployment then '(none)' will be set as label value to simplify Prometheus queries.

https://helm.sh/docs/chart_best_practices/labels/
https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/
`);
    process.exit(code);
}

function parseArgs() {
    const known = ['print', 'push', 'export',
        'kobjects', 'cobjects', 'prices',
        'debug', 'trace', 'help',
        'cloud', 'region',
        'context',
        'namespaces',
        'interval', 'endpoint', 'key',
        'check', 'port', 'path'];
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
    if (opts.cloud && !['aws', 'gcp', 'azure'].includes(opts.cloud)) usage();
    if (opts.help) usage(0);
    if (opts.trace) opts.debug = true;
    return {argv, opts};
}

function postprocess(opts) {
    const {labels = ''} = opts;
    return {
        ...opts,
        labels: labels.split(',')
    };
}

function defaultConfig({argv, opts}) {
    return {
        argv: isEmpty(argv) ? ['print'] : argv,
        opts: postprocess({
            namespaces: false,
            interval: '60',
            endpoint: process.env.HUB_API || 'https://api.superhub.io',
            key: process.env.METRICS_API_SECRET,
            check: false,
            port: process.env.KORRAL_PORT || '9897',
            path: '/metrics',
            labels: 'pod_owner,release,app.kubernetes.io/name',
            ...opts
        })
    };
}

module.exports = {parseArgs, defaultConfig, usage};
