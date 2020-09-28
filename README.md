## Kubernetes cluster cost metrics

Korral collects Kubernetes cluster cost metrics and provides them to Prometheus. Currently, on AWS.

Exposed metrics structure adheres to Prometheus [best practices](https://prometheus.io/docs/practices/naming/) where metrics are exported on fine granularity level, then aggregation is performed in Prometheus. There are two facets though to help users write simpler queries:

1. Cluster level where cost is provided on cluster object level: node, node volumes, load-balancers, etc.;
2. Pod level where cost is per pod and includes pod volumes. Costs that cannot be reliably attributed to a specific pod is amortized accross all pods (in a namespace, on a node). For example, ingress controller load-balancer and it's egress traffic cost, or node boot volume cost.

In both cases the metrics are measured in US$ per hour. Sum of all metrics in a facet should add up to the total cluster cost, modulo rounding errors. Note that orphan volumes costs are not included in _Pod level_ facet.

### Cluster level

- `korral_cluster_node_cost_per_hour_dollars` - cluster node cost without cost of attached volumes, split by `node` tag
- `korral_cluster_node_volumes_cost_per_hour_dollars` - cluster node attached volumes cost, spilt by `node` tag ; this includes Kubernetes volumes attached to the node and node boot volume
- `korral_cluster_loadbalancer_cost_per_hour_dollars` - cluster loadbalancer cost, split by `hostname`
- `korral_cluster_loadbalancer_taffic_cost_per_hour_dollars` - cluster loadbalancer ingress/egress traffic and LCUs cost, split by `hostname`
- `korral_cluster_orphaned_volumes_cost_per_hour_dollars` - cluster volumes that exist but not used if any, split by `claim_namespace`, `claim` tags if corresponding PVC exists
- `korral_cluster_k8s_cost_per_hour_dollars` cluster cloud provider cost if any, ie. $0.10 per hour for EKS cluster; `0` is reported if there is no additional cost.

### Pod level

- `korral_cluster_pod_cost_per_hour_dollars` - pod cost without cost of attached volumes, split by `name`, `pod_namespace`, `node` tags
- `korral_cluster_pod_volumes_cost_per_hour_dollars` - pod volumes cost if any, split by `name`, `pod_namespace`, `node` tags

Cost model makes a few arbitrary assumptions:

1. A sum of pod containers `resources.requests` is used to determine pod share of node total cost. If no `requests` are available, then `limits` are used, else `{ cpu: '100m', memory: '32Mi' }`. RAM cost is 23% of instance cost; this is more or less true for AWS _General Purpose_ instance types. Thus the cost will change as pods are rescheduled.
2. Cost of node volumes that are not Kubernetes volumes are amortized across pods on that particular node.
3. Load-balancer cost is spread across namespace pods evenly. There should be at least one pod.
4. Cluster cloud provider cost (if any, EKS $0.10) is spread across all pods.
5. Only `Running` pods are counted.
6. Orphan volumes costs are not attributed to any pod.

### Configuration

> The default scrape timeout for Prometheus is 10 seconds. If your exporter can be expected to exceed this, you should explicitly call this out in your user documentation.

Installed Prometheus `ServiceMonitor` custom resource configures the timeout to 20sec. You may want to change that.
