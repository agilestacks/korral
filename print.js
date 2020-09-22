const {collect} = require('./collect');

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

module.exports = {print, printTotals};
