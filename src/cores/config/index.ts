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
import $engine from '../../engine';
import { CoreConfigService } from './../core-services';
import { EngineModule, LemonEngine } from '../../engine';

export type ConfigService = CoreConfigService;
export { MyConfigService } from './config-service';

export class ConfigModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        this.engine.register(this);
    }
    public getModuleName = () => 'config';
    public async initModule(level?: number): Promise<number> {
        throw new Error('Method not implemented.');
    }
}

//! create default instance, then export as default.
const $config = new ConfigModule();
export default $config;
