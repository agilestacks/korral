const http = require('http');
const {isEmpty} = require('lodash');

const {collect} = require('./collect');
const {printTotals, printNamespaceTotals} = require('./print');

// https://prometheus.io/docs/practices/naming/
// https://prometheus.io/docs/concepts/data_model/

function promLabels(labels) {
    if (isEmpty(labels)) return '';
    const str = Object.entries(labels)
        .map(([key, value]) => `${key.replace(/[^a-zA-Z0-9_]/g, '_')}="${value}"`).join(',');
    return `,${str}`;
}

/* eslint-disable max-len, implicit-arrow-linebreak */
async function scrape(init, kopts) {
    const ctx = await collect(init, kopts);

    const {costs: {totals, nodes, loadBalancers, orphanedVolumes, pods}} = ctx;
    const {k8s = 0} = totals;

    const nodesCost = nodes.map(
        ({name, node}) =>
            `korral_cluster_node_cost_per_hour_dollars{node="${name}"} ${node}`);
    const nodeVolumesCost = nodes.map(
        ({name, allVolumes}) =>
            `korral_cluster_node_volumes_cost_per_hour_dollars{node="${name}"} ${allVolumes}`);
    const lbsCost = loadBalancers.map(
        ({hostname, loadBalancer}) =>
            `korral_cluster_loadbalancer_cost_per_hour_dollars{hostname="${hostname}"} ${loadBalancer}`);
    const lbsTrafficCost = loadBalancers.map(
        ({hostname, traffic}) =>
            `korral_cluster_loadbalancer_traffic_cost_per_hour_dollars{hostname="${hostname}"} ${traffic}`);
    const k8sCost = `korral_cluster_k8s_cost_per_hour_dollars ${k8s}`;
    const orphanedVolumesCost = (orphanedVolumes.length > 0 ? orphanedVolumes : [{volumePrice: 0}]).map(
        ({volumePrice, namespace = 'unknown', claim = 'unknown'}) =>
            `korral_cluster_orphaned_volumes_cost_per_hour_dollars{claim_namespace="${namespace}",claim="${claim}"} ${volumePrice}`);
    const podsCost = pods.map(
        ({name, namespace, node, labels, pod}) =>
            `korral_cluster_pod_cost_per_hour_dollars{name="${name}",pod_namespace="${namespace}",node="${node}"${promLabels(labels)}} ${pod}`);
    const podVolumesCost = pods.filter(({volumes}) => volumes).map(
        ({name, namespace, node, labels, volumes}) =>
            `korral_cluster_pod_volumes_cost_per_hour_dollars{name="${name}",pod_namespace="${namespace}",node="${node}"${promLabels(labels)}} ${volumes}`);

    const prometheus = `
# HELP korral_cluster_node_cost_dollars Cluster node cost without cost of attached volumes
# TYPE korral_cluster_node_cost_dollars gauge
${nodesCost.join('\n')}

# HELP korral_cluster_node_volumes_cost_dollars Cluster node attached volumes cost
# TYPE korral_cluster_node_volumes_cost_dollars gauge
${nodeVolumesCost.join('\n')}

# HELP korral_cluster_loadbalancer_cost_dollars Cluster loadbalancer cost without egress
# TYPE korral_cluster_loadbalancer_cost_dollars gauge
${lbsCost.join('\n')}

# HELP korral_cluster_loadbalancer_traffic_cost_per_hour_dollars Cluster loadbalancer ingress/egress and LCU cost
# TYPE korral_cluster_loadbalancer_traffic_cost_per_hour_dollars gauge
${lbsTrafficCost.join('\n')}

# HELP korral_cluster_k8s_cost_dollars Cluster cloud provider cost
# TYPE korral_cluster_k8s_cost_dollars gauge
${k8sCost}

# HELP korral_cluster_orphaned_volumes_cost_per_hour_dollars Cluster orphaned volumes cost
# TYPE korral_cluster_orphaned_volumes_cost_per_hour_dollars gauge
${orphanedVolumesCost.join('\n')}

# HELP korral_cluster_pod_cost_per_hour_dollars Pod cost without cost of attached volumes
# TYPE korral_cluster_pod_cost_per_hour_dollars gauge
${podsCost.join('\n')}

# HELP korral_cluster_pod_volumes_cost_per_hour_dollars Pod volumes cost
# TYPE korral_cluster_pod_volumes_cost_per_hour_dollars gauge
${podVolumesCost.join('\n')}
`;

    return {prometheus, ctx};
}
/* eslint-enable max-len, implicit-arrow-linebreak */

async function checkScrape(init) {
    const {prometheus, ctx} = await scrape(init, {pods: true});
    const {costs: {totals, namespaces}} = ctx;
    printTotals(totals);
    if (namespaces) printNamespaceTotals(namespaces);
    console.log(prometheus);
}

function handler(path, init) {
    const context = {
        init,
        async handle(request, response) {
            const {method, url} = request;
            const {pathname: requestPath} = new URL(url, `http://${request.headers.host}`);
            console.log(`${method} ${requestPath}`);
            try {
                if (requestPath === path) {
                    const {prometheus: body, ctx} = await scrape(this.init, {pods: true});
                    this.init = ctx;
                    response.writeHead(200, {'content-type': 'text/plain'}).end(body);
                } else if (requestPath === '/') {
                    response.writeHead(307, {location: path}).end();
                } else if (requestPath === '/ping') {
                    response.writeHead(200).end('pong');
                } else {
                    response.writeHead(404).end();
                }
            } catch (err) {
                console.log(`Error while processing request: ${err}`);
                response.writeHead(500).end(err.message);
            }
        }
    };
    return context.handle.bind(context);
}

async function expose(ctx) {
    const {opts: {port, path, check}} = ctx;
    if (check) await checkScrape(ctx);
    const server = http.createServer(handler(path, ctx));
    server.listen(port, () => { console.log(`Listening on port ${port}`); });
}

module.exports = {expose};
