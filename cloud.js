const {flatMap} = require('lodash');

async function instances(ec2) {
    const {Reservations: r} = await ec2.describeInstances().promise();
    const cloudVms = flatMap(r, ({Instances: i}) => i.map(({
        InstanceId: id, InstanceType: instanceType, PrivateDnsName: name, VpcId: vpc, InstanceLifecycle: lifecycle
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

module.exports = {instances, volumes};
