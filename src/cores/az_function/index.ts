/**
 * `cores/az_function/index.tx`
 * - az_function services for serverless micro-service.
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-13 initial version via backbone
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $engine, EngineModule, LemonEngine } from '../../engine/';
import { ConfigModule } from '../config';

//! export default
export * from './function-handler';

//! export core classes
export { AZCoreWEBController, FunctionWEBHandler } from './function-web-handler';


//! export by group

import * as $web from './function-web-handler';
export { $web as $AZweb };

//! import default with named.
import { FunctionHandler, AZContext } from './function-handler';
import { FunctionWEBHandler } from './function-web-handler';

/**
 * class: `FunctionModule`
 * - default module
 */
export class FunctionModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        if (this.engine) this.engine.register(this);

        //! make default az_function-handler to initialize engine properly.
        const thiz = this;
        const az_function = new (class extends FunctionHandler {
            public async handle(event: any, context: AZContext): Promise<any> {
                return thiz.engine.initialize().then(() => super.handle(event, context));
            }
        })();
        this.az_function = az_function;
        this.web = new FunctionWEBHandler(az_function, true);
    }

    //! default services to export.
    public readonly az_function: FunctionHandler;
    public readonly web: FunctionWEBHandler;

    //! module setting.
    public getModuleName = () => 'az_function';
    public async initModule(level?: number): Promise<number> {
        // it should wait until config-module is ready.
        const $conf = this.engine.module<ConfigModule>('config');
        if (level === undefined) {
            return $conf ? (await $conf.initModule()) + 1 : 1;
        }
        //console.info(`! FunctionModule.init()..`);
        if ($conf) this.az_function.config = $conf.config;
    }
}

//! create default instance, then export as default.
export default new FunctionModule();
