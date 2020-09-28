## Kubernetes cluster cost metrics

Korral collects Kubernetes cluster cost metrics and provides them to Prometheus. Currently, on AWS.

Exposed metrics structure adheres to Prometheus [best practices](https://prometheus.io/docs/practices/naming/) where metrics are exported on the finest granularity level but aggregation is performed in Prometheus. There are two facets though to help users write simpler queries:

1. Cluster level where cost is provided on cluster object level: node, node volumes, load-balancers, etc.;
2. **work in progress** Pod level where cost is per pod and includes pod volumes. Costs that cannot be reliably attributed to a specific pod is amortized accross all pods (in a namespace, on a node). For example, ingress controller load-balancer and it's egress traffic cost, node root volume cost.

In both cases the metrics are measured in US$ per hour. Sum of all metrics in a facet should add up to the total cluster cost, modulo rounding errors.

### Cluster level

- `korral_cluster_node_cost_per_hour_dollars` - cluster node cost without cost of attached volumes, split by `node` tag
- `korral_cluster_node_volumes_cost_per_hour_dollars` - cluster node attached volumes cost, spilt by `node` tag ; this includes Kubernetes volumes attached to the node and node root volume
- `korral_cluster_loadbalancer_cost_per_hour_dollars` - cluster loadbalancer cost, split by `hostname`
- `korral_cluster_k8s_cost_per_hour_dollars` cluster cloud provider cost if any, ie. $0.10 per hour for EKS cluster; 0 is reported if there is no additional cost.

### Pod level



### Configuration

> The default scrape timeout for Prometheus is 10 seconds. If your exporter can be expected to exceed this, you should explicitly call this out in your user documentation.

Installed Prometheus `ServiceMonitor` custom resource configures the timeout to 20sec. You may want to change this.
