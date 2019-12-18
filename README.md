[![travis](https://travis-ci.org/lemoncloud-io/lemon-core.svg?branch=master)](https://travis-ci.org/lemoncloud-io/lemon-core)
[![codecov](https://codecov.io/gh/lemoncloud-io/lemon-core/branch/master/graph/badge.svg)](https://codecov.io/gh/lemoncloud-io/lemon-core)
[![npm version](https://badge.fury.io/js/lemon-core.svg)](https://badge.fury.io/js/lemon-core)
[![GitHub version](https://badge.fury.io/gh/lemoncloud-io%2Flemon-core.svg)](https://badge.fury.io/gh/lemoncloud-io%2Flemon-core)


# lemon-core

Lemon Core Bootloader for Serverless Micro-Service

- Support `multiple` event sources with single lambda function as below figure.
- Fully support `typescript` types (80%).
- Support Data Synchronization to `Elasticsearch` from `DynomoDB` via `DynamoStream`.

    ![](assets/2019-11-26-23-43-47.png)


## Architecture

Basic MicroService Architecutre with `API` + `SNS` + `SQS`.

![](assets/lemon-core-ms-arch.png)

- `NextHandler`: basic controller method to handle user service
- `NextDecoder`: mapper from `httpMethod + id + cmd` to `NextHandler`
- `NextContext`: initial requester's context with `identity`.


## Usage

1. install `lemon-core` module (>= 2.0.1).

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
# TODO TASK #

- [ ] use environ as default region like `ap-northeast-2`.
- [ ] draw protocol's sequence diagram w/ `callback` mechanism.
- [ ] on protocol, use local account name as accountId for NextContext.


----------------
# VERSION INFO #

| Version   | Description
|--         |--
| 2.0.9     | improve `Elastic6Service` + `Elastic6QueryService`.
| 2.0.8     | improve `APIService` w/ mocks data.
| 2.0.7     | improve `StorageService` along w/ dummy-storage-service.
| 2.0.6     | support `CoreWEBController`, and `lambda.cores.web.addController(...)`
| 2.0.5     | support `APIService`, and fix `engine.initialize()`
| 2.0.4     | improve test-helper w/ `environ`, `credentials`
| 2.0.3     | support `StorageService` along with `DynamoStorageService`
| 2.0.2     | refactoring, and support `ProtocolService`
| 2.0.1     | fix package dependencies.
| 2.0.0     | remove `lemon-engine`, and support `typescript` fully.
| 1.2.15    | improve `doReportError` with error message
| 1.2.12    | support `doReportMetric()` for saving metric data.

