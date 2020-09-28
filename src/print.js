const aws = require('aws-sdk');
const awsConfig = require('aws-config');

const {collect} = require('./collect');
const {cluster} = require('./kubernetes');
const {cloud} = require('./cloud');
const {prices} = require('./prices');
const {dump} = require('./util');

function printTotals(totals) {
    const {total, nodes, volumes, loadBalancers, k8s} = totals;
    console.log(`Cluster price:
    Total:   ${total} US$ per hour
    Nodes:   ${nodes}
    Volumes: ${volumes}
    ELBs:    ${loadBalancers}
    K8s:     ${k8s}`);
}

async function print(ctx) {
    const {costs: {totals}} = await collect(ctx);
    ctx.dump(totals);
    printTotals(totals);
}

async function printKObjects(ctx) {
    const {k8sApi} = ctx;
    const kcluster = await cluster(k8sApi);
    dump(kcluster);
}

const region = process.env.AWS_DEFAULT_REGION || 'us-east-2';

async function printCObjects() {
    const ec2 = new aws.EC2(awsConfig({region}));
    const account = await cloud(ec2);
    dump(account);
}

async function printPrices() {
    const awsPrices = await prices({
        region,
        zones: [`${region}a`, `${region}b`],
        instanceTypes: ['t3a.medium', 'm5.large']
    });
    dump(awsPrices);
}

module.exports = {print, printTotals, printKObjects, printCObjects, printPrices};
