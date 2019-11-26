[![travis](https://travis-ci.org/lemoncloud-io/lemon-core.svg?branch=master)](https://travis-ci.org/lemoncloud-io/lemon-core)
[![codecov](https://codecov.io/gh/lemoncloud-io/lemon-core/branch/master/graph/badge.svg)](https://codecov.io/gh/lemoncloud-io/lemon-core)
[![npm version](https://badge.fury.io/js/lemon-core.svg)](https://badge.fury.io/js/lemon-core)
[![GitHub version](https://badge.fury.io/gh/lemoncloud-io%2Flemon-core.svg)](https://badge.fury.io/gh/lemoncloud-io%2Flemon-core)


# lemon-core

Lemon Core Bootloader for Serverless Micro-Service

- Support `multiple` event sources with single lambda function as below figure.

    ![](assets/2019-11-26-23-43-47.png)

- Fully support `typescript` types (80%).

## Usage

1. install `lemon-core` module (>= 2.0.0).

```sh
$ npm install lemon-core --save
```

TODO - TBD in detail.


## Contribution

Plz, request PR. 

See [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md)


## LICENSE

[MIT](LICENSE) - (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.



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

