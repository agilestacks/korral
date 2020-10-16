const k8s = require('@kubernetes/client-node');

const {dump, noop} = require('./util');
const {parseArgs, defaultConfig, usage} = require('./cli');
const {print, printKObjects: kobjects, printCObjects: cobjects, printPrices: prices} = require('./print');
const {push} = require('./push');
const {expose} = require('./expose');

async function main() {
    const {argv, opts} = defaultConfig(parseArgs());

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    if (opts.context) kc.setCurrentContext(opts.context);
    else opts.context = process.env.KORRAL_DOMAIN || kc.getCurrentContext();
    const core = kc.makeApiClient(k8s.CoreV1Api);
    const batch = kc.makeApiClient(k8s.BatchV1Api);
    const apps = kc.makeApiClient(k8s.AppsV1Api);

    const command = argv[0];
    const commands = {print, push, export: expose, kobjects, cobjects, prices};
    const impl = commands[command];
    if (!impl) usage();
    await impl({argv, opts, k8sApi: {core, batch, apps}, dump: opts.debug ? dump : noop});
}

main();
