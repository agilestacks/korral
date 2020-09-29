const {cluster: kCluster} = require('./kubernetes');
const {cloud: awsCloud, awsServices} = require('./cloud');
const {prices: awsPrices} = require('./prices');
const {join} = require('./model');

async function collect({k8sApi, awsApi = null, dump}, kopts = {}) {
    const cluster = await kCluster(k8sApi, kopts);
    dump({cluster});

    const {meta: {region, zones, instanceTypes}} = cluster;

    const aws = awsApi || awsServices(region);

    const cloud = await awsCloud(aws);
    dump({cloud});

    const prices = await awsPrices({region, zones, instanceTypes});
    dump({prices});

    const costs = join(cluster, cloud, prices);
    dump({costs});

    return {cluster, cloud, prices, costs, k8sApi, awsApi: aws, dump};
}

module.exports = {collect};
