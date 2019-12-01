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
import { $engine, EngineModule, LemonEngine } from '../../engine/';
import { ConfigModule } from '../config';

export * from './lambda-handler';

export { CronNextHandler, CronParam } from './lambda-cron-handler';

// //! import default with named.
import { LambdaHandler } from './lambda-handler';
import { LambdaWEBHandler } from './lambda-web-handler';
import { LambdaSNSHandler } from './lambda-sns-handler';
import { LambdaSQSHandler } from './lambda-sqs-handler';
import { LambdaWSSHandler } from './lambda-wss-handler';
import { LambdaCronHandler } from './lambda-cron-handler';
import { LambdaCognitoHandler } from './lambda-cognito-handler';
import { LambdaDynamoStreamHandler } from './lambda-dynamo-stream-handler';

// //! export default.
// export default { lambda, web, wss, sns, sqs, cron, cognito, dynamos };

export class LambdaModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        this.engine.register(this);
    }

    //! create default services
    public lambda: LambdaHandler = new LambdaHandler();
    public web: LambdaWEBHandler = new LambdaWEBHandler(this.lambda);
    public sns: LambdaSNSHandler = new LambdaSNSHandler(this.lambda);
    public sqs: LambdaSQSHandler = new LambdaSQSHandler(this.lambda);
    public wss: LambdaWSSHandler = new LambdaWSSHandler(this.lambda);
    public cron: LambdaCronHandler = new LambdaCronHandler(this.lambda);
    public cognito: LambdaCognitoHandler = new LambdaCognitoHandler(this.lambda);
    public dynamos: LambdaDynamoStreamHandler = new LambdaDynamoStreamHandler(this.lambda);

    public getModuleName = () => 'lambda';
    public async initModule(level?: number): Promise<number> {
        const $conf = this.engine.module<ConfigModule>('config');
        if (level === undefined) {
            return $conf ? (await $conf.initModule()) + 1 : 1;
        } else {
            this.lambda.config = $conf.config;
        }
    }
}

//! create default instance, then export as default.
export default new LambdaModule();
