const {map, uniq} = require('lodash');

const {cluster: kCluster} = require('./kubernetes');
const {cloud: awsCloud, services: awsServices} = require('./cloud/aws');
const {cloud: gcpCloud, services: gcpServices} = require('./cloud/gcp');
const {cloud: azureCloud, services: azureServices} = require('./cloud/azure');
const {prices: awsPrices} = require('./prices/aws');
const {prices: gcpPrices} = require('./prices/gcp');
const {prices: azurePrices} = require('./prices/azure');
const {join} = require('./model');

async function aws({cluster, cloudApi, dump}) {
    const {meta: {region, zones, instances}, loadBalancers} = cluster;

    // filter out unrelated load-balancers before going to CloudWatch Metrics for stats
    const lbHostnames = map(loadBalancers, 'hostname');
    const lbFilter = ({DNSName}) => lbHostnames.includes(DNSName);

    const api = cloudApi || await awsServices(region);

    const cloud = await awsCloud(api, {filters: {loadBalancers: lbFilter}});
    dump({cloud});

    const prices = await awsPrices(api, {region, zones, instances});
    dump({prices});

    return {cloud, prices, cloudApi: api};
}

async function gcp({cluster, cloudApi, dump}) {
    const {meta: {region, zones, instances}, loadBalancers} = cluster;

    // filter out unrelated load-balancers before going to Cloud Monitoring Metrics for stats
    const lbIps = map(loadBalancers, 'ip');
    const lbFilter = ({IPAddress}) => lbIps.includes(IPAddress);

    const api = cloudApi || await gcpServices(region);

    const cloud = await gcpCloud(api, {zones, filters: {loadBalancers: lbFilter}});
    dump({cloud});

    const prices = await gcpPrices(api, {region, zones, instances});
    dump({prices});

    return {cloud, prices, cloudApi: api};
}

function azureOptions(cluster) {
    const nodesVmss = cluster.nodes.map(
        ({id}) => id.match(/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachineScaleSets\/([^/]+)/))
        .filter(m => m)
        .map(([, resourceGroup, vmss]) => ({resourceGroup, vmss}));
    const resourceGroups = uniq(map(nodesVmss, 'resourceGroup'));
    const vmsss = uniq(map(nodesVmss, 'vmss'));
    if (resourceGroups.length !== 1) {
        console.log(`Expected cluster nodes in a single resource group: got ${resourceGroups}`);
    }
    if (resourceGroups.length === 0) return {};
    const [resourceGroup] = resourceGroups;
    return {resourceGroup, vmsss};
}

async function azure({cluster, cloudApi, dump}) {
    const {meta: {region, zones, instances}} = cluster;

    const api = cloudApi || await azureServices(region);

    const cloud = await azureCloud(api, azureOptions(cluster));
    dump({cloud});

    const prices = await azurePrices(api, {region, zones, instances});
    dump({prices});

    return {cloud, prices, cloudApi: api};
}

const clouds = {aws, gcp, azure};
const cloudOfClusterKind = {
    eks: 'aws',
    gke: 'gcp',
    aks: 'azure'
};

async function collect({k8sApi, cloudApi = null, dump, opts}, kopts = {}) {
    const cluster = await kCluster(k8sApi, kopts);
    dump({cluster});

    const cloudKind = opts.cloud || cloudOfClusterKind[cluster.meta.kind];
    if (!cloudKind) {
        console.log(
            `Error: unable to determine cloud kind of cluster kind ${cluster.meta.kind}: set --cloud=aws|gcp|azure`);
        process.exit(2);
    }

    const {cloud, prices, cloudApi: api = cloudApi} = await clouds[cloudKind]({cluster, cloudApi, dump});

    const costs = join(cluster, cloud, prices);
    dump({costs});

    return {cluster, cloud, prices, costs, k8sApi, cloudApi: api, dump, opts};
}

module.exports = {collect};
