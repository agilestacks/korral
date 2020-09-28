const k8s = require('@kubernetes/client-node');

const {dump, noop} = require('./util');
const {parseArgs, defaultConfig} = require('./cli');
const {print, printKObjects: kobjects, printCObjects: cobjects, printPrices: prices} = require('./print');
const {push} = require('./push');
const {expose} = require('./expose');

async function main() {
    const {argv, opts} = defaultConfig(parseArgs());

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    if (opts.context) kc.setCurrentContext(opts.context);
    else opts.context = kc.getCurrentContext(); // in-cluster config cluster name?
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const command = argv[0];
    const commands = {print, push, export: expose, kobjects, cobjects, prices};
    await commands[command]({argv, opts, k8sApi, dump: opts.debug ? dump : noop});
}

main();
