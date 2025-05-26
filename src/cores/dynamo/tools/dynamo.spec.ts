/**
 * `dynamo.spec.js`
 * - unit test for `dynamo-scan-service` w/ dummy data
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 initial version
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '../../../common/test-helper';
import { strToBin } from './utils';
import Serializer from './serializer';

//! main test body.
describe('Dynamo/lib', () => {
    it('should pass AWSUtil', async () => {
        expect2(() => 'hi').toEqual('hi');
        expect2(() => strToBin('hi')).toEqual(Buffer.from('hi'));
        expect2(() => strToBin('hi').toString('utf8')).toEqual('hi');

        expect2(() => strToBin(null)).toEqual('Need to pass in string primitive to be converted to binary.');
        expect2(() => strToBin([])).toEqual('Need to pass in string primitive to be converted to binary.');
    });

    it('should pass serializer', async () => {
        expect2(() => 'hi').toEqual('hi');

        expect2(() => ['a']).toEqual(['a']);
        expect2(() => Serializer.serializeAttribute('a', 'S')).toEqual('a');

        expect2(() => Serializer.serializeAttribute('a')).toEqual('a');
        expect2(() => Serializer.serializeAttribute('')).toEqual('');
        expect2(() => Serializer.serializeAttribute(null)).toEqual(null);
        expect2(() => Serializer.serializeAttribute(undefined)).toEqual(undefined);

        //! WARN - `Received: serializes to the same string` => need to check compartibility.
        expect2(() => Serializer.serializeAttribute('a', 'SS')).toEqual(['a']);

        expect2(() => JSON.stringify(Serializer.serializeAttribute('a', 'SS'))).toEqual('["a"]');

        // expect2(() => AWSUtil.isBrowser()).toEqual();
        // expect2(() => AWSUtil.Buffer('')).toEqual();

        //TODO - check `scan.buildRequest()`
    });
});
