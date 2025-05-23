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
import { fromIni } from '@aws-sdk/credential-providers';
import { expect2, GETERR } from '../common/test-helper';
import { loadJsonSync, awsConfig } from './tools';
import $engine from '../engine';

//! main test body.
describe('Test tools/shared', () => {
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
        const cfg = awsConfig(region);
        expect2(() => cfg.region).toEqual(region);
        expect2(() => typeof cfg.credentials).toEqual('function');

        if (profile !== 'none') {
            // get credentials
            const expectedCreds = await fromIni({ profile })();
            const creds = typeof cfg.credentials === 'function' ? await cfg.credentials() : undefined;

            expect2(creds?.accessKeyId).toEqual(expectedCreds.accessKeyId);
            expect2(creds?.secretAccessKey).toEqual(expectedCreds.secretAccessKey);
            expect2(creds?.sessionToken).toEqual(expectedCreds.sessionToken);
        } else {
            const creds = typeof cfg.credentials === 'function' ? await cfg.credentials().catch(GETERR) : null;
            expect2(creds).toEqual(
                'Could not resolve credentials using profile: [none] in configuration/credentials file(s).',
            );
        }
    });
});
