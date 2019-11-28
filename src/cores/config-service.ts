/**
 * file: `cores/config-service.ts`
 * - Asynchronized creation of config.
 *
 * **Use Case**
 * 1. clone the predefined environment variables.
 * 2. decrypt the encrypted string with `kms.service`, and save it.
 *
 * **NOTE**
 * - Only via ConfigService, app could use the decrypted string.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-06-04 initial version.
 * @date        2019-11-06 added `getStage()`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U } from '../engine/';
const NS = $U.NS('CFGS', 'yellow'); // NAMESPACE TO BE PRINTED.

import { STAGE } from './core-types';
import { AWSKMSService } from './aws-kms-service';
import { loadJsonSync } from '../tools/shared';

/**
 * filter function()
 */
export interface Filter<T> {
    (name: string, val: any, thiz?: any, attr?: string | number): T;
}

/**
 * marshaler: convert object to dotted list.
 *
 * @param obj   json object
 * @param name  current name
 * @param list  result list
 * @param filter filter function.
 */
export const marshal = <T>(
    obj: any,
    filter: Filter<T>,
    name: string = '',
    list: T[] = [],
    thiz?: any,
    attr?: string | number,
): T[] => {
    if (!filter) throw new Error('filter is required!');
    thiz = thiz === undefined ? obj : thiz;
    if (obj && typeof obj == 'object') {
        if (!Array.isArray(obj)) {
            return Object.keys(obj).reduce((L: T[], key: string) => {
                const val = obj[key];
                return marshal(val, filter, name ? `${name}.${key}` : `${key}`, L, obj, key);
            }, list);
        } else {
            return obj.reduce((L: T[], val: any, index: number) => {
                return marshal(val, filter, name ? `${name}.${index}` : `${index}`, L, obj, index);
            }, list);
        }
    } else {
        const line = filter(name, obj, thiz, attr);
        if (line !== undefined && line !== null) list.push(line);
    }
    return list;
};

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

/**
 * class: `MyConfigService`
 * - sample for asynchronized factory.
 */
export class MyConfigService implements ConfigService {
    /**
     * internal cached config settings.
     */
    protected envConfig: { [key: string]: string } = {};
    protected kms: AWSKMSService;
    protected $env: any;

    /**
     * DO NOT craete directly. (use async `ConfigService.factory()`)
     */
    protected constructor(kms?: AWSKMSService) {
        _log(NS, `ConfigService()...`);
        this.kms = kms;
    }

    /**
     * Asynchronized factory function.
     */
    public static async factory(base: object = null): Promise<ConfigService> {
        // _log(NS, 'factory()...');
        const inst = new MyConfigService(new AWSKMSService());
        return inst.load(base);
    }

    /**
     * hello
     */
    public hello() {
        return {
            hello: 'config-service',
        };
    }

    /**
     * read all configuration setting
     */
    public all(): { [key: string]: string } {
        return { ...this.envConfig };
    }

    /**
     * read config value (or all config settings)
     * 1. read via internal cache.
     * 2. if missed, then read via process.env.
     *
     * @param key       config-name.
     */
    public get(key: string): string {
        const ret = this.envConfig[key];
        const $env = this.$env;
        const val = ret === undefined ? $env[key] : ret;
        return val === undefined ? undefined : `${val}`;
    }

    //! loading service's package.json
    private _package: any = null;
    private loadPackage(): any {
        if (!this._package) {
            try {
                this._package = (loadJsonSync && loadJsonSync('package.json')) || {};
            } catch (e) {
                _err(NS, `! err to load package.json =`, e);
            }
        }
        return this._package || {};
    }

    public getService(): string {
        const $pack = this.loadPackage();
        return `${$pack.name || ''}`;
    }

    public getVersion(): string {
        const $pack = this.loadPackage();
        return `${$pack.version || ''}`;
    }

    /**
     * read current stage condition
     */
    public getStage(): STAGE {
        const stage = `${this.get('STAGE') || this.get('stage') || ''}`.toLowerCase();
        if (stage == 'develop' || stage == 'development' || stage == 'dev') return 'dev';
        if (stage == 'production' || stage == 'product' || stage == 'prod') return 'prod';
        return 'local';
    }

    /**
     * load & decrypt the environ.
     * - only if string starts with '*'
     */
    protected async load(base: object = null): Promise<ConfigService> {
        // const _log = console.log;
        _log(NS, `load()...`);
        const $env: any = base || process.env || {};
        this.$env = $env; // save as default environ.

        //! check if encrypted like `*XX+XyXxX==` (must start with '*')
        const isEncrypted = (val: any) => {
            return val && typeof val == 'string' && /^\*[A-Za-z0-9_\/=\+]+$/.test(val);
        };

        //! convert to { key, val }
        const filter: Filter<{ key: string; val: any }> = (key, val) => {
            return { key, val };
        };
        const list = marshal($env, filter);

        //! decrypts if is encrypted.
        const list2 = await Promise.all(
            list.map(async ({ key, val }) => {
                if (isEncrypted(val) && this.kms) {
                    const encrypted = `${val}`.substring(1);
                    const val2 = await this.kms.decrypt(encrypted).catch((e: Error) => {
                        _log(NS, `ERR@${key} =`, e);
                        return `ERROR - ${e.message || $U.json(e)}`;
                    });
                    _log(NS, `> config[${key}] :=`, val2.substring(0, 10), val2.length > 10 ? '...' : '');
                    return { key, val: val2 };
                }
                return { key, val };
            }),
        );
        // _log(NS, `! list2 =`, list2);

        //! convert envConfig value.
        this.envConfig = list2.reduce((M: any, item) => {
            const { key, val } = item;
            if (key) M[key] = `${val}`; // convert all to string.
            return M;
        }, {});
        // _log(NS, '>> envConfig=', this.envConfig);
        // _log(NS, '>> envOrigin=', this.$env);
        _inf(NS, '>> loaded... config.len=', list2.length);

        //! returns this.
        return this;
    }
}
