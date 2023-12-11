/**
 * `cores/index.tx`
 * - core services for serverless micro-service.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-11-16 added azure, functions service
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//! export cores.
export * from 'lemon-model';
export * from './core-services';

//! export by groups.
export * from './api/';
export * from './aws/';
export * from './azure/';
export * from './cache/';
export * from './config/';
export * from './cosmos/';
export * from './dynamo/';
export * from './elastic/';
export * from './functions/';
export * from './lambda/';
export * from './protocol/';
export * from './storage/';

//! import `default` with named.
import aws from './aws/';
import azure from './azure/';

import lambda from './lambda/';
import functions from './functions/';

import config from './config/';
import protocol from './protocol/';

//! export default.
export default { aws, azure, lambda, functions, config, protocol };
