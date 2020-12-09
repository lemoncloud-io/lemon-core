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

//! export services
export * from './api-service';
export * from './dynamo-service';
export * from './dynamo-query-service';
export * from './dynamo-scan-service';
export * from './redis-storage-service';
export * from './elastic6-service';
export * from './elastic6-query-service';
export * from './storage-service';
export * from './proxy-storage-service';
export * from './cache-service';
export * from './model-manager';

//! import default with named.
import aws from './aws/';
import config from './config/';
import lambda from './lambda/';
import protocol from './protocol/';

//! export default.
export default { aws, config, lambda, protocol };
