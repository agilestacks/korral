const {google} = require('googleapis');
const {flatMap, fromPairs, toPairs, sum, toNumber} = require('lodash');

const {basename, dump} = require('../util');

// https://cloud.google.com/apis/docs/client-libraries-explained
// https://github.com/googleapis/google-api-nodejs-client
// https://cloud.google.com/compute/docs/reference/rest/v1
// https://cloud.google.com/monitoring/api/ref_v3/rest
// https://github.com/googleapis/nodejs-compute
// https://github.com/googleapis/nodejs-monitoring

const compute = google.compute('v1');
const monitoring = google.monitoring('v3');

const defaults = {
    volumeType: 'pd-standard'
};

async function services(region) {
    const auth = new google.auth.GoogleAuth({
        scopes: [
            'https://www.googleapis.com/auth/compute.readonly',
            'https://www.googleapis.com/auth/monitoring.read'
        ]
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

async function instances(settings, {zones}) {
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

async function disks(settings, {zones}) {
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

async function loadBalancers(settings, {filter = () => true} = {}) {
    const {auth, project} = settings;
    const {data: {items = []}} = await compute.forwardingRules.list(settings);
    const lbs = await Promise.all(items.filter(filter)
        .map(async ({name, IPAddress: ipAddress, loadBalancingScheme, networkTier}) => {
            const query = `fetch tcp_lb_rule
                | metric 'loadbalancing.googleapis.com/l3/external/egress_bytes_count'
                | filter forwarding_rule_name = "${name}"
                | within 1h
                | sum`;
            const {data: {timeSeriesData, error}} = await monitoring.projects.timeSeries.query({
                auth,
                name: `projects/${project}`,
                requestBody: {query}
            }).catch(({response}) => response);
            let bytes = 0;
            if (timeSeriesData) {
                const [{pointData}] = timeSeriesData;
                bytes = sum(flatMap(pointData, ({values}) => values.map(({int64Value}) => toNumber(int64Value))));
            } else if (error) { // Cloud Monitoring API might not be enabled on the project
                console.log(`Error getting forwarding rule ${name} Cloud Monitoring egress metrics:`);
                dump({error});
            }
            return {
                name,
                ipAddress,
                type: loadBalancingScheme.toLowerCase(),
                tier: networkTier.toLowerCase(),
                bytes
            };
        }));
    return lbs;
}

async function cloud(settings, {zones: z, filters = {}} = {}) {
    const zones = z || await regionZones(settings);
    const objs = {instances, volumes: disks, loadBalancers};
    const account = fromPairs(await Promise.all(
        toPairs(objs).map(([key, getter]) => getter(settings, {zones, filter: filters[key]}).then(r => ([key, r])))));
    return {...account, zones, defaults};
}

module.exports = {services, cloud, instances, volumes: disks, loadBalancers};
