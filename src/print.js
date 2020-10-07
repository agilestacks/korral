const {sortBy} = require('lodash');

const {collect} = require('./collect');
const {cluster} = require('./kubernetes');
const {cloud: awsCloud, services: awsServices} = require('./cloud/aws');
const {cloud: gcpCloud, services: gcpServices} = require('./cloud/gcp');
const {prices: awsPrices} = require('./prices/aws');
const {prices: gcpPrices} = require('./prices/gcp');
const {dump} = require('./util');

function printTotals(totals) {
    const {total, nodes, volumes, k8sVolumes, nativeVolumes, orphanedVolumes, loadBalancers, k8s = 0} = totals;
    console.log(`Cluster:
    Total:   ${total} USD per hour
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
    const {k8sApi, opts: {namespaces: readPods}} = ctx;
    const kcluster = await cluster(k8sApi, {pods: !!readPods});
    dump(kcluster);
}

function guessRegion(cloud, maybeRegion) { // eslint-disable-line consistent-return
    const region = maybeRegion || (cloud === 'aws' ? process.env.AWS_DEFAULT_REGION : undefined);
    if (region) return region;
    console.log('Error: unable to determine default cloud region: set --region=');
    process.exit(2);
}

const clouds = {
    async aws(region) {
        return awsCloud(await awsServices(region));
    },
    async gcp(region) {
        return gcpCloud(await gcpServices(region));
    }
};

async function printCObjects({opts: {cloud = 'aws', region: maybeRegion}}) {
    const region = guessRegion(cloud, maybeRegion);
    const account = await clouds[cloud](region);
    dump(account);
}

const cloudPrices = {
    async aws(region, params) {
        return awsPrices(await awsServices(region), params);
    },
    async gcp(region, params) {
        return gcpPrices(await gcpServices(region), params);
    }
};

async function printPrices({opts: {cloud = 'aws', region: maybeRegion}}) {
    const region = guessRegion(cloud, maybeRegion);
    const params = {
        region,
        zones: cloud === 'aws' ? [`${region}a`, `${region}b`] : [`${region}-b`, `${region}-c`],
        instanceTypes: cloud === 'aws' ? ['t3a.medium', 'm5.large'] : ['n1-standard-4', 'e2-small']
    };
    const prices = await cloudPrices[cloud](region, params);
    dump(prices);
}

module.exports = {print, printTotals, printNamespaceTotals, printKObjects, printCObjects, printPrices};
