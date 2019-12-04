/**
 * `cores/index.tx`
 * - core services for serverless micro-service.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
export * from './core-types';
export * from './core-services';
export * from './aws/';
export * from './config/';
export * from './lambda/';
export * from './protocol/';

export { APIHeaders, APIService, APIServiceClient, APIHttpMethod } from './api-service';
export { DynamoOption, DynamoService } from './dynamo-service';
export { DynamoQueryService, DynamoSimpleQueriable } from './dynamo-query-service';
export { Elastic6Option, Elastic6Service } from './elastic6-service';
export { Elastic6QueryService } from './elastic6-query-service';
export { StorageModel, StorageService, DynamoStorageService, DummyStorageService } from './storage-service';

//! import default with named.
import aws from './aws/';
import config from './config/';
import lambda from './lambda/';
import protocol from './protocol/';

//! export default.
export default { aws, config, lambda, protocol };
