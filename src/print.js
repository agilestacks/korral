const {sortBy} = require('lodash');

const {collect} = require('./collect');
const {cluster} = require('./kubernetes');
const {cloud: awsCloud, services: awsServices} = require('./cloud/aws');
const {cloud: gcpCloud, services: gcpServices} = require('./cloud/gcp');
const {cloud: azureCloud, services: azureServices} = require('./cloud/azure');
const {prices: awsPrices} = require('./prices/aws');
const {prices: gcpPrices} = require('./prices/gcp');
const {prices: azurePrices} = require('./prices/azure');
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
    const region = maybeRegion || (cloud === 'aws' ? process.env.AWS_DEFAULT_REGION :
        cloud === 'azure' ? process.env.AZURE_REGION : undefined);
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
    },
    async azure(region) {
        return azureCloud(await azureServices(region));
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
    },
    async azure(region, params) {
        return azurePrices(await azureServices(region), params);
    }
};

async function printPrices({opts: {cloud = 'aws', region: maybeRegion}}) {
    const region = guessRegion(cloud, maybeRegion);
    const params = {
        region,
        zones: cloud === 'aws' ? [`${region}a`, `${region}b`] :
            cloud === 'gcp' ? [`${region}-b`, `${region}-c`] :
                ['0', '1'],
        instances: cloud === 'aws' ? [{type: 't3a.medium'}, {type: 'm5.large'}] :
            cloud === 'gcp' ? [
                {type: 'n1-standard-4', capacity: {cpu: 4, memory: 15}},
                {type: 'e2-small', capacity: {cpu: 2, memory: 2}}
            ] :
                [{type: 'Standard_F4s_v2'}, {type: 'Standard_F8s_v2'}]
    };
    const prices = await cloudPrices[cloud](region, params);
    dump(prices);
}

module.exports = {print, printTotals, printNamespaceTotals, printKObjects, printCObjects, printPrices};
