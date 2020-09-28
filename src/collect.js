const aws = require('aws-sdk');
const awsConfig = require('aws-config');

const {cluster: kCluster} = require('./kubernetes');
const {cloud: awsCloud} = require('./cloud');
const {prices: awsPrices} = require('./prices');
const {join} = require('./model');

async function collect({k8sApi, ec2Api = null, dump}) {
    const cluster = await kCluster(k8sApi);
    dump({cluster});

    const {meta: {region, zones, instanceTypes}} = cluster;

    const ec2 = ec2Api || new aws.EC2(awsConfig({region}));

    const cloud = await awsCloud(ec2);
    dump({cloud});

    const prices = await awsPrices({region, zones, instanceTypes});
    dump({prices});

    const costs = join(cluster, cloud, prices);
    dump({costs});

    return {cluster, cloud, prices, costs, k8sApi, ec2Api: ec2, dump};
}

module.exports = {collect};
