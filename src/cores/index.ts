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
//! export cores.
export * from 'lemon-model';
export * from './core-services';

//! export by groups.
export * from './aws/';
export * from './config/';
export * from './lambda/';
export * from './protocol/';
export * from './storage/';
export * from './dynamo/';
export * from './elastic/';
export * from './cache/';
export * from './api/';
export * from './az_function/'

//! import `default` with named.
import aws from './aws/';
import config from './config/';
import lambda from './lambda/';
import protocol from './protocol/';
import az_function from './az_function';

//! export default.
export default { aws, config, lambda, protocol, az_function };
