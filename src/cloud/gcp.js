const {google} = require('googleapis');
const {flatMap, fromPairs, toPairs} = require('lodash');

const {basename} = require('../util');

const compute = google.compute('v1');

const defaults = {
    volumeType: 'pd-standard'
};

async function services(region) {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/compute']
    });
    const authClient = await auth.getClient();
    const project = await auth.getProjectId();
    return {auth: authClient, project, region};
}

async function regionZones(settings) {
    const {region} = settings;
    const {data: {items}} = await compute.zones.list(settings);
    const zones = items.filter(({region: r}) => r.endsWith(region)).map(({name}) => name);
    return zones;
}

async function instances(settings, zones) {
    const resps = await Promise.all(zones.map(
        zone => compute.instances.list({...settings, zone})
    ));
    const vms = flatMap(resps, ({data: {items = []}}) => items.map(
        ({name, machineType, scheduling: {preemptible}}) => ({
            id: name,
            name,
            instanceType: basename(machineType),
            lifecycle: preemptible ? 'preemptible' : 'ondemand'
        })));
    return vms;
}

async function disks(settings, zones) {
    const resps = await Promise.all(zones.map(
        zone => compute.disks.list({...settings, zone})
    ));
    const zonalDisks = flatMap(resps, ({data: {items = []}}) => items.map(
        ({name, type, sizeGb: size, zone, users}) => ({
            id: name,
            type: basename(type),
            size,
            zone: basename(zone),
            attachments: users.map(basename)
        })));
    return zonalDisks;
}

async function loadBalancers(settings) {
    const {data: {items = []}} = await compute.forwardingRules.list(settings);
    const lbs = items.map(({IPAddress: ipAddress, loadBalancingScheme, networkTier}) => ({
        ipAddress,
        type: loadBalancingScheme.toLowerCase(),
        tier: networkTier.toLowerCase(),
        bytes: 0 // TODO
    }));
    return lbs;
}

async function cloud(settings, {zones: z} = {}) {
    const zones = z || await regionZones(settings);
    const objs = {instances, volumes: disks, loadBalancers};
    const account = fromPairs(await Promise.all(
        toPairs(objs).map(([key, getter]) => getter(settings, zones).then(r => ([key, r])))));
    return {...account, zones, defaults};
}

module.exports = {services, cloud, instances, volumes: disks, loadBalancers};
