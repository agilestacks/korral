const {cluster: kCluster} = require('./kubernetes');
const {cloud: awsCloud, services: awsServices} = require('./cloud/aws');
const {prices: awsPrices} = require('./prices');
const {join} = require('./model');

async function collect({k8sApi, awsApi = null, dump}, kopts = {}) {
    const cluster = await kCluster(k8sApi, kopts);
    dump({cluster});

    const {meta: {region, zones, instanceTypes}, loadBalancers} = cluster;
    // filter out unrelated load-balancers before going to CloudWatch Metrics for stats
    const lbHostnames = loadBalancers.map(({hostname}) => hostname);
    const lbFilter = ({DNSName}) => lbHostnames.includes(DNSName);

    const aws = awsApi || awsServices(region);

    const cloud = await awsCloud(aws, {loadBalancers: lbFilter});
    dump({cloud});

    const prices = await awsPrices({region, zones, instanceTypes});
    dump({prices});

    const costs = join(cluster, cloud, prices);
    dump({costs});

    return {cluster, cloud, prices, costs, k8sApi, awsApi: aws, dump};
}

module.exports = {collect};
