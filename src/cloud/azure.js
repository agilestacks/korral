const {differenceBy, flatMap, fromPairs, toPairs} = require('lodash');
const {
    loginWithAuthFileWithAuthResponse,
    loginWithServicePrincipalCertificateWithAuthResponse,
    loginWithServicePrincipalSecretWithAuthResponse
} = require('@azure/ms-rest-nodeauth');
const {ComputeManagementClient} = require('@azure/arm-compute');
const {NetworkManagementClient} = require('@azure/arm-network');

// https://www.npmjs.com/package/@azure/ms-rest-nodeauth
// https://docs.microsoft.com/en-us/rest/api/compute/
// https://docs.microsoft.com/en-us/rest/api/load-balancer/
// https://docs.microsoft.com/en-us/javascript/api/@azure/arm-compute/computemanagementclient?view=azure-node-latest
// https://docs.microsoft.com/en-us/javascript/api/@azure/arm-network/networkmanagementclient?view=azure-node-latest

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
        // TODO auth from within the Azure
        console.log('Error: no AZURE_* OS env variables found for Azure authentication');
        process.exit(2);
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

    return {credentials, subscriptions, subscriptionId, compute, network, resourceGroup, region};
}

function rgLc(resourceGroup) {
    return resourceGroup.replace(
        /\/resourceGroups\/([^/]+)/,
        (match, p1) => `/resourceGroups/${p1.toLowerCase()}`
    );
}

async function instances({compute}, {resourceGroup, vmsss = []}) {
    const resps = await Promise.all(vmsss.map(
        vmss => compute.virtualMachineScaleSetVMs.list(resourceGroup, vmss)
    ));
    const vms = flatMap(resps, inst => inst.map(({
        id,
        osProfile: {computerName: name},
        sku: {name: instanceType},
        storageProfile: {osDisk, dataDisks}
    }) => ({
        id: rgLc(id),
        name,
        instanceType,
        lifecycle: instanceType.includes('Spot') ? 'spot' : 'ondemand',
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

async function loadBalancers({network}, {resourceGroup}) {
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
        type,
        bytes: 0 // TODO
    }))).filter(({ipAddress}) => ipAddress);
    return lbs2;
}

async function cloud(apis, options = {}) {
    // TODO fetch some {resourceGroup: '', vmsss: []} test data from the cloud for `korral cobjects`
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
