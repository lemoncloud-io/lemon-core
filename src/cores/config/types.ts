/**
 * `core/config/types.ts`
 * - common types for config module
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-28 initial version
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { STAGE } from './../core-services';

/**
 * class: `ConfigService`
 * - general interface to provide config
 */
export interface ConfigService {
    hello(): any;
    get(key: string): string;

    /**
     * get the current service name of `package.json#name`
     */
    getService(): string;

    /**
     * get the current service name of `package.son#version`
     */
    getVersion(): string;

    /**
     * get the current stage stage via `env.STAGE`
     */
    getStage(): STAGE;
}
