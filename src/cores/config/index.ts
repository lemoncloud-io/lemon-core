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
import { MyConfigService } from './config-service';
import { AWSModule } from '../aws';

export class ConfigModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        if (this.engine) this.engine.register(this);
    }

    //! create default services
    public config: MyConfigService = new MyConfigService();

    public getModuleName = () => 'config';
    public async initModule(level?: number): Promise<number> {
        const $aws = this.engine.module<AWSModule>('aws');
        if (level === undefined) {
            return $aws ? (await $aws.initModule()) + 1 : 1;
        }
        // console.info(`! ConfigModule.init()..`);
        // attach external service.
        if ($aws) this.config.kms = $aws.kms;
        await this.config.init();
    }
}

//! create default instance, then export as default.
export default new ConfigModule();
