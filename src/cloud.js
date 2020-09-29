const aws = require('aws-sdk');
const awsConfig = require('aws-config');
const moment = require('moment');
const {flatMap, fromPairs, sumBy, toPairs} = require('lodash');

function awsServices(region) {
    const conf = awsConfig({region});
    const ec2 = new aws.EC2(conf);
    const elb = new aws.ELB(conf);
    const cloudwatch = new aws.CloudWatch(conf);
    return {ec2, elb, cloudwatch};
}

async function instances({ec2}) {
    const {Reservations: r} = await ec2.describeInstances().promise();
    const cloudVms = flatMap(r, ({Instances: i}) => i.map(({
        InstanceId: id,
        InstanceType: instanceType,
        PrivateDnsName: name,
        VpcId: vpc,
        InstanceLifecycle: lifecycle = 'ondemand'
    }) => ({name, id, instanceType, vpc, lifecycle})));
    return cloudVms;
}

async function volumes({ec2}) {
    const {Volumes: v} = await ec2.describeVolumes().promise();
    const cloudVolumes = v.map(({
        VolumeId: id, VolumeType: type, Size, AvailabilityZone: zone, Attachments
    }) => ({
        id,
        type,
        size: Size,
        zone,
        attachments: Attachments.map(({InstanceId}) => InstanceId)
    }));
    return cloudVolumes;
}

async function loadBalancers({elb, cloudwatch}, filter = null) {
    const {LoadBalancerDescriptions: l} = await elb.describeLoadBalancers().promise();
    const period = 24; // hours
    const params = {
        Namespace: 'AWS/ELB',
        MetricName: 'EstimatedProcessedBytes',
        StartTime: moment.utc().subtract(period, 'h').format(),
        EndTime: moment.utc().format(),
        Period: period * 3600,
        Statistics: ['Sum'],
        Unit: 'Bytes'
    };
    const lbs = await Promise.all(l.filter(filter || (() => true)).map(async ({DNSName, LoadBalancerName}) => {
        const {Datapoints: d} = await cloudwatch.getMetricStatistics(
            {...params, Dimensions: [{Name: 'LoadBalancerName', Value: LoadBalancerName}]}).promise();
        return {
            dnsName: DNSName,
            bytes: Math.floor(sumBy(d, 'Sum') / period)
        };
    }));
    return lbs;
}

async function cloud(services, filters = {}) {
    const objs = {instances, volumes, loadBalancers};
    const account = fromPairs(await Promise.all(
        toPairs(objs).map(([key, getter]) => getter(services, filters[key]).then(r => ([key, r])))));
    return account;
}

module.exports = {awsServices, cloud, instances, volumes, loadBalancers};
