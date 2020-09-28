const {flatMap} = require('lodash');

async function instances(ec2) {
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

async function volumes(ec2) {
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

async function cloud(ec2) {
    const [cinst, cvol] = await Promise.all([instances(ec2), volumes(ec2)]);
    const account = {instances: cinst, volumes: cvol};
    return account;
}

module.exports = {cloud, instances, volumes};
