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
import { loadJsonSync } from './tools';

//! main test body.
describe('Test tools/shared', () => {
    test('test loadJsonSync()', () => {
        const data1 = loadJsonSync('package.json');
        const data2 = loadJsonSync('./package.json');
        expect(data1.name).toEqual('lemon-core');
        expect(data2.name).toEqual('lemon-core');
        expect(data1.version).toEqual(data2.version);
    });
});
