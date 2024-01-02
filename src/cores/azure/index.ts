/**
 * `cores/aws/index.tx`
 * - aws services for serverless micro-service.
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $engine, EngineModule, LemonEngine } from '../../engine';
import { BlobService } from './azure-blob-service';
import { KeyVaultService } from './azure-keyvault-service';

export { BlobService } from './azure-blob-service';
export { KeyVaultService } from './azure-keyvault-service';

export class AZUREModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        if (this.engine) this.engine.register(this);
    }

    //! create default kms-service with `env.ENV_KMS_KEY_ID`.
    public kv: KeyVaultService = new KeyVaultService();
    public blob: BlobService = new BlobService();

    public getModuleName = () => 'azure';
    public async initModule(level?: number): Promise<number> {
        if (level === undefined) return 1;
    }
}

// //! create default instance, then export as default.
export default new AZUREModule($engine);
