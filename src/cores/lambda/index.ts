/**
 * `cores/lambda/index.tx`
 * - lambda services for serverless micro-service.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
export * from './lambda-handler';

export { LambdaCognitoHandler } from './lambda-cognito-handler';
export { LambdaCronHandler, CronNextHandler } from './lambda-cron-handler';
export { LambdaDynamoStreamHandler, DynamoStreamNextHandler } from './lambda-dynamo-stream-handler';
export { LambdaSNSHandler } from './lambda-sns-handler';
export { LambdaSQSHandler } from './lambda-sqs-handler';
export { LambdaWEBHandler } from './lambda-web-handler';
export { LambdaWSSHandler } from './lambda-wss-handler';

//! import default with named.
import lambda from './lambda-handler';
import web from './lambda-web-handler';
import wss from './lambda-wss-handler';
import sns from './lambda-sns-handler';
import sqs from './lambda-sqs-handler';
import cron from './lambda-cron-handler';
import cognito from './lambda-cognito-handler';
import dynamos from './lambda-dynamo-stream-handler';

//! export default.
export default { lambda, web, wss, sns, sqs, cron, cognito, dynamos };
