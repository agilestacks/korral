const http = require('http');

const {collect} = require('./collect');
const {printTotals} = require('./print');

async function scrape(init) {
    const ctx = await collect(init);

    const {costs: {totals, nodes, loadBalancers}} = ctx;
    const {k8s} = totals;

    const nodesCost = nodes.map(
        ({name, node}) => `korral_cluster_node_cost_per_hour_dollars{node="${name}"} ${node}`);
    const volumesCost = nodes.map(
        ({name, volumes}) => `korral_cluster_node_volumes_cost_per_hour_dollars{node="${name}"} ${volumes}`);
    const lbsCost = loadBalancers.map(
        ({hostname, total}) => `korral_cluster_loadbalancer_cost_per_hour_dollars{hostname="${hostname}"} ${total}`);
    const k8sCost = `korral_cluster_k8s_cost_per_hour_dollars ${k8s > 0 ? k8s : 0}`;

    const prometheus = `
# HELP korral_cluster_node_cost_dollars Cluster node cost without cost of attached volumes
# TYPE korral_cluster_node_cost_dollars gauge
${nodesCost.join('\n')}

# HELP korral_cluster_node_volumes_cost_dollars Cluster node attached volumes cost
# TYPE korral_cluster_node_volumes_cost_dollars gauge
${volumesCost.join('\n')}

# HELP korral_cluster_loadbalancer_cost_dollars Cluster loadbalancer cost
# TYPE korral_cluster_loadbalancer_cost_dollars gauge
${lbsCost.join('\n')}

# HELP korral_cluster_k8s_cost_dollars Cluster cloud provider cost
# TYPE korral_cluster_k8s_cost_dollars gauge
${k8sCost}
`;

    return {prometheus, ctx};
}

async function checkScrape(init) {
    const {prometheus, ctx} = await scrape(init);
    const {costs: {totals}} = ctx;
    printTotals(totals);
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
                    const {prometheus: body, ctx} = await scrape(this.init);
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
