const {fromPairs} = require('lodash');

/* TODO proper GCE prices
https://cloud.google.com/billing/v1/how-tos/catalog-api
https://cloud.google.com/billing/docs/reference/rest/v1/services.skus/list
https://cloudbilling.googleapis.com/v1/services/6F81-5844-456A/skus?key=
Fetch pages with &pageToken=.nextPageToken until nextPageToken is empty.
&pageSize=5000 is the default and also max page size.
Attack this by parsing category { resourceFamily, resourceGroup, usageType }, description.
Kubernetes node has capacity { cpu, nmemory } exposed.
*/

async function list(settings, {region, zones, instanceTypes}) {
    const prices = {
        preemptible: fromPairs(zones.map(
            zone => [zone, instanceTypes.map(instanceType => ({instanceType, price: 0.02}))])),
        ondemand: instanceTypes.map(instanceType => ({instanceType, price: 0.05})),
        loadBalancer: {external: {hour: 0.025, gigabyte: 0.12}},
        volume: {'pd-standard': 0.04, 'pd-ssd': 0.17},
        k8s: {gke: 0}
    };
    return prices;
}

module.exports = {prices: list};

/*
    {
      "name": "services/6F81-5844-456A/skus/4E32-F036-B1D1",
      "skuId": "4E32-F036-B1D1",
      "description": "Preemptible E2 Instance Core running in Virginia",
      "category": {
        "serviceDisplayName": "Compute Engine",
        "resourceFamily": "Compute",
        "resourceGroup": "CPU",
        "usageType": "Preemptible"
      },
      "serviceRegions": [
        "us-east4"
      ],
      "pricingInfo": [
        {
          "summary": "",
          "pricingExpression": {
            "usageUnit": "h",
            "usageUnitDescription": "hour",
            "baseUnit": "s",
            "baseUnitDescription": "second",
            "baseUnitConversionFactor": 3600,
            "displayQuantity": 1,
            "tieredRates": [
              {
                "startUsageAmount": 0,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 7370235
                }
              }
            ]
          },
          "currencyConversionRate": 1,
          "effectiveTime": "2020-10-05T10:18:44.165Z"
        }
      ],
      "serviceProviderName": "Google",
      "geoTaxonomy": {
        "type": "REGIONAL",
        "regions": [
          "us-east4"
        ]
      }
    },

    {
      "name": "services/6F81-5844-456A/skus/BB7E-A48A-0879",
      "skuId": "BB7E-A48A-0879",
      "description": "Preemptible E2 Instance Ram running in Virginia",
      "category": {
        "serviceDisplayName": "Compute Engine",
        "resourceFamily": "Compute",
        "resourceGroup": "RAM",
        "usageType": "Preemptible"
      },
      "serviceRegions": [
        "us-east4"
      ],
      "pricingInfo": [
        {
          "summary": "",
          "pricingExpression": {
            "usageUnit": "GiBy.h",
            "usageUnitDescription": "gibibyte hour",
            "baseUnit": "By.s",
            "baseUnitDescription": "byte second",
            "baseUnitConversionFactor": 3865470566400,
            "displayQuantity": 1,
            "tieredRates": [
              {
                "startUsageAmount": 0,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 987597
                }
              }
            ]
          },
          "currencyConversionRate": 1,
          "effectiveTime": "2020-10-05T10:18:44.165Z"
        }
      ],
      "serviceProviderName": "Google",
      "geoTaxonomy": {
        "type": "REGIONAL",
        "regions": [
          "us-east4"
        ]
      }
    },

    {
      "name": "services/6F81-5844-456A/skus/8AF1-1146-E7DA",
      "skuId": "8AF1-1146-E7DA",
      "description": "Storage PD Capacity in Virginia",
      "category": {
        "serviceDisplayName": "Compute Engine",
        "resourceFamily": "Storage",
        "resourceGroup": "PDStandard",
        "usageType": "OnDemand"
      },
      "serviceRegions": [
        "us-east4"
      ],
      "pricingInfo": [
        {
          "summary": "",
          "pricingExpression": {
            "usageUnit": "GiBy.mo",
            "usageUnitDescription": "gibibyte month",
            "baseUnit": "By.s",
            "baseUnitDescription": "byte second",
            "baseUnitConversionFactor": 2.8759101014016e+15,
            "displayQuantity": 1,
            "tieredRates": [
              {
                "startUsageAmount": 0,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 44000000
                }
              }
            ]
          },
          "currencyConversionRate": 1,
          "effectiveTime": "2020-10-05T10:18:44.165Z"
        }
      ],
      "serviceProviderName": "Google",
      "geoTaxonomy": {
        "type": "REGIONAL",
        "regions": [
          "us-east4"
        ]
      }
    },

    {
      "name": "services/6F81-5844-456A/skus/75B0-B95E-76A8",
      "skuId": "75B0-B95E-76A8",
      "description": "SSD backed PD Capacity in Virginia",
      "category": {
        "serviceDisplayName": "Compute Engine",
        "resourceFamily": "Storage",
        "resourceGroup": "SSD",
        "usageType": "OnDemand"
      },
      "serviceRegions": [
        "us-east4"
      ],
      "pricingInfo": [
        {
          "summary": "",
          "pricingExpression": {
            "usageUnit": "GiBy.mo",
            "usageUnitDescription": "gibibyte month",
            "baseUnit": "By.s",
            "baseUnitDescription": "byte second",
            "baseUnitConversionFactor": 2.8759101014016e+15,
            "displayQuantity": 1,
            "tieredRates": [
              {
                "startUsageAmount": 0,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 187000000
                }
              }
            ]
          },
          "currencyConversionRate": 1,
          "effectiveTime": "2020-10-05T10:18:44.165Z"
        }
      ],
      "serviceProviderName": "Google",
      "geoTaxonomy": {
        "type": "REGIONAL",
        "regions": [
          "us-east4"
        ]
      }
    },

    {
      "name": "services/6F81-5844-456A/skus/1A51-8906-72EB",
      "skuId": "1A51-8906-72EB",
      "description": "Network Internet Egress from Virginia to Americas",
      "category": {
        "serviceDisplayName": "Compute Engine",
        "resourceFamily": "Network",
        "resourceGroup": "PremiumInternetEgress",
        "usageType": "OnDemand"
      },
      "serviceRegions": [
        "us-east4"
      ],
      "pricingInfo": [
        {
          "summary": "",
          "pricingExpression": {
            "usageUnit": "GiBy",
            "usageUnitDescription": "gibibyte",
            "baseUnit": "By",
            "baseUnitDescription": "byte",
            "baseUnitConversionFactor": 1073741824,
            "displayQuantity": 1,
            "tieredRates": [
              {
                "startUsageAmount": 0,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 120000000
                }
              },
              {
                "startUsageAmount": 1024,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 110000000
                }
              },
              {
                "startUsageAmount": 10240,
                "unitPrice": {
                  "currencyCode": "USD",
                  "units": "0",
                  "nanos": 80000000
                }
              }
            ]
          },
          "aggregationInfo": {
            "aggregationLevel": "ACCOUNT",
            "aggregationInterval": "MONTHLY",
            "aggregationCount": 1
          },
          "currencyConversionRate": 1,
          "effectiveTime": "2020-10-05T10:18:44.165Z"
        }
      ],
      "serviceProviderName": "Google"
    },
*/
