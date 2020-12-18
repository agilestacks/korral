const aws = require('aws-sdk');
const awsConfig = require('aws-config');
const moment = require('moment');
const {flatMap, fromPairs, sumBy, toPairs} = require('lodash');

// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/index.html

const defaults = {
    volumeType: 'gp2'
};

async function services(region) {
    const conf = awsConfig({region});
    const ec2 = new aws.EC2(conf);
    const elb = new aws.ELB(conf);
    const elbv2 = new aws.ELBv2(conf);
    const cloudwatch = new aws.CloudWatch(conf);
    return {ec2, elb, elbv2, cloudwatch};
}

async function instances({ec2}) {
    const {Reservations: r} = await ec2.describeInstances().promise();
    const vms = flatMap(r, ({Instances: i}) => i.map(({
        InstanceId: id,
        InstanceType: instanceType,
        PrivateDnsName: name,
        VpcId: vpc,
        InstanceLifecycle: lifecycle = 'ondemand'
    }) => ({name, id, instanceType, vpc, lifecycle})));
    return vms;
}

async function volumes({ec2}) {
    const {Volumes: v} = await ec2.describeVolumes().promise();
    const vols = v.map(({
        VolumeId: id, VolumeType: type, Size: size, AvailabilityZone: zone, Attachments
    }) => ({
        id,
        type,
        size,
        zone,
        attachments: Attachments.map(({InstanceId}) => InstanceId)
    }));
    return vols;
}

async function loadBalancers({elb, elbv2, cloudwatch}, {filter = () => true} = {}) {
    const [{LoadBalancerDescriptions: l}, {LoadBalancers: l2}] = await Promise.all([
        elb.describeLoadBalancers().promise(),
        elbv2.describeLoadBalancers().promise()
    ]);

    // TODO sync with Azure and GCP 1h?
    const period = 24; // hours
    const start = moment.utc().subtract(period, 'h').format();
    const end = moment.utc().format();

    const params = {
        Namespace: 'AWS/ELB',
        MetricName: 'EstimatedProcessedBytes',
        StartTime: start,
        EndTime: end,
        Period: period * 3600,
        Statistics: ['Sum'],
        Unit: 'Bytes'
    };
    const lbs = await Promise.all(l.filter(filter).map(async ({DNSName, LoadBalancerName}) => {
        const {Datapoints: d} = await cloudwatch.getMetricStatistics(
            {...params, Dimensions: [{Name: 'LoadBalancerName', Value: LoadBalancerName}]}).promise();
        return {
            dnsName: DNSName,
            type: 'elb',
            bytes: Math.floor(sumBy(d, 'Sum') / period)
        };
    }));

    const params2 = {
        Namespace: 'AWS/NetworkELB',
        MetricName: 'ConsumedLCUs',
        StartTime: start,
        EndTime: end,
        Period: period * 3600,
        Statistics: ['Sum'],
        Unit: 'Count'
    };
    const lbs2 = await Promise.all(l2.filter(filter).map(async ({DNSName, LoadBalancerName, LoadBalancerArn: arn}) => {
        const name = `net/${LoadBalancerName}${arn.substr(arn.lastIndexOf('/'))}`;
        const {Datapoints: d} = await cloudwatch.getMetricStatistics(
            {...params2, Dimensions: [{Name: 'LoadBalancer', Value: name}]}).promise();
        return {
            dnsName: DNSName,
            type: 'nlb',
            lcus: Math.floor(sumBy(d, 'Sum') / period)
        };
    }));

    return [...lbs, ...lbs2];
}

async function cloud(apis, {filters = {}} = {}) {
    const objs = {instances, volumes, loadBalancers};
    const account = fromPairs(await Promise.all(
        toPairs(objs).map(([key, getter]) => getter(apis, {filter: filters[key]}).then(r => ([key, r])))));
    return {...account, defaults};
}

module.exports = {services, cloud, instances, volumes, loadBalancers};
