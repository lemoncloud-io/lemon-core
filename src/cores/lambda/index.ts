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
import { LambdaHandler, Context } from './lambda-handler';
import { LambdaWEBHandler } from './lambda-web-handler';
import { LambdaSNSHandler } from './lambda-sns-handler';
import { LambdaSQSHandler } from './lambda-sqs-handler';
import { LambdaWSSHandler } from './lambda-wss-handler';
import { LambdaCronHandler } from './lambda-cron-handler';
import { LambdaCognitoHandler } from './lambda-cognito-handler';
import { LambdaDynamoStreamHandler } from './lambda-dynamo-stream-handler';

/**
 * class: `LambdaHandlerDefault`
 * - default lambda-handler with `engine.initialize()`.
 */
class LambdaHandlerDefault extends LambdaHandler {
    private engine: LemonEngine;
    public constructor(engine: LemonEngine) {
        super();
        this.engine = engine;
    }
    public async handle(event: any, context: Context): Promise<any> {
        return this.engine.initialize().then(() => super.handle(event, context));
    }
}

/**
 * class: `LambdaModule`
 * - default module
 */
export class LambdaModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        this.engine.register(this);

        //! make default lambda-handler to initialize engine properly.
        const thiz = this;
        const lambda = new (class extends LambdaHandler {
            public async handle(event: any, context: Context): Promise<any> {
                return thiz.engine.initialize().then(() => super.handle(event, context));
            }
        })();
        this.lambda = lambda;
        this.web = new LambdaWEBHandler(lambda, true);
        this.sns = new LambdaSNSHandler(lambda, true);
        this.sqs = new LambdaSQSHandler(lambda, true);
        this.wss = new LambdaWSSHandler(lambda, true);
        this.cron = new LambdaCronHandler(lambda, true);
        this.cognito = new LambdaCognitoHandler(lambda, true);
        this.dynamos = new LambdaDynamoStreamHandler(lambda, true);
    }

    //! default services to export.
    public readonly lambda: LambdaHandler;
    public readonly web: LambdaWEBHandler;
    public readonly sns: LambdaSNSHandler;
    public readonly sqs: LambdaSQSHandler;
    public readonly wss: LambdaWSSHandler;
    public readonly cron: LambdaCronHandler;
    public readonly cognito: LambdaCognitoHandler;
    public readonly dynamos: LambdaDynamoStreamHandler;

    //! module setting.
    public getModuleName = () => 'lambda';
    public async initModule(level?: number): Promise<number> {
        const $conf = this.engine.module<ConfigModule>('config');
        if (level === undefined) {
            return $conf ? (await $conf.initModule()) + 1 : 1;
        }
        //console.info(`! LambdaModule.init()..`);
        if ($conf) this.lambda.config = $conf.config;
    }
}

//! create default instance, then export as default.
export default new LambdaModule();
