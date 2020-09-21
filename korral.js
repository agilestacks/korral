/* eslint-disable no-console, no-param-reassign */
const util = require('util');
const {get, flatMap, uniq} = require('lodash');
const k8s = require('@kubernetes/client-node');
const request = require('request');
const aws = require('aws-sdk');
const awsConfig = require('aws-config');

const {spotPrices, ondemandPrices, volumePrices} = require('./prices');

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

async function kmeta() {
    const opt = {
        method: 'GET',
        baseUrl: k8sApi.basePath,
        uri: '/version',
        headers: {}
    };
    await k8sApi.authentications.default.applyToRequest(opt);
    const {body} = await util.promisify(request)(opt);
    const version = JSON.parse(body);
    return {version};
}

async function nodes() {
    const {body: {items: n}} = await k8sApi.listNode();
    const cloudNodes = n.map(({
        metadata: {name, labels},
        spec: {providerID: id},
        status: {volumesInUse}
    }) => ({
        name,
        id,
        instanceType: labels['node.kubernetes.io/instance-type'],
        region: labels['topology.kubernetes.io/region'],
        zone: labels['topology.kubernetes.io/zone'],
        volumes: volumesInUse.filter(vol => vol.startsWith('kubernetes.io/aws-ebs/')).map(vol => vol.substr(22))
    }));
    return cloudNodes;
}

async function lbs() {
    const {body: {items: n}} = await k8sApi.listServiceForAllNamespaces();
    const loadBalancers = n.filter(({spec: {type}}) => type === 'LoadBalancer');
    const ingress = flatMap(loadBalancers, lb => get(lb, 'status.loadBalancer.ingress'));
    const hostnames = ingress.map(({hostname}) => hostname);
    return hostnames;
}

async function kvolumes() {
    const {body: {items: n}} = await k8sApi.listPersistentVolume();
    const volumeIds = n.map(({spec: {awsElasticBlockStore: {volumeID}}}) => volumeID);
    return volumeIds;
}

function kubeKind(cluster) {
    const {meta: {version}} = cluster;
    const kind = (version.gitVersion || '').includes('-eks-') ? 'EKS' : 'generic';
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
}

function enrich(cluster) {
    Object.assign(cluster.meta, kubeKind(cluster));
    Object.assign(cluster.meta, cloudProperties(cluster));
}

let ec2;

async function vms() {
    const {Reservations: r} = await ec2.describeInstances().promise();
    const cloudVms = flatMap(r, ({Instances: i}) => i.map(({
        InstanceId: id, InstanceType: type, PrivateDnsName: name, VpcId: vpc, InstanceLifecycle: lifecycle
    }) => ({name, id, type, vpc, lifecycle})));
    return cloudVms;
}

async function cvolumes() {
    const {Volumes: v} = await ec2.describeVolumes().promise();
    const cloudVolumes = v.map(({
        VolumeId: id, VolumeType: type, Size, AvailabilityZone: zone, Attachments
    }) => ({
        id,
        type,
        size: `${Size}GB`,
        zone,
        attachments: Attachments.map(({InstanceId}) => InstanceId)
    }));
    return cloudVolumes;
}

function dump(obj) {
    console.log(util.inspect(obj, {depth: 5, showHidden: false}));
}

async function main() {
    const [meta, knodes, loadBalancers, kvol] = await Promise.all([kmeta(), nodes(), lbs(), kvolumes()]);
    const cluster = {meta, nodes: knodes, loadBalancers, volumes: kvol};
    enrich(cluster);
    dump({cluster});
    // const cluster =  {
    //     meta: {
    //       kind: 'EKS',
    //       region: 'us-east-2',
    //       zones: [ 'us-east-2c', 'us-east-2a' ],
    //       instanceTypes: [ 't3a.medium', 'r4.large' ]
    //     }
    // };
    const {meta: {region, zones, instanceTypes}} = cluster;
    ec2 = new aws.EC2(awsConfig({region}));

    const [cvms, cvol] = await Promise.all([vms(), cvolumes()]);
    const cloud = {instances: cvms, volumes: cvol};
    dump({cloud});

    const [spot, ondemand, pvol] = await Promise.all([
        spotPrices(region, zones, instanceTypes),
        ondemandPrices(region, instanceTypes),
        volumePrices(region)
    ]);
    const prices = {spot, ondemand, volumes: pvol};
    dump({prices});
}

main();
