/**
 * `tools/tools.spec.ts`
 * - test runnder of hello-api
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-08-01 initial version with `supertest`.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import loadEnviron, { credentials } from '../environ'; //INFO! load environ first.
import { expect2, GETERR } from '../common/test-helper';
import { loadJsonSync, awsConfig, AwsConfigParams, onlyDefined, isLambda } from './tools';
import { fromIni } from '@aws-sdk/credential-providers';
import $engine from '../engine';
import { AWSSNSService } from '../cores/aws/aws-sns-service';

//! main test body.
describe('Test tools/shared', () => {
    jest.setTimeout(10000);

    beforeAll(() => {
        loadEnviron(global.process);
    });

    test('test loadJsonSync()', () => {
        const data1 = loadJsonSync('package.json');
        const data2 = loadJsonSync('./package.json');
        expect(data1.name).toEqual('lemon-core');
        expect(data2.name).toEqual('lemon-core');
        expect(data1.version).toEqual(data2.version);
    });

    it('test awsConfig()', async () => {
        const region = 'ap-northeast-2';
        const profile = $engine.environ('NAME', 'none') as string;
        const useNone = profile === 'none' || !profile; // no aws profile (use `npm run test`)
        const isLemon = profile === 'lemon'; // aws profile for lemon (use `npm run test.lemon`)
        useNone || console.info(`! profile =`, profile);

        expect2(() => $engine.environ('AWS_PROFILE')).toEqual();

        const _config = <T = any>(N?: T, hasCred?: boolean) => {
            const cfg = awsConfig<T>($engine, N);
            if (!hasCred) delete cfg.credentials;
            return cfg;
        };
        //* check with real client.
        const _sns = async (cfg: AwsConfigParams) => {
            const sns = new AWSSNSService();
            return sns.accountID($engine, cfg);
        };

        //* test of region.
        if (useNone) {
            expect2(() => _config()).toEqual({ region });
            expect2(() => _config(null)).toEqual({});
            expect2(() => _config(undefined)).toEqual({ region });
            expect2(() => _config({})).toEqual({});
            expect2(() => _config('')).toEqual('.region[] is invalid (empty) - awsConfig(lemon)');
            expect2(() => _config('x')).toEqual({ region: 'x' });
            expect2(() => _config(region)).toEqual({ region });
            expect2(() => _config(() => region)).toEqual({ region });
            expect2(() => _config({ region })).toEqual({ region });
            expect2(() => _config({ region: 'x' })).toEqual({ region: 'x' });
            expect2(() => _config({ region: '' })).toEqual('.region[] is invalid (empty) - awsConfig(lemon)');
            expect2(() => _config({ region: null })).toEqual({ region: null });
            expect2(() => _config({ region: null, lemon: 'cloud' })).toEqual({ region: null, lemon: 'cloud' });
        }

        //* common test of credentials. (run via `npm run test:watch`)
        expect2(() => typeof _config(null, true).credentials).toEqual(useNone ? 'undefined' : 'function');

        //* test of default profile.
        if (useNone) {
            const cfg1 = _config(null, true);
            expect2(() => typeof cfg1?.profile).toEqual('undefined');
            expect2(() => typeof cfg1?.credentials).toEqual('undefined');
            expect2(() => cfg1?.credentials()).toEqual('cfg1.credentials is not a function');
            expect2(() => cfg1.credentials()).toEqual('cfg1.credentials is not a function');

            //NOTE - it will be failed if there is `default` profile in `~/.aws/credentials`.
            expect2(await _sns(cfg1).catch(GETERR)).toEqual('Could not load credentials from any providers');
        }

        //* test of `lemon` profile. (run via `npm run test:watch.lemon`)
        if (isLemon) {
            expect2(() => profile).toEqual('lemon');
            expect2(() => _config({ profile: 'none' }), 'profile').toEqual({ profile: 'none' });
            expect2(() => _config({ profile: 'some' }), 'profile').toEqual({ profile: 'some' });

            // proper for lemon profile.
            const cfg1 = _config(undefined, true);
            expect2(() => cfg1.profile).toEqual(profile);
            expect2(() => typeof cfg1.credentials).toEqual('function');
            expect2(await cfg1.credentials().catch(GETERR)).toEqual(expect.any(Object));

            // no profile[some]
            const cfg2 = _config({ profile: 'some', region }, true);
            expect2(() => cfg2.profile).toEqual('some');
            expect2(() => typeof cfg2.credentials).toEqual('function');
            expect2(await cfg2.credentials().catch(GETERR)).toEqual(
                'Could not resolve credentials using profile: [some] in configuration/credentials file(s).',
            );

            // no profile[some] with null credentials.
            const cfg3 = _config({ profile: 'some', region, credentials: async () => null }, true);
            expect2(() => cfg3.profile).toEqual('some');
            expect2(() => typeof cfg3.credentials).toEqual('function');
            expect2(await cfg3.credentials().catch(GETERR)).toEqual(null);

            // no profile[some] with undefined credentials.
            const cfg4 = _config({ profile: 'some', region, credentials: async () => undefined }, true);
            expect2(() => cfg4.profile).toEqual('some');
            expect2(() => typeof cfg4.credentials).toEqual('function');
            expect2(await cfg4.credentials().catch(GETERR)).toEqual(undefined);

            // no profile[some] without `credentials` function.
            const cfg5 = _config({ profile: 'some', region, credentials: async () => null }, false);
            expect2(() => cfg5.profile).toEqual('some');
            expect2(() => typeof cfg5.credentials).toEqual('undefined');
            expect2(() => cfg5.credentials().catch(GETERR)).toEqual('cfg5.credentials is not a function');

            // no `.profile` property.
            const cfg6 = onlyDefined({ ...cfg5, profile: undefined });
            expect2(() => cfg6.profile).toEqual(undefined);
            expect2(() => typeof cfg6.credentials).toEqual('undefined');
            expect2(() => cfg6.credentials().catch(GETERR)).toEqual('cfg6.credentials is not a function');
            expect2(() => cfg6).toEqual({ region: 'ap-northeast-2' });

            // get credentials
            const expectedCreds = await fromIni({ profile })();
            // eslint-disable-next-line prettier/prettier
            const _cred = (k?: string) => cfg1.credentials().then((N: any) => N?.[k]).catch(GETERR);

            expect2(() => _cred('accessKeyId')).toEqual(expectedCreds.accessKeyId);
            expect2(() => _cred('secretAccessKey')).toEqual(expectedCreds.secretAccessKey);
            expect2(() => _cred('sessionToken')).toEqual(expectedCreds.sessionToken);

            expect2(await _sns(cfg1).catch(GETERR)).toEqual('085403634746');
            expect2(await _sns(cfg2).catch(GETERR)).toEqual(
                `Could not resolve credentials using profile: [some] in configuration/credentials file(s).`,
            );
            expect2(await _sns(cfg3).catch(GETERR)).toEqual(`Cannot read properties of null (reading 'expiration')`);
            expect2(await _sns(cfg4).catch(GETERR)).toEqual(
                `Cannot read properties of undefined (reading 'expiration')`,
            );
            expect2(await _sns(cfg5).catch(GETERR)).toEqual(
                'Could not resolve credentials using profile: [some] in configuration/credentials file(s).',
            );
            expect2(await _sns(cfg6).catch(GETERR)).toEqual('085403634746');
        }
    });

    test('test isLambda()', () => {
        // return false if not in Lambda environment.
        const originalEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        expect2(() => isLambda()).toEqual(false);

        // return true if in Lambda environment.
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-lambda-function';
        expect2(() => isLambda()).toEqual(true);

        // return false if empty string.
        process.env.AWS_LAMBDA_FUNCTION_NAME = '';
        expect2(() => isLambda()).toEqual(false);

        // restore original environment.
        if (originalEnv) process.env.AWS_LAMBDA_FUNCTION_NAME = originalEnv;
        else delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    });

    test('test awsConfig() with Lambda environment', () => {
        const originalEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;

        // simulate Lambda environment.
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-lambda-function';

        // credentials should be undefined in Lambda environment. (profile is 'none')
        const config = awsConfig($engine, { region: 'ap-northeast-2' });
        expect2(() => config.credentials).toEqual(undefined); // credentials should be undefined in Lambda environment.

        // restore original environment.
        if (originalEnv) process.env.AWS_LAMBDA_FUNCTION_NAME = originalEnv;
        else delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    });
});
