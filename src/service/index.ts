/**
 * `service/index.ts`
 * - export all services.
 * - see `/src/index.ts#service()`
 *
 * ```ts
 * import { $SVC } from 'lemon-core';
 * $SVC.S3.putObject(...);
 * ```
 *
 * @author  Steve Jung <steve@lemoncloud.io>
 * @date    2019-08-15 initial export all.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $engine } from '../core/engine';

//! export all services.
export * from './sns-service';
export * from './kms-service';
export * from './s3-service';

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
