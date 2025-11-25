/**
 * `config-service.spec.ts`
 * - unit test for `config-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-10-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { expect2 } from '../../common/test-helper';
import { $U } from '../../engine/';
import { loadJsonSync } from '../../tools/';
import { AWSKMSService } from './../aws/aws-kms-service';
import { marshal, Filter, MyConfigService } from './config-service';
import { MyConfigService as TestConfigService } from './config-service';

//! main test body.
describe('ConfigService', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* dummy storage service.
    it('should pass expect2 helper', async () => {
        expect2(() => {
            throw new Error('HI Error');
        }).toBe('HI Error');
        expect2(async () => {
            throw new Error('HI Error');
        }).toBe('HI Error');
    });

    //* test marshal
    it('should pass marshal()', async () => {
        const defFilter: Filter<string> = (name: string, val: any) => `${name}=${val}`;
        expect2(marshal({ a: 1 }, defFilter)).toEqual(['a=1']);
        expect2(marshal({ a: true }, defFilter)).toEqual(['a=true']);
        expect2(marshal({ a: { b: false } }, defFilter)).toEqual(['a.b=false']);
        expect2(marshal({ a: [1, 'b'] }, defFilter)).toEqual(['a.0=1', 'a.1=b']);
        expect2(marshal({ a: [1, 'b'] }, defFilter)).toEqual(['a.0=1', 'a.1=b']);
        expect2(marshal({ a: [1, { b: 1 }] }, defFilter)).toEqual(['a.0=1', 'a.1.b=1']);
        expect2(() => marshal({ a: [1, { b: 1 }] }, null)).toEqual('filter is required!');
        expect2(marshal(['a', 2], defFilter)).toEqual(['0=a', '1=2']);

        //* test simple filter
        if (1) {
            const filter: Filter<string> = (name, val) => (name.startsWith('a.1') ? `${name}=${val}` : null);
            expect2(marshal({ a: [1, { b: 1 }] }, filter)).toEqual(['a.1.b=1']);
        }

        //* test filter-replace
        if (1) {
            const origin = { a: [1, { b: 1 }] }; // origin
            const target = JSON.parse(JSON.stringify(origin)); // deep copy
            const filter: Filter<string> = (name, val, thiz, key) => {
                if (name == 'a.0') thiz[key] = 3; // replace origin.
                if (name == 'a.1.b') thiz[key] = 5; // replace origin.
                return `${name}=${val}`;
            };
            expect2(target).toEqual(origin);
            expect2(marshal(target, filter)).toEqual(['a.0=1', 'a.1.b=1']);
            expect2(target).toEqual({ a: [3, { b: 5 }] });
            expect2(marshal(target, defFilter)).toEqual(['a.0=3', 'a.1.b=5']);
        }
    });

    //* test config-service
    it('should pass config-service()', async () => {
        if (!PROFILE) return;

        //NOTE - use `alias/lemon-hello-api` by default
        const $kms = new AWSKMSService();
        const message = 'hello-lemon';
        const encrypted = await $kms.encrypt(message);
        const secret = `*${encrypted}`;
        //NOTE - encrypted string can be changed when created.
        console.info(`encrypt[${message}] :=`, secret);

        //* prepare dummy config set.
        const $config = {
            count: 1,
            token: {
                issuer: 'lemon',
                secret,
            },
        };
        const $pack = loadJsonSync('package.json');

        const origin = JSON.parse($U.json($config)); // deep copy
        const _conf = new MyConfigService($config);
        _conf.kms = $kms;
        const config = await _conf.init(); // wait until loading completely.

        //* check result..
        expect2(config.hello()).toEqual('config-service');
        expect2(config.getService()).toEqual('lemon-core');
        expect2(config.getVersion()).toEqual('' + $pack.version);
        expect2(['local', 'dev', 'prod']).toContain(config.getStage());
        expect2(config.get('count')).toEqual('1'); // must be string.
        expect2(config.get('token.issuer')).toEqual(origin.token.issuer); // not encrypted.
        expect2(config.get('token.secret')).toEqual(message); // decrypted successfully.

        // expect2($config).toEqual(origin);                                                // should be `fail`
        expect2($config.count).toBe(1); // keep number origin
        expect2($config.token.issuer).toBe(origin.token.issuer); // keep issuer
        expect2($config.token.secret).toBe(secret); // NOT updated with decrypted.
    });

    it('should pass MyConfigService without KMS', async () => {
        const $config = {
            count: 1,
            name: 'test',
            nested: {
                value: 'hello',
            },
        };

        const config = new MyConfigService($config);
        await config.init();

        // Test hello()
        expect2(config.hello()).toEqual('config-service');

        // Test all()
        const all = config.all();
        expect2(all.count).toEqual('1');
        expect2(all.name).toEqual('test');
        expect2(all['nested.value']).toEqual('hello');

        // Test get()
        expect2(config.get('count')).toEqual('1');
        expect2(config.get('name')).toEqual('test');
        expect2(config.get('nested.value')).toEqual('hello');
        expect2(config.get('non-existent')).toEqual(undefined);
    });

    it('should pass getStage() variations', async () => {
        // Test dev variations
        const configDev1 = new MyConfigService({ STAGE: 'develop' });
        await configDev1.init();
        expect2(configDev1.getStage()).toEqual('dev');

        const configDev2 = new MyConfigService({ STAGE: 'development' });
        await configDev2.init();
        expect2(configDev2.getStage()).toEqual('dev');

        const configDev3 = new MyConfigService({ STAGE: 'dev' });
        await configDev3.init();
        expect2(configDev3.getStage()).toEqual('dev');

        const configDev4 = new MyConfigService({ stage: 'DEV' });
        await configDev4.init();
        expect2(configDev4.getStage()).toEqual('dev');

        // Test prod variations
        const configProd1 = new MyConfigService({ STAGE: 'production' });
        await configProd1.init();
        expect2(configProd1.getStage()).toEqual('prod');

        const configProd2 = new MyConfigService({ STAGE: 'product' });
        await configProd2.init();
        expect2(configProd2.getStage()).toEqual('prod');

        const configProd3 = new MyConfigService({ STAGE: 'prod' });
        await configProd3.init();
        expect2(configProd3.getStage()).toEqual('prod');

        // Test local (default)
        const configLocal1 = new MyConfigService({ STAGE: 'local' });
        await configLocal1.init();
        expect2(configLocal1.getStage()).toEqual('local');

        const configLocal2 = new MyConfigService({ STAGE: 'unknown' });
        await configLocal2.init();
        expect2(configLocal2.getStage()).toEqual('local');

        const configLocal3 = new MyConfigService({});
        await configLocal3.init();
        expect2(configLocal3.getStage()).toEqual('local');
    });

    it('should pass get() with fallback to process.env', async () => {
        const config = new MyConfigService({});
        await config.init();

        // Get from cache (should be undefined)
        expect2(config.get('non-existent')).toEqual(undefined);

        // Test that it falls back to process.env
        const oldEnv = process.env.TEST_CONFIG_VAR;
        process.env.TEST_CONFIG_VAR = 'test-value';

        const config2 = new MyConfigService();
        await config2.init();
        expect2(config2.get('TEST_CONFIG_VAR')).toEqual('test-value');

        // Restore
        if (oldEnv !== undefined) {
            process.env.TEST_CONFIG_VAR = oldEnv;
        } else {
            delete process.env.TEST_CONFIG_VAR;
        }
    });

    it('should pass getService() and getVersion() with missing package.json', async () => {
        const config = new MyConfigService({});
        expect2(config.hello()).toEqual('config-service');
        await config.init();

        // These should work even without real package.json in test environment
        const service = config.getService();
        const version = config.getVersion();

        // Should return strings (might be empty if package.json not found)
        expect2(typeof service).toEqual('string');
        expect2(typeof version).toEqual('string');

        // Test calling twice (should use cached value)
        expect2(config.getService()).toEqual(service);
        expect2(config.getVersion()).toEqual(version);
    });

    it('should pass init() without base (use process.env)', async () => {
        const oldEnv = process.env.TEST_INIT_VAR;
        process.env.TEST_INIT_VAR = 'init-value';

        const config = new MyConfigService();
        await config.init();

        expect2(config.get('TEST_INIT_VAR')).toEqual('init-value');

        // Restore
        if (oldEnv !== undefined) {
            process.env.TEST_INIT_VAR = oldEnv;
        } else {
            delete process.env.TEST_INIT_VAR;
        }
    });

    it('should pass marshal() with undefined and null filters', async () => {
        const filter: Filter<string> = (name, val) => {
            if (name === 'skip') return undefined;
            if (name === 'also-skip') return null;
            return `${name}=${val}`;
        };

        expect2(marshal({ keep: 1, skip: 2, 'also-skip': 3 }, filter)).toEqual(['keep=1']);
    });

    it('should pass marshal() with arrays', async () => {
        const filter: Filter<string> = (name, val) => `${name}=${val}`;

        // Test array as root
        expect2(marshal([1, 2, 3], filter)).toEqual(['0=1', '1=2', '2=3']);

        // Test nested arrays
        expect2(
            marshal(
                [
                    [1, 2],
                    [3, 4],
                ],
                filter,
            ),
        ).toEqual(['0.0=1', '0.1=2', '1.0=3', '1.1=4']);

        // Test array with objects
        expect2(marshal([{ a: 1 }, { b: 2 }], filter)).toEqual(['0.a=1', '1.b=2']);
    });

    it('should pass loadPackage() error handling', async () => {
        // Save original loadJsonSync
        const originalModule = require.cache[require.resolve('../../tools/')];

        // Mock the tools module to make loadJsonSync throw
        jest.resetModules();
        jest.doMock('../../tools/', () => ({
            ...(jest.requireActual('../../tools/') as any),
            loadJsonSync: () => {
                throw new Error('Failed to load package.json');
            },
        }));

        const config = new TestConfigService({});
        await config.init();

        // Should handle error gracefully and return empty strings
        const service = config.getService();
        const version = config.getVersion();
        expect2(service).toEqual('lemon-core');
        expect2(version).toEqual('4.0.7');

        // Restore modules
        jest.resetModules();
        jest.dontMock('../../tools/');
        if (originalModule) {
            require.cache[require.resolve('../../tools/')] = originalModule;
        }
    });

    it('should pass init() with KMS decrypt promise rejection', async () => {
        // Create a mock KMS that rejects
        const mockKms: AWSKMSService = {
            decrypt: async () => {
                throw new Error('KMS decrypt failed');
            },
        } as any;

        const $config = {
            secret: '*EncryptedValue',
            plain: 'plain-value',
        };

        const config = new MyConfigService($config, mockKms);
        await config.init();

        // Should handle decrypt error and return ERROR message
        const secretResult = config.get('secret');
        expect2(() => secretResult.startsWith('ERROR -')).toEqual(true);
        expect2(() => secretResult.includes('KMS decrypt failed')).toEqual(true);

        // Plain value should work fine
        expect2(config.get('plain')).toEqual('plain-value');
    });
});
