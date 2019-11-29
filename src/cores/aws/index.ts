/**
 * `cores/aws/index.tx`
 * - aws services for serverless micro-service.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
export * from './../core-types';
export * from './../lambda/';

export { AWSKMSService } from './aws-kms-service';
export { AWSSQSService } from './aws-sqs-service';
