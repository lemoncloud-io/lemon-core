/**
 * `cores/config.index.tx`
 * - config services for serverless micro-service.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $engine, EngineModule, LemonEngine } from '../../engine/';
import { MyProtocolService } from './protocol-service';
import { ConfigModule } from '../config';

export { MyProtocolService } from './protocol-service';

export class ProtocolModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        this.engine.register(this);
    }

    //! create default services
    public service: MyProtocolService = new MyProtocolService();

    public getModuleName = () => 'protocol';
    public async initModule(level?: number): Promise<number> {
        const $conf = this.engine.module<ConfigModule>('config');
        if (level === undefined) {
            return $conf ? (await $conf.initModule()) + 1 : 1;
        } else {
            // this.lambda.config = $conf.config;
        }
    }
}

//! create default instance, then export as default.
export default new ProtocolModule();