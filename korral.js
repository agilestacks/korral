/* eslint-disable no-console, no-param-reassign */
const util = require('util');
const {get, flatMap, uniq} = require('lodash');
const k8s = require('@kubernetes/client-node');
const request = require('request'); // eslint-disable-line import/no-extraneous-dependencies
const aws = require('aws-sdk');
const awsConfig = require('aws-config');

// const prices = require('./prices');

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
        type: labels['node.kubernetes.io/instance-type'],
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

function guessKubeKind(cluster) {
    const {meta: {version}} = cluster;
    const kind = (version.gitVersion || '').includes('-eks-') ? 'EKS' : 'generic';
    return {kind};
}

function enrich(cluster) {
    Object.assign(cluster.meta, guessKubeKind(cluster));
    const regions = uniq(cluster.nodes.map(({region}) => region));
    if (regions.length > 0) {
        const [region] = regions;
        cluster.meta.region = region;
    }
    if (regions.length !== 1) {
        console.log(`Expected cluster nodes in a single cloud region: got ${regions}`);
    }
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
    const [m, n, l, v] = await Promise.all([kmeta(), nodes(), lbs(), kvolumes()]);
    const cluster = {meta: m, nodes: n, loadBalancers: l, volumes: v};
    enrich(cluster);
    dump({cluster});

    ec2 = new aws.EC2(awsConfig({region: cluster.meta.region}));

    const [i, c] = await Promise.all([vms(), cvolumes()]);
    const cloud = {vms: i, volumes: c};
    dump({cloud});
}

main();
