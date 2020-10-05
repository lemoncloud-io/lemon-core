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
import { AWSKMSService } from './aws-kms-service';
import { AWSSNSService } from './aws-sns-service';
import { AWSSQSService } from './aws-sqs-service';
import { AWSS3Service } from './aws-s3-service';

export { AWSKMSService } from './aws-kms-service';
export { AWSSNSService } from './aws-sns-service';
export { AWSSQSService } from './aws-sqs-service';
export { AWSS3Service } from './aws-s3-service';

export class AWSModule implements EngineModule {
    private engine: LemonEngine;
    public constructor(engine?: LemonEngine) {
        this.engine = engine || $engine; // use input engine or global.
        if (this.engine) this.engine.register(this);
    }

    //! create default kms-service with `env.ENV_KMS_KEY_ID`.
    public kms: AWSKMSService = new AWSKMSService();
    public sns: AWSSNSService = new AWSSNSService();
    public sqs: AWSSQSService = new AWSSQSService();
    public s3: AWSS3Service = new AWSS3Service();

    public getModuleName = () => 'aws';
    public async initModule(level?: number): Promise<number> {
        if (level === undefined) return 1;
    }
}

// //! create default instance, then export as default.
export default new AWSModule($engine);
