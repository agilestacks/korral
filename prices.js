const fs = require('fs');
const util = require('util');
const request = require('request');
const aws = require('aws-sdk');
const awsConfig = require('aws-config');
const moment = require('moment');
const {fromPairs, zip} = require('lodash');

async function zoneSpotPrices(ec2, zone, instanceTypes) {
    const params = {
        AvailabilityZone: zone,
        DryRun: false,
        EndTime: moment.utc().add(3, 'h').format(),
        InstanceTypes: instanceTypes,
        ProductDescriptions: ['Linux/UNIX (Amazon VPC)'],
        StartTime: moment.utc().format()
    };
    const {SpotPriceHistory} = await ec2.describeSpotPriceHistory(params).promise();
    const prices = SpotPriceHistory.map(({
        InstanceType: instanceType,
        SpotPrice: spotPrice
    }) => ({
        instanceType,
        spotPrice
    }));
    return prices;
}

async function spotPrices(region, zones, instanceTypes) {
    const ec2 = new aws.EC2(awsConfig({region}));
    const prices = await Promise.all(zones.map(zone => zoneSpotPrices(ec2, zone, instanceTypes)));
    return fromPairs(zip(zones, prices));
}

async function ondemandPrices(region, instanceTypes) {
    let prices;
    const filename = `aws-ondemand-prices-${region}.json`;
    if (fs.existsSync(filename)) {
        prices = JSON.parse(fs.readFileSync(filename));
    }
    if (!prices) {
        const url = `https://a0.p.awsstatic.com/pricing/1.0/ec2/region/${region}/ondemand/linux/index.json`;
        const {body} = await util.promisify(request.get)(url);
        const {prices: raw} = JSON.parse(body);
        prices = raw.filter(({unit}) => unit === 'Hrs')
            .map(({
                price: {USD: ondemandPrice},
                attributes: {'aws:ec2:instanceType': instanceType}
            }) => ({
                instanceType,
                ondemandPrice
            }));
        fs.writeFileSync(filename, JSON.stringify(prices));
    }
    prices = prices.filter(({instanceType}) => instanceTypes.includes(instanceType));
    return prices;
}

async function volumePrices(region) {
    // TODO proper EBS pricing
    return region.startsWith('us') ?
        {gp2: 0.10, st1: 0.045} :
        {gp2: 0.12, st1: 0.054}
}

module.exports = {spotPrices, ondemandPrices, volumePrices};
