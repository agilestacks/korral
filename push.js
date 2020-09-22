/* eslint-disable no-await-in-loop */
const {collect} = require('./collect');
const {printTotals} = require('./print');
const {sleep} = require('./util');

async function push(init) {
    const {opts: {interval, endpoint}} = init;
    for (let ctx = init; ;) {
        ctx = await collect(ctx);
        printTotals(ctx.costs.totals);
        await sleep(interval * 1000);
    }
}

module.exports = {push};
