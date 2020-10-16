const util = require('util');
const request = require('request');
const {get, flatMap, map, uniq, uniqBy} = require('lodash');
const {cpuParser, memoryParser} = require('kubernetes-resource-parser');

const {basename, path} = require('./util');

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
    const kNodes = n.filter(({spec: {providerID}}) => providerID).map(({
        metadata: {name, labels = {}},
        spec: {providerID},
        status: {volumesInUse, capacity: {cpu, memory}}
    }) => ({
        name,
        // TODO better conditional?
        id: providerID.startsWith('azure://') ? path(providerID) : basename(providerID),
        instance: {
            type: labels['node.kubernetes.io/instance-type'] ||
                labels['beta.kubernetes.io/instance-type'],
            capacity: {
                cpu: cpuParser(cpu),
                memory: memoryParser(memory) / (1024 * 1024 * 1024)
            }
        },
        region: labels['topology.kubernetes.io/region'] ||
            labels['failure-domain.beta.kubernetes.io/region'],
        zone: labels['topology.kubernetes.io/zone'] ||
            labels['failure-domain.beta.kubernetes.io/zone'],
        volumes: (volumesInUse || [])
            .filter(vol => vol.match(/^kubernetes.io\/(aws-ebs|gce-pd|azure-disk)\/.+/))
            .map(vol => vol.substr(1 + vol.indexOf('/', 14)))
            .map(vol => (vol.includes('://') ? basename(vol) : vol)),
        ...(labels['cloud.google.com/gke-preemptible'] === 'true' ? {lifecycle: 'preemptible'} : {})
    }));
    return kNodes;
}

async function loadBalancers(k8sApi) {
    const {body: {items: n}} = await k8sApi.listServiceForAllNamespaces();
    const lbs = n.filter(({spec: {type}}) => type === 'LoadBalancer');
    const ingress = flatMap(lbs,
        ({metadata: {namespace, annotations = {}}, status}) => (get(status, 'loadBalancer.ingress') || [])
            .map(({hostname, ip}) => ({
                hostname, // either hostname or ip will be set
                ip,
                namespace,
                type: hostname ? (annotations['service.beta.kubernetes.io/aws-load-balancer-type'] || 'elb') :
                    undefined // GKE and AKS loadbalancers assigns IP
            })));
    return ingress;
}

async function volumes(k8sApi) {
    const {body: {items: n}} = await k8sApi.listPersistentVolume();
    const kVolumes = n.map(({
        metadata: {name},
        spec: {
            awsElasticBlockStore: {volumeID} = {},
            gcePersistentDisk: {pdName} = {},
            azureDisk: {diskURI} = {},
            capacity: {storage},
            claimRef
        }
    }) => {
        const {name: claimName, namespace} = claimRef || {};
        return {
            id: basename(volumeID) || basename(pdName) || path(diskURI),
            name,
            storage,
            claim: claimName ? {name: claimName, namespace} : {}
        };
    });
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

function kubeKind(kcluster) {
    const {meta: {version: {gitVersion: v = ''} = {}}, nodes: n} = kcluster;
    const kind = v.includes('-eks-') ? 'eks' :
        v.includes('-gke.') ? 'gke' :
            n.some(({id}) => id.startsWith('/subscriptions/')) ? 'aks' :
                'generic';
    return {kind};
}

function cloudProperties(kcluster) {
    const {nodes: knodes} = kcluster;
    const regions = uniq(map(knodes, 'region').filter(r => r));
    if (regions.length !== 1) {
        console.log(`Expected cluster nodes in a single cloud region: got ${regions}`);
    }
    if (regions.length === 0) return {};
    const [region] = regions;
    const zones = uniq(map(knodes, 'zone').filter(z => z));
    const instances = uniqBy(map(knodes, 'instance').filter(({type}) => type), 'type');
    return {region, zones, instances};
}

function enrich(kcluster) {
    Object.assign(kcluster.meta, kubeKind(kcluster));
    Object.assign(kcluster.meta, cloudProperties(kcluster));
}

async function cluster(k8sApi, opts = {}) {
    const {pods: readPods} = opts;
    const objs = [meta, nodes, loadBalancers, volumes];
    if (readPods) objs.push(...[pvclaims, pods]);
    const [kmeta, knodes, klbs, kvols, kpvcs = [], kpods = []] = await Promise.all(objs.map(getter => getter(k8sApi)));
    const kCluster = {meta: kmeta, nodes: knodes, loadBalancers: klbs, volumes: kvols, pvclaims: kpvcs, pods: kpods};
    enrich(kCluster);
    return kCluster;
}

module.exports = {cluster, meta, nodes, loadBalancers, volumes, pvclaims, pods};
