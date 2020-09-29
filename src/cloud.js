const aws = require('aws-sdk');
const awsConfig = require('aws-config');
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

// TODO given lifetime of a load-balancer and pricing, calculate hourly cost (probably, over last 24h only)
// https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_DescribeLoadBalancers.html
// collect CreatedTime, DNSName, LoadBalancerArn
// https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html
// collect ConsumedLCUs, IPv6ProcessedBytes, ProcessedBytes
async function loadBalancers({elb, cloudwatch}, filter = null) {
}

async function cloud(services, filters = {}) {
    const objs = {instances, volumes, loadBalancers};
    const account = fromPairs(await Promise.all(
        toPairs(objs).map(([key, getter]) => getter(services, filters[key]).then(r => ([key, r])))));
    return account;
}

module.exports = {awsServices, cloud, instances, volumes, loadBalancers};
