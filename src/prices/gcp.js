const {fromPairs} = require('lodash');

// TODO proper prices
async function list(settings, {region, zones, instanceTypes}) {
    const prices = {
        preemptible: fromPairs(zones.map(
            zone => [zone, instanceTypes.map(instanceType => ({instanceType, price: 0.02}))])),
        ondemand: instanceTypes.map(instanceType => ({instanceType, price: 0.05})),
        loadBalancer: {external: {hour: 0.025, gigabyte: 0.12}},
        volume: {'pd-standard': 0.04, 'pd-ssd': 0.17},
        k8s: {gke: 0}
    };
    return prices;
}

module.exports = {prices: list};
