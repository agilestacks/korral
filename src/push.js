/* eslint-disable no-await-in-loop */
const axios = require('axios');

const {trimAxiosVerbosity} = require('./util');

const {collect} = require('./collect');
const {printTotals} = require('./print');
const {sleep} = require('./util');

const seriesResource = '/metrics/api/v1/series';

async function push(init) {
    const {dump, opts: {context, interval, endpoint, key, debug}} = init;
    const api = axios.create({
        baseURL: endpoint,
        timeout: 10000,
        ...(key ? {headers: {'x-api-secret': key}} : {}),
        validateStatus: () => true
    });

    for (let ctx = init; ;) {
        ctx = await collect(ctx);

        const {costs: {totals}} = ctx;
        printTotals(totals);

        const {nodes, volumes, loadBalancers, k8s} = totals;
        const series = Object.entries({nodes, volumes, loadBalancers, k8s})
            .map(([subsystem, value]) => ({
                metric: 'korral.k8s.cost.totals',
                kind: 'gauge',
                tags: {cluster: context, subsystem},
                value
            }));
        dump({series});
        const resp = await api.post(seriesResource, series)
            .catch(err => console.log(trimAxiosVerbosity(err)));
        if (resp && resp.status && resp.status !== 202) {
            console.log(`Expected 202 HTTP; got ${resp.status} ${resp.statusText}:\n${resp.data}`);
        }
        if (debug && resp && resp.status && resp.status === 202) {
            console.log(`${resp.status} ${resp.statusText}`);
        }
        await sleep(interval * 1000);
    }
}

module.exports = {push};
