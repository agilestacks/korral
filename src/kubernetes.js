const util = require('util');
const request = require('request');
const {get, flatMap} = require('lodash');

async function meta(k8sApi) {
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

async function nodes(k8sApi) {
    const {body: {items: n}} = await k8sApi.listNode();
    const kNodes = n.map(({
        metadata: {name, labels},
        spec: {providerID: id},
        status: {volumesInUse}
    }) => ({
        name,
        id,
        instanceType: labels['node.kubernetes.io/instance-type'] ||
            labels['beta.kubernetes.io/instance-type'],
        region: labels['topology.kubernetes.io/region'] ||
            labels['failure-domain.beta.kubernetes.io/region'],
        zone: labels['topology.kubernetes.io/zone'] ||
            labels['failure-domain.beta.kubernetes.io/zone'],
        volumes: (volumesInUse || []).filter(vol => vol.startsWith('kubernetes.io/aws-ebs/')).map(vol => vol.substr(22))
    }));
    return kNodes;
}

async function loadBalancers(k8sApi) {
    const {body: {items: n}} = await k8sApi.listServiceForAllNamespaces();
    const lbs = n.filter(({spec: {type}}) => type === 'LoadBalancer');
    const ingress = flatMap(lbs, lb => get(lb, 'status.loadBalancer.ingress'));
    const hostnames = ingress.map(({hostname}) => hostname);
    return hostnames.map(hostname => ({hostname, type: 'elb'}));
}

async function volumes(k8sApi) {
    const {body: {items: n}} = await k8sApi.listPersistentVolume();
    const kVolumes = n.map(({
        metadata: {name},
        spec: {
            awsElasticBlockStore: {volumeID: id},
            capacity: {storage},
            claimRef: {name: claimName, namespace}
        }
    }) => ({
        id,
        name,
        storage,
        claim: {name: claimName, namespace}
    }));
    return kVolumes;
}

async function pods(k8sApi) {
    const {body: {items: n}} = await k8sApi.listPodForAllNamespaces();
    const kPods = n.map(({
        metadata: {name, namespace},
        spec: {
            nodeName,
            containers,
            volumes: podVolumes
        },
        status: {phase}
    }) => ({
        name,
        namespace,
        phase,
        nodeName,
        containers: containers
            .map(({name: containerName, resources = {}}) => ({name: containerName, resources})),
        volumes: podVolumes
            .filter(({persistentVolumeClaim}) => persistentVolumeClaim)
            .map(({name: volumeName, persistentVolumeClaim: {claimName}}) => ({name: volumeName, claimName}))
    }));
    return kPods.filter(({phase}) => phase === 'Running');
}

async function pvclaims(k8sApi) {
    const {body: {items: n}} = await k8sApi.listPersistentVolumeClaimForAllNamespaces();
    const kPvcs = n.map(({
        metadata: {name, namespace},
        spec: {volumeName},
        status: {capacity: {storage}}
    }) => ({
        name,
        namespace,
        volumeName,
        storage
    }));
    return kPvcs;
}

module.exports = {meta, nodes, loadBalancers, volumes, pvclaims, pods};
