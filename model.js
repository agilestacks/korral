/* eslint-disable no-console */
const {get, round, sum, toNumber} = require('lodash');

function join(cluster, cloud, prices) {
    const nodesPrices = cluster.nodes.map(({name, id: instId, instanceType, zone, volumes}) => {
        const instanceId = instId.split('/')[4];
        const {instanceType: cloudInstanceType, lifecycle} = cloud.instances.find(
            ({id: cloudId}) => cloudId === instanceId);
        if (instanceType !== cloudInstanceType) {
            console.log(
                `Instance ${instanceId} type is ${cloudInstanceType}, but listed as ${instanceType} in Kubernetes`);
        }
        let {price: nodePrice} = (lifecycle === 'spot' ? prices.spot[zone] : prices.ondemand)
            .find(({instanceType: priceInstanceType}) => priceInstanceType === cloudInstanceType);
        nodePrice = toNumber(nodePrice);

        const volumesPrice = sum(volumes.map((volId) => {
            const volumeId = volId.split('/')[3];
            const {type, size, attachments} = cloud.volumes.find(({id: cloudId}) => cloudId === volumeId);
            const volumePrice = (prices.volume[type] * size) / (30 * 24);
            if (!attachments.includes(instanceId)) {
                console.log(
                    `Instance ${instanceId} volume ${volumeId} is not attached according to the cloud inventory`);
            }
            return volumePrice;
        }));

        return {
            name,
            total: round(nodePrice + volumesPrice, 5),
            node: round(nodePrice, 5),
            volumes: round(volumesPrice, 5)
        };
    });

    const lbsPrices = cluster.loadBalancers.map(({hostname, type}) => {
        const loadBalancerPrice = prices.loadBalancer[type];
        return {
            hostname,
            loadBalancer: loadBalancerPrice,
            total: loadBalancerPrice
        };
    });

    const k8sPrice = get(prices.k8s, cluster.meta.kind, 0);
    const nodesPrice = sum(nodesPrices.map(({node}) => node));
    const volumesPrice = sum(nodesPrices.map(({volumes}) => volumes));
    const lbsPrice = sum(lbsPrices.map(({loadBalancer}) => loadBalancer));
    const totals = {
        total: round(nodesPrice + volumesPrice + lbsPrice + k8sPrice, 5),
        nodes: round(nodesPrice, 5),
        volumes: round(volumesPrice, 5),
        loadBalancers: round(lbsPrice, 5),
        ...(k8sPrice > 0 ? {k8s: k8sPrice} : {})
    };

    return {totals, nodes: nodesPrices, loadBalancers: lbsPrices};
}

module.exports = {join};
