const k8s = require('@kubernetes/client-node');

const {dump, noop} = require('./util');
const {parseArgs, defaultConfig} = require('./cli');
const {print} = require('./print');
const {push} = require('./push');
const {expose} = require('./expose');

async function main() {
    const {argv, opts} = defaultConfig(parseArgs());

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    if (opts.context) kc.setCurrentContext(opts.context);
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const command = argv[0];
    const commands = {print, push, expose};
    await commands[command]({argv, opts, k8sApi, dump: opts.debug ? dump : noop});
}

main();
