const axios = require('axios');
const {flatMap, fromPairs, groupBy, map} = require('lodash');

// https://docs.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
// https://azure.microsoft.com/en-us/pricing/details/managed-disks/

const api = axios.create({
    baseURL: 'https://prices.azure.com/api',
    timeout: 10000
});

async function instanceSkus(region, instanceTypes) {
    const skus = (await Promise.all(instanceTypes.map(instanceType => api.get('/retail/prices', {
        params: {
            // eslint-disable-next-line max-len
            $filter: `armSkuName eq '${instanceType}' and armRegionName eq '${region}' and serviceName eq 'Virtual Machines'`
        }
    }).then(({data: {Items}}) => ({
        instanceType,
        items: Items.filter(
            ({unitOfMeasure, productName, skuName, reservationTerm}) => unitOfMeasure === '1 Hour'
                && !productName.includes('Windows')
                && !skuName.includes('Low Priority')
                && !reservationTerm
        )
    })))));
    return skus;
}

async function list(apis, {region, zones = ['0', '1', '2'], instances}) {
    const instanceTypes = map(instances, 'type');
    const skus = await instanceSkus(region, instanceTypes);
    const {ondemand, spot} = groupBy(flatMap(skus, ({instanceType, items}) => items.map(
        ({unitPrice: price, skuName}) => ({
            instanceType,
            price,
            lifecycle: skuName.includes('Spot') ? 'spot' : 'ondemand'
        })
    )), 'lifecycle');
    const prices = {
        spot: fromPairs(zones.map(zone => [zone, spot])),
        ondemand,
        loadBalancer: {Standard: {hour: 0.025, gigabyte: 0.005}},
        volume: {Standard_LRS: 0.05, StandardSSD_LRS: 0.075, Premium_LRS: 0.15, UltraSSD_LRS: 0.12},
        k8s: {aks: 0} // TODO Uptime SLA $0.10
    };
    return prices;
}

module.exports = {prices: list};
