[![travis](https://travis-ci.org/lemoncloud-io/lemon-core.svg?branch=master)](https://travis-ci.org/lemoncloud-io/lemon-core)
[![codecov](https://codecov.io/gh/lemoncloud-io/lemon-core/branch/master/graph/badge.svg)](https://codecov.io/gh/lemoncloud-io/lemon-core)
[![npm version](https://badge.fury.io/js/lemon-core.svg)](https://badge.fury.io/js/lemon-core)
[![GitHub version](https://badge.fury.io/gh/lemoncloud-io%2Flemon-core.svg)](https://badge.fury.io/gh/lemoncloud-io%2Flemon-core)


# lemon-core

Lemon Core Bootloader for Serverless Micro-Service


## Contribution

Plz, request PR. See [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md)


## LICENSE

[MIT](LICENSE)



----------------
# VERSION INFO #

| Version   | Description
|--         |--
| 2.0.0     | remove `lemon-engine`, and support fully typescript.
| 1.2.16    | improve `doReportError` for service name
| 1.2.15    | improve `doReportError` with error message
| 1.2.14    | fix `aws credentials` in lambda.
| 1.2.13    | fix `doReportMetric()` of param.ns
| 1.2.12    | support `doReportMetric()` for metrics
| 1.2.11    | fix cli json body.
| 1.2.10    | improve `do_parrallel` to report errors.
| 1.2.9     | feat `doReportSlack` to post slack via `lemon-hello-api`
| 1.2.8     | fix `export TagSet` for ts.
| 1.2.7     | fix `s3.putObject()` return type.
| 1.2.6     | improve `doReportError` with `service` like `api://lemon-core#1.2.6`.
| 1.2.5     | improve `doReportError` in engine.
| 1.2.4     | improve `reportError` in sns service.
| 1.2.3     | improve `cors` in express.
| 1.2.2     | updated with `lemon-engine#2.2.5`
| 1.2.1     | improve aws credentials in express().
| 1.2.0     | migrate service, and cleanup `lemon-hello-api`
| 1.1.6     | update engine `lemon-engine#2.2.4`.
| 1.1.5     | support web-socket with `WSS`, `WSC`.
| 1.1.4     | improve `do_parrallel()`
| 1.1.3     | use `ROUTE_PREFIX` to config express route.
| 1.1.2     | refactoring tools with unit-test.
| 1.1.1     | optimized with `lemon-hello-api#1.3.1`
| 1.0.1     | optimize `dependencies`
| 1.0.0     | initial version with `lemon-engine#2.2.3`.
