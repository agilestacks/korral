const util = require('util');
const {differenceBy, flatMap, fromPairs, groupBy, isEmpty, map, maxBy, sumBy, toPairs, zip} = require('lodash');
const {
    loginWithAuthFileWithAuthResponse,
    loginWithServicePrincipalCertificateWithAuthResponse,
    loginWithServicePrincipalSecretWithAuthResponse,
    loginWithVmMSI
} = require('@azure/ms-rest-nodeauth');
const {ComputeManagementClient} = require('@azure/arm-compute');
const {NetworkManagementClient} = require('@azure/arm-network');
const {MonitorManagementClient} = require('@azure/arm-monitor');

const {dump} = require('../util');

// https://www.npmjs.com/package/@azure/ms-rest-nodeauth
// https://docs.microsoft.com/en-us/rest/api/compute/
// https://docs.microsoft.com/en-us/rest/api/load-balancer/
// https://docs.microsoft.com/en-us/rest/api/monitor/metrics/list
// https://docs.microsoft.com/en-us/javascript/api/@azure/arm-compute/computemanagementclient?view=azure-node-latest
// https://docs.microsoft.com/en-us/javascript/api/@azure/arm-network/networkmanagementclient?view=azure-node-latest
// https://docs.microsoft.com/en-us/javascript/api/@azure/arm-monitor/metrics?view=azure-node-latest

const defaults = {
    volumeType: 'StandardSSD_LRS'
};

async function auth() {
    const {
        AZURE_AUTH_LOCATION: filePath,
        AZURE_CLIENT_ID: clientId,
        AZURE_CLIENT_SECRET: secret,
        AZURE_CERTIFICATE_PATH: certificate,
        AZURE_TENANT_ID: tenantId
    } = process.env;

    let creds;

    if (filePath) {
        creds = await loginWithAuthFileWithAuthResponse({filePath});
    } else if (certificate) {
        creds = await loginWithServicePrincipalCertificateWithAuthResponse(clientId, certificate, tenantId);
    } else if (secret) {
        creds = await loginWithServicePrincipalSecretWithAuthResponse(clientId, secret, tenantId);
    } else {
        // https://docs.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/how-to-use-vm-token
        // https://github.com/Azure/ms-rest-nodeauth#msi-managed-service-identity-based-login-from-a-virtual-machine-created-in-azure
        const options = clientId ? {clientId} : undefined;
        console.log(`Trying MSI login${options ? ` with ${util.inspect(options)}` : ''}`);
        creds = await loginWithVmMSI({...options, resource: 'https://management.azure.com/'});
    }

    return creds;
}

async function services() {
    const {
        AZURE_REGION: region,
        AZURE_RESOURCE_GROUP_NAME: resourceGroup,
        AZURE_SUBSCRIPTION_ID: envSubscriptionId
    } = process.env;

    const {credentials, subscriptions} = await auth();
    const subscriptionId = envSubscriptionId || subscriptions[0].id;
    const compute = new ComputeManagementClient(credentials, subscriptionId);
    const network = new NetworkManagementClient(credentials, subscriptionId);
    const monitor = new MonitorManagementClient(credentials, subscriptionId);

    return {credentials, subscriptions, subscriptionId, compute, network, monitor, resourceGroup, region};
}

function rgLc(resourceGroup) {
    return resourceGroup.replace(
        /\/resourceGroups\/([^/]+)/,
        (match, p1) => `/resourceGroups/${p1.toLowerCase()}`
    );
}

async function instances({compute}, {resourceGroup, vmsss = []}) {
    const vmssResps = await Promise.all(vmsss.map(vmss => compute.virtualMachineScaleSets.get(resourceGroup, vmss)));
    const vmssPriority = fromPairs(vmssResps.map(({name, virtualMachineProfile: {priority}}) => [name, priority]));

    const vmResps = await Promise.all(vmsss.map(
        vmss => compute.virtualMachineScaleSetVMs.list(resourceGroup, vmss)
    ));
    const vms = flatMap(zip(vmsss, vmResps), ([vmss, vm]) => vm.map(({
        id,
        osProfile: {computerName: name},
        sku: {name: instanceType},
        storageProfile: {osDisk, dataDisks}
    }) => ({
        id: rgLc(id),
        name,
        instanceType,
        lifecycle: vmssPriority[vmss] === 'Spot' ? 'spot' : 'ondemand',
        disks: [osDisk, ...dataDisks].map(({diskSizeGB, managedDisk: {id: diskId, storageAccountType}}) => (
            {id: rgLc(diskId), type: storageAccountType, size: diskSizeGB}
        ))
    })));
    return vms;
}

async function disks({compute}, {resourceGroup}) {
    const resp = await compute.disks.listByResourceGroup(resourceGroup);
    const dsks = resp.map(({id, name, sku: {name: type}, location, diskSizeGB: size, managedBy}) => ({
        id: rgLc(id),
        name,
        type,
        size,
        location,
        attachments: [rgLc(managedBy.replace(/\/[^/]+_(\d+)/, '/$1'))]
    }));
    return dsks;
}

async function loadBalancers({network, monitor}, {resourceGroup}) {
    const [lbs, ips] = await Promise.all([
        network.loadBalancers.list(resourceGroup),
        network.publicIPAddresses.list(resourceGroup)
    ]);
    const lbs2 = flatMap(lbs, ({
        id,
        sku: {name: type},
        frontendIPConfigurations
    }) => frontendIPConfigurations.map(({publicIPAddress: {id: ipId}}) => ({
        id: rgLc(id),
        ipAddress: (ips.find(({id: id2}) => id2 === ipId) || {}).ipAddress,
        type
    }))).filter(({ipAddress}) => ipAddress);
    const lbs3 = await Promise.all(lbs2.map(async ({id, ...rest}) => {
        // by default this returns bytes per minute for each minute in last hour
        const {value: metricData, message: error} =
            await monitor.metrics.list(id, {metricnames: 'ByteCount', aggregation: 'average'}).catch(({body}) => body);
        let bytes = 0;
        if (metricData) {
            const [{timeseries: [{data: ts}]}] = metricData;
            bytes = Math.floor(sumBy(ts, 'average'));
        } else if (error) {
            console.log(`Error getting load-balancer ${id} Monitor byte count metric:`);
            dump({error});
        }
        return {id, ...rest, bytes};
    }));
    return lbs3;
}

async function sampleOptions({compute}) {
    const resp = await compute.virtualMachineScaleSets.listAll();
    const allVmsss = resp.map(({name, id}) => ({
        name,
        resourceGroup: (id.match(/\/resourceGroups\/([^/]+)/) || [null, ''])[1].toLowerCase()
    }));
    const [resourceGroup, rgVmsss] = maxBy(toPairs(groupBy(allVmsss, 'resourceGroup')), ([, arr]) => arr.length);
    return {resourceGroup, vmsss: map(rgVmsss, 'name')};
}

async function maybeSampleOptions(apis, options) {
    const {resourceGroup, vmsss} = options;
    if (resourceGroup || !isEmpty(vmsss)) return;
    Object.assign(options, await sampleOptions(apis));
}

async function cloud(apis, options = {}) {
    await maybeSampleOptions(apis, options); // for `korral cobjects`

    const objs = {instances, volumes: disks, loadBalancers};
    const account = fromPairs(await Promise.all(
        toPairs(objs).map(([key, getter]) => getter(apis, options).then(r => ([key, r])))));
    // VMSS disks are separated in Azure Disks API so we need to add disks capturted from VM calls
    const allDisks = flatMap(account.instances,
        ({id, disks: vmDisks}) => vmDisks.map(disk => ({...disk, attachments: [id]})));
    const vmssDisks = differenceBy(allDisks, account.volumes, 'id');
    account.volumes.push(...vmssDisks);
    return {...account, defaults};
}

module.exports = {auth, services, cloud, instances, volumes: disks, loadBalancers};
