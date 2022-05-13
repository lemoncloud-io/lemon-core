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
//! export modules.
export * from './core-types';
export * from './core-services';
export * from './aws/';
export * from './config/';
export * from './lambda/';

//! export sub folders
export * from './protocol/';
export * from './dynamo/';
export * from './elastic/';
export * from './storage/';

//! export services
export * from './api-service';
export * from './cache-service';

//! import default with named.
import aws from './aws/';
import config from './config/';
import lambda from './lambda/';
import protocol from './protocol/';

//! export default.
export default { aws, config, lambda, protocol };
