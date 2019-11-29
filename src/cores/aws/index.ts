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
import { $engine, _log, _inf, _err, $U } from '../../engine/';

export * from './../core-types';
export * from './../lambda/';

//! get common region.
export const region = async () => {
    return 'ap-northeast-2';
};

//! get common config via environ.
export const environ = async (target: string, defEnvName: string, defEnvValue: string) => {
    const isUpperStr = target && /^[A-Z][A-Z0-9_]+$/.test(target);
    defEnvName = isUpperStr ? target : defEnvName;
    const val = defEnvName ? ($engine.environ(defEnvName, defEnvValue) as string) : defEnvValue;
    target = isUpperStr ? '' : target;
    return `${target || val}`;
};

export { AWSKMSService } from './aws-kms-service';
export { AWSSQSService } from './aws-sqs-service';
