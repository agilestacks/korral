const {sortBy} = require('lodash');

const {collect} = require('./collect');
const {cluster} = require('./kubernetes');
const {cloud, awsServices} = require('./cloud');
const {prices} = require('./prices');
const {dump} = require('./util');

function printTotals(totals) {
    const {total, nodes, volumes, k8sVolumes, nativeVolumes, orphanedVolumes, loadBalancers, k8s} = totals;
    console.log(`Cluster:
    Total:   ${total} US$ per hour
    Nodes:   ${nodes}
    Volumes: ${volumes}
             ${k8sVolumes} Kubernetes
             ${nativeVolumes} boot${orphanedVolumes > 0 ? `\n             ${orphanedVolumes} orphaned` : ''}
    ELBs:    ${loadBalancers}
    K8s:     ${k8s}`);
}

function printNamespaceTotals(totals) {
    const {pods, volumes, namespaces} = totals;
    const ns = sortBy(namespaces, ({namespace}) => namespace)
        .map(({namespace, nodes, pod: nPod, volumes: nVolumes}) => `        ${namespace}: ${nodes.length} nodes
             ${nPod} pods
             ${nVolumes} volumes`);
    console.log(`Namespaces:
    Pods:    ${pods}
    Volumes: ${volumes}
${ns.join('\n')}`);
}

async function print(ctx) {
    const {opts: {namespaces: readPods}} = ctx;
    const {costs: {totals, namespaces}} = await collect(ctx, {pods: !!readPods});
    ctx.dump(totals);
    printTotals(totals);
    if (namespaces) printNamespaceTotals(namespaces);
}

async function printKObjects(ctx) {
    const {k8sApi} = ctx;
    const kcluster = await cluster(k8sApi, {pods: true});
    dump(kcluster);
}

const region = process.env.AWS_DEFAULT_REGION || 'us-east-2';

async function printCObjects() {
    const account = await cloud(awsServices(region));
    dump(account);
}

async function printPrices() {
    const awsPrices = await prices({
        region,
        zones: [`${region}a`, `${region}b`],
        instanceTypes: ['t3a.medium', 'm5.large']
    });
    dump(awsPrices);
}

module.exports = {print, printTotals, printNamespaceTotals, printKObjects, printCObjects, printPrices};
