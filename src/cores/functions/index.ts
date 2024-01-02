/**
 * `cores/lambda/index.tx`
 * - lambda services for serverless micro-service.
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-10-30 initial version
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
import { $engine, EngineModule, LemonEngine } from '../../engine/';
import { ConfigModule } from '../config';

//! export default
export * from './functions-handler';

//! export core classes
export { FunctionWEBHandler } from './functions-web-handler';

//! export by group

import * as _$web from './functions-web-handler';

export { _$web };

//! import default with named.
import { FunctionHandler } from './functions-handler';
import { FunctionWEBHandler } from './functions-web-handler';

/**
 * class: `LambdaModule`
 * - default module
 */
export class FunctionsModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        if (this.engine) this.engine.register(this);

        //! make default lambda-handler to initialize engine properly.
        const thiz = this;
        const functions = new (class extends FunctionHandler {
            public async handle(ctx: any, req: any): Promise<any> {
                return thiz.engine.initialize().then(() => super.handle(ctx, req));
            }
        })();
        this.functions = functions;
        this.web = new FunctionWEBHandler(functions, true);
    }

    //! default services to export.
    public readonly functions: FunctionHandler;
    public readonly web: FunctionWEBHandler;

    //! module setting.
    public getModuleName = () => 'functions';
    public async initModule(level?: number): Promise<number> {
        // it should wait until config-module is ready.
        const $conf = this.engine.module<ConfigModule>('config');
        if (level === undefined) {
            return $conf ? (await $conf.initModule()) + 1 : 1;
        }
        //console.info(`! LambdaModule.init()..`);
        if ($conf) this.functions.config = $conf.config;
    }
}

//! create default instance, then export as default.
export default new FunctionsModule();
