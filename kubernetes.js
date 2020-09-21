/* eslint-disable no-console, no-param-reassign */
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
        instanceType: labels['node.kubernetes.io/instance-type'],
        region: labels['topology.kubernetes.io/region'],
        zone: labels['topology.kubernetes.io/zone'],
        volumes: volumesInUse.filter(vol => vol.startsWith('kubernetes.io/aws-ebs/')).map(vol => vol.substr(22))
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
    const volumeIds = n.map(({spec: {awsElasticBlockStore: {volumeID}}}) => volumeID);
    return volumeIds;
}

module.exports = {meta, nodes, loadBalancers, volumes};
