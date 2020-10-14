const fs = require('fs');
const util = require('util');
const request = require('request');
const moment = require('moment');
const {fromPairs, map, toNumber, zip} = require('lodash');

async function zoneSpot(ec2, zone, instanceTypes) {
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
        SpotPrice: price
    }) => ({
        instanceType,
        price: toNumber(price)
    }));
    return prices;
}

async function spot(ec2, zones, instanceTypes) {
    const prices = await Promise.all(zones.map(zone => zoneSpot(ec2, zone, instanceTypes)));
    return fromPairs(zip(zones, prices));
}

async function ondemand(region, instanceTypes) {
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
                price: {USD: price},
                attributes: {'aws:ec2:instanceType': instanceType}
            }) => ({
                instanceType,
                price: toNumber(price)
            }));
        fs.writeFileSync(filename, JSON.stringify(prices));
    }
    prices = prices.filter(({instanceType}) => instanceTypes.includes(instanceType));
    return prices;
}

// TODO not all regions are present in AWS ELB pricing file
function loadElbPrices() {
    const {config: {regions}} = JSON.parse(fs.readFileSync('src/prices/aws-elb.json'));
    const prices = fromPairs(regions.map(({region, types: [{values}]}) => {
        const {prices: {USD: hour}} = values.find(({rate}) => rate === 'perELBHour');
        const {prices: {USD: gigabyte}} = values.find(({rate}) => rate === 'perGBProcessed');
        return [region, {elb: {hour: toNumber(hour), gigabyte: toNumber(gigabyte)}}];
    }));
    return prices;
}

const elbPrices = loadElbPrices();

function loadBalancer(region) {
    const elb = {elb: {hour: 0.025, gigabyte: 0.008}};
    const nlb = {nlb: {hour: 0.03, gigabyte: 0}};
    return {...(elbPrices[region] || elb), ...nlb};
}

function loadVolumePrices() {
    const translate = {
        ebsGPSSD: 'gp2',
        ebsPIOPSSSD: 'io1',
        ebsTOHDD: 'st1',
        ebsColdHDD: 'sc1'
    };
    const {config: {regions}} = JSON.parse(fs.readFileSync('src/prices/aws-ebs.json'));
    const prices = fromPairs(regions.map(({region, types}) => {
        const kinds = fromPairs(types.filter(({name}) => translate[name]).map(({name, values}) => {
            const {prices: {USD: gigabyte}} = values.find(({rate}) => rate === 'perGBmoProvStorage');
            return [translate[name], toNumber(gigabyte)];
        }));
        return [region, kinds];
    }));
    return prices;
}

const volumePrices = loadVolumePrices();

function volume(region) {
    return volumePrices[region] ||
        {gp2: 0.10, io1: 0.125, st1: 0.045, sc1: 0.025};
}

function eks() {
    return {eks: 0.10};
}

async function list({ec2}, {region, zones, instances}) {
    const instanceTypes = map(instances, 'type');
    const [spotPrices, ondemandPrices] = await Promise.all([
        spot(ec2, zones, instanceTypes),
        ondemand(region, instanceTypes)
    ]);
    const prices = {
        spot: spotPrices,
        ondemand: ondemandPrices,
        loadBalancer: loadBalancer(region),
        volume: volume(region),
        k8s: eks()
    };
    return prices;
}

module.exports = {prices: list, spot, ondemand, loadBalancer, volume, eks};
