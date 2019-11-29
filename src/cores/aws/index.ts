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
import { $engine, EngineModule, LemonEngine } from '../../engine/';

//! get common region.
export * from './../core-types';

export { AWSKMSService } from './aws-kms-service';
export { AWSSQSService } from './aws-sqs-service';

export class AWSModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine: LemonEngine) {
        this.engine = engine; // use input engine or global.
        this.engine.register(this);
    }
    public region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;

    /**
     * use `target` as value or environment value.
     * environ('abc') => string 'abc'
     * environ('ABC') => use `env.ABC`
     */
    public environ = (target: string, defEnvName: string, defEnvValue: string) => {
        const isUpperStr = target && /^[A-Z][A-Z0-9_]+$/.test(target);
        defEnvName = isUpperStr ? target : defEnvName;
        const val = defEnvName ? ($engine.environ(defEnvName, defEnvValue) as string) : defEnvValue;
        target = isUpperStr ? '' : target;
        return `${target || val}`;
    };

    public getModuleName = () => 'aws';
    public async initModule(level?: number): Promise<number> {
        if (level === undefined) return 1;
        //TODO - initialize module like to create instance.
    }
}

//! create default instance, then export as default.
const $aws = new AWSModule($engine);
export default $aws;
