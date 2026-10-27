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
 * @date        2026-10-28 v5 B3: `Filter`/`marshal` come from `common/test-helper` (re-exported).
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U } from '../../engine/';
import { STAGE, CoreKmsService, CoreConfigService } from './../core-services';
import { loadJsonSync } from '../../tools/';
//* v5 B3: `Filter`/`marshal` were verbatim copies of the test-helper ones; one definition, imported here.
import { Filter, marshal } from '../../common/test-helper';
const NS = $U.NS('CFGS', 'red'); // NAMESPACE TO BE PRINTED.

export type ConfigService = CoreConfigService;

//* v5 B3: re-exported so the deep path `dist/cores/config/config-service` keeps the names `Filter`/`marshal`.
export type { Filter };
export { marshal };

/**
 * class: `MyConfigService`
 * - sample for asynchronized factory.
 */
export class MyConfigService implements ConfigService {
    /**
     * internal cached config settings.
     */
    protected envConfig: { [key: string]: string } = {};
    protected $env: any;
    protected base: any;

    //* external dependency
    public kms: CoreKmsService;

    /**
     * DO NOT craete directly. (use async `ConfigService.factory()`)
     */
    public constructor(base?: object, kms?: CoreKmsService) {
        _log(NS, `ConfigService()...`);
        this.base = base;
        this.kms = kms;
    }

    /**
     * hello
     */
    public hello = () => `config-service`;

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
        const $env = this.$env || {};
        const val = ret === undefined ? $env[key] : ret;
        return val === undefined ? undefined : `${val}`;
    }

    //* loading service's package.json
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
        return `${($pack && $pack.name) || ''}`;
    }

    public getVersion(): string {
        const $pack = this.loadPackage();
        return `${($pack && $pack.version) || ''}`;
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
    public async init(): Promise<ConfigService> {
        // const _log = console.log;
        // _log(NS, `init()...`);
        const base = this.base;
        const $env: any = base || process.env || {};
        this.$env = $env; // save as default environ.

        //* check if encrypted like `*XX+XyXxX==` (must start with '*')
        const isEncrypted = (val: any) => {
            return val && typeof val == 'string' && /^\*[A-Za-z0-9_\/=\+]+$/.test(val);
        };

        //* convert to { key, val }
        const filter: Filter<{ key: string; val: any }> = (key, val) => {
            return { key, val };
        };
        const list = marshal($env, filter);

        //* decrypts if is encrypted.
        const list2 = await Promise.all(
            list.map(async ({ key, val }) => {
                if (isEncrypted(val) && this.kms) {
                    const encrypted = `${val}`.substring(1);
                    const val2 = await this.kms.decrypt(encrypted).catch((e: Error) => {
                        _log(NS, `ERR@${key} =`, e);
                        return `ERROR - ${e.message || $U.json(e)}`;
                    });
                    _log(NS, `> config[${key}] :=`, val2.substring(0, 12), val2.length > 12 ? '...' : '');
                    return { key, val: val2 };
                }
                return { key, val };
            }),
        );
        // _log(NS, `! list2 =`, list2);

        //* convert envConfig value.
        this.envConfig = list2.reduce((M: any, item) => {
            const { key, val } = item;
            if (key) M[key] = `${val}`; // convert all to string.
            return M;
        }, {});
        // _log(NS, '>> envConfig=', this.envConfig);
        // _log(NS, '>> envOrigin=', this.$env);
        _inf(NS, '>> inited... config.len=', list2.length);

        //* returns this.
        return this;
    }
}
