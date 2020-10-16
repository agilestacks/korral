const {get, difference, flatMap, groupBy, isEmpty, mapValues, round, sum, sumBy, uniq} = require('lodash');
const {cpuParser, memoryParser} = require('kubernetes-resource-parser');

const ownerLabel = 'pod_owner';

function resourceOwner(ref, controllers, ownerName = '(none)') {
    if (isEmpty(controllers)) return null;
    if (isEmpty(ref)) return {[ownerLabel]: ownerName};
    const {apiVersion, kind, name: refName} = ref;
    const {name, owner} = (controllers[`${apiVersion}/${kind}`] || []).find(({name: n}) => n === refName) || {};
    return resourceOwner(owner, controllers, name || ownerName);
}

function join(cluster, cloud, prices) {
    // nodes
    const nodesPrices = cluster.nodes.map(({name, id: instanceId, instance: {type: instanceType}, zone, volumes}) => {
        const {instanceType: cloudInstanceType, lifecycle = 'ondemand'} = cloud.instances.find(
            ({id: cloudId}) => cloudId === instanceId) || {};
        if (instanceType !== cloudInstanceType) {
            console.log(
                `Instance ${instanceId} type is ${cloudInstanceType}, but listed as ${instanceType} in Kubernetes`);
        }
        const {price: nodePrice} = (lifecycle === 'ondemand' ? prices.ondemand : prices[lifecycle][zone])
            .find(({instanceType: priceInstanceType}) => priceInstanceType === (cloudInstanceType || instanceType));

        // node volumes
        const k8sVolumes = volumes;
        const nodeVolumes = cloud.volumes
            .filter(({attachments}) => attachments.includes(instanceId))
            .map(({id}) => id);
        const nativeVolumes = difference(nodeVolumes, k8sVolumes);
        const [k8sVolumesPrice, nativeVolumesPrice] =
            [k8sVolumes, nativeVolumes].map(vols => sum(vols
                .map((volumeId) => {
                    const {type = cloud.defaults.volumeType, size = 0, attachments = []} =
                        cloud.volumes.find(({id: cloudId}) => cloudId === volumeId) || {};
                    const volumePrice = (prices.volume[type] * size) / (30 * 24);
                    if (!attachments.includes(instanceId)) {
                        console.log(
                            `Instance ${instanceId} volume ${volumeId} is not attached according to the cloud`);
                    }
                    return volumePrice;
                })));

        return {
            name,
            total: round(nodePrice + k8sVolumesPrice + nativeVolumesPrice, 5),
            node: round(nodePrice, 5),
            allVolumes: round(k8sVolumesPrice + nativeVolumesPrice, 5),
            k8sVolumes: round(k8sVolumesPrice, 5),
            nativeVolumes: round(nativeVolumesPrice, 5)
        };
    });

    // orphaned volumes
    const attachedVolumes = flatMap(cluster.nodes, ({volumes}) => volumes);
    const orphanedVolumes = cluster.volumes
        .filter(({id}) => !attachedVolumes.includes(id))
        .map(({id: volumeId, claim: {name: claimName, namespace}}) => {
            const {type = cloud.defaults.volumeType, size = 0, attachments = []} =
                cloud.volumes.find(({id: cloudId}) => cloudId === volumeId) || {};
            const volumePrice = (prices.volume[type] * size) / (30 * 24);
            if (attachments.length) {
                console.log(
                    `Volume ${volumeId} is not attached according to Kubernetes, yet attached to ${attachments}`);
            }
            return {volumePrice: round(volumePrice, 5), ...(claimName ? {namespace, claim: claimName} : {})};
        });

    // load-balancers
    const lbsPrices = cluster.loadBalancers.map(({hostname, ip, namespace, type: klbtype}) => {
        const {bytes = 0, type: clbtype} = cloud.loadBalancers.find(
            ({dnsName = '', ipAddress = ''}) => dnsName === hostname || ipAddress === ip) || {};
        const {hour: perHour = 0, gigabyte: perGB = 0} = prices.loadBalancer[clbtype || klbtype] || {};
        const traffic = (bytes / (1024 * 1024 * 1024)) * perGB;
        return {
            hostname,
            namespace,
            total: round(perHour + traffic, 5),
            loadBalancer: round(perHour, 5),
            traffic: round(traffic, 5)
        };
    });

    // totals from above
    const k8sPrice = get(prices.k8s, cluster.meta.kind, 0);
    const nodesPrice = sumBy(nodesPrices, 'node');
    const allVolumesPrice = sumBy(nodesPrices, 'allVolumes');
    const k8sVolumesPrice = sumBy(nodesPrices, 'k8sVolumes');
    const nativeVolumesPrice = sumBy(nodesPrices, 'nativeVolumes');
    const orphanedVolumesPrice = sumBy(orphanedVolumes, 'volumePrice');
    const lbsPrice = sumBy(lbsPrices, 'total');
    const totals = {
        total: round(nodesPrice + allVolumesPrice + lbsPrice + k8sPrice, 5),
        nodes: round(nodesPrice, 5),
        volumes: round(allVolumesPrice, 5),
        k8sVolumes: round(k8sVolumesPrice, 5),
        nativeVolumes: round(nativeVolumesPrice, 5),
        loadBalancers: round(lbsPrice, 5),
        ...(k8sPrice > 0 ? {k8s: k8sPrice} : {}),
        ...(orphanedVolumesPrice > 0 ? {orphanedVolumes: round(orphanedVolumesPrice, 5)} : {})
    };

    // pods
    const sumResources = list => list
        .reduce((acc, {cpu, memory}) => ({cpu: acc.cpu + cpu, memory: acc.memory + memory}), {cpu: 0, memory: 0});
    const pods = cluster.pods.map(({containers, ...rest}) => {
        const resources = sumResources(containers
            .map(({resources: {limits, requests}}) => requests || limits || {})
            .map(({cpu = '100m', memory = '32Mi'}) => ({cpu: cpuParser(cpu), memory: memoryParser(memory)})));
        return {...rest, resources};
    });

    const nodesPods = groupBy(pods, 'nodeName');
    const nodesPodsCount = mapValues(nodesPods, 'length');
    const nodesRequestedResources = mapValues(nodesPods,
        nodePods => sumResources(nodePods.map(({resources}) => resources)));

    const namespacesPods = groupBy(pods, 'namespace');
    const namespacesPodsCount = mapValues(namespacesPods, 'length');

    const namespacesLoadbalancers = groupBy(lbsPrices, 'namespace');
    const namespacesLoadbalancersPrice = mapValues(namespacesLoadbalancers, lbs => sumBy(lbs, 'total'));

    const podK8sPrice = k8sPrice / pods.length;

    // pod cost is a sum of:
    // - node cost share calculated as pod resource allocation ratio to total resource allocation on the node
    //       23% of node cost is memory cost, 77& is cpu
    // - boot volume cost divided equaly between pods on the node
    // - pod volumes cost
    // - loadblancers cost in a namespaces divided equaly between pods in the namespace
    // - cloud cluster cost (if any) divided equaly between pods
    const podsPrices = pods.map(({name, namespace, labels, owner, nodeName, resources, volumes}) => {
        const {node: nodeCost = 0, nativeVolumes: nodeNativeVolumesCost = 0} =
            nodesPrices.find(({name: nn}) => nn === nodeName) || {}; // TODO Azure virtual node support?

        const nodeCpuCost = nodeCost * 0.77;
        const nodeMemoryCost = nodeCost * 0.23;
        const podCpuCost = nodeCpuCost * (resources.cpu / nodesRequestedResources[nodeName].cpu);
        const podMemoryCost = nodeMemoryCost * (resources.memory / nodesRequestedResources[nodeName].memory);

        const podNativeVolumesCost = nodeNativeVolumesCost / nodesPodsCount[nodeName];

        const podLbsCost = (namespacesLoadbalancersPrice[namespace] || 0) / namespacesPodsCount[namespace];

        const podPrice = podCpuCost + podMemoryCost + podNativeVolumesCost + podLbsCost + podK8sPrice;

        const podVolumesPrice = sum(volumes.map(({claimName}) => {
            if (isEmpty(claimName)) return 0;
            const {id: volumeId} = cluster.volumes
                .filter(({claim}) => claim)
                .find(({claim: {name: cn, namespace: ns}}) => cn === claimName && ns === namespace) || {};
            if (isEmpty(volumeId)) return 0;
            const {type = cloud.defaults.volumeType, size = 0} =
                cloud.volumes.find(({id: cloudId}) => cloudId === volumeId) || {};
            const volumePrice = (prices.volume[type] * size) / (30 * 24);
            return volumePrice;
        }));

        return {
            name,
            namespace,
            labels: {...resourceOwner(owner, cluster.controllers), ...labels}, // TODO propogate owner labels
            node: nodeName,
            pod: round(podPrice, 8),
            volumes: round(podVolumesPrice, 8)
        };
    });

    // namespace totals
    const namespacesPodsPrices = groupBy(podsPrices, 'namespace');
    const namespacesPodsTotals = mapValues(namespacesPodsPrices, p => sumBy(p, 'pod'));
    const namespacesVolumesTotals = mapValues(namespacesPodsPrices, p => sumBy(p, 'volumes'));
    const namespacesTotals = {
        pods: round(sum(Object.values(namespacesPodsTotals)), 5),
        volumes: round(sum(Object.values(namespacesVolumesTotals)), 5),
        namespaces: uniq(Object.keys(namespacesPodsTotals).concat(Object.keys(namespacesVolumesTotals)))
            .map(namespace => ({
                namespace,
                nodes: uniq(namespacesPodsPrices[namespace].map(({node}) => node)),
                pod: round(namespacesPodsTotals[namespace] || 0, 5),
                volumes: round(namespacesVolumesTotals[namespace] || 0, 5)
            }))
    };

    return {
        totals,
        nodes: nodesPrices,
        loadBalancers: lbsPrices,
        orphanedVolumes,
        pods: podsPrices,
        ...(namespacesTotals.pods > 0 ? {namespaces: namespacesTotals} : {})
    };
}

module.exports = {join, ownerLabel};
