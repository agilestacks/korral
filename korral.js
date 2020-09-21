/* eslint-disable no-console */
const util = require('util');
const {uniq} = require('lodash');
const aws = require('aws-sdk');
const awsConfig = require('aws-config');
const k8s = require('@kubernetes/client-node');

const {meta: kMeta, nodes: kNodes, loadBalancers: kLoadBalancers, volumes: kVolumes} = require('./kubernetes');
const {instances: cInstances, volumes: cVolumes} = require('./cloud');
const {spotPrices, ondemandPrices, loadBalancerPrices, volumePrices, eksPrices} = require('./prices');
const {join} = require('./model');

function kubeKind(cluster) {
    const {meta: {version}} = cluster;
    const kind = (version.gitVersion || '').includes('-eks-') ? 'eks' : 'generic';
    return {kind};
}

function cloudProperties(cluster) {
    const {nodes} = cluster;
    const regions = uniq(nodes.map(({region}) => region));
    if (regions.length > 0) {
        const [region] = regions;
        const zones = uniq(nodes.map(({zone}) => zone));
        const instanceTypes = uniq(nodes.map(({instanceType}) => instanceType));
        return {region, zones, instanceTypes};
    }
    if (regions.length !== 1) {
        console.log(`Expected cluster nodes in a single cloud region: got ${regions}`);
    }
    return {};
}

function enrich(cluster) {
    Object.assign(cluster.meta, kubeKind(cluster));
    Object.assign(cluster.meta, cloudProperties(cluster));
}

function dump(obj) {
    console.log(util.inspect(obj, {depth: 5, showHidden: false}));
}

async function main() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const [meta, knodes, klbs, kvol] = await Promise.all([
        kMeta(k8sApi), kNodes(k8sApi), kLoadBalancers(k8sApi), kVolumes(k8sApi)]);
    const cluster = {meta, nodes: knodes, loadBalancers: klbs, volumes: kvol};
    enrich(cluster);
    dump({cluster});

    const {meta: {region, zones, instanceTypes}} = cluster;

    const ec2 = new aws.EC2(awsConfig({region}));

    const [cinst, cvol] = await Promise.all([cInstances(ec2), cVolumes(ec2)]);
    const cloud = {instances: cinst, volumes: cvol};
    dump({cloud});

    const [spot, ondemand, plbs, pvol, eks] = await Promise.all([
        spotPrices(region, zones, instanceTypes),
        ondemandPrices(region, instanceTypes),
        loadBalancerPrices(region),
        volumePrices(region),
        eksPrices()
    ]);
    const prices = {spot, ondemand, loadBalancer: plbs, volume: pvol, k8s: eks};
    dump({prices});

    const costs = join(cluster, cloud, prices);
    dump({costs});
}

main();
