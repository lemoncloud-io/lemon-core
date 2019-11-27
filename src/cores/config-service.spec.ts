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
import { $engine, _log, _inf, _err, $U } from '../engine/';
import { credentials } from '../tools/';
import { AWSKMSService } from './aws-kms-service';
import { expect2, _it } from '../common/test-helper';

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
import { marshal, Filter, MyConfigService } from './config-service';

describe('ConfigService', () => {
    //TODO - load AWS credentials.
    const PROFILE = 0 ? 'lemon' : '';
    if (PROFILE) credentials(PROFILE);

    //! dummy storage service.
    it('should pass expect2 helper', async done => {
        /* eslint-disable prettier/prettier */
        expect2(()=>{ throw new Error('HI Error') }).toBe('HI Error');
        expect2(async ()=>{ throw new Error('HI Error') }).toBe('HI Error');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test marshal
    it('should pass marshal()', async done => {
        const defFilter: Filter<string> = (name: string, val: any) => `${name}=${val}`;
        /* eslint-disable prettier/prettier */
        expect2(marshal({ a:1 }, defFilter)).toEqual([ 'a=1' ]);
        expect2(marshal({ a:true }, defFilter)).toEqual([ 'a=true' ]);
        expect2(marshal({ a:{b:false} }, defFilter)).toEqual([ 'a.b=false' ]);
        expect2(marshal({ a:[1,'b'] }, defFilter)).toEqual([ 'a.0=1', 'a.1=b' ]);
        expect2(marshal({ a:[1,'b'] }, defFilter)).toEqual([ 'a.0=1', 'a.1=b' ]);
        expect2(marshal({ a:[1,{b:1}] }, defFilter)).toEqual([ 'a.0=1', 'a.1.b=1' ]);
        expect2(() => marshal({ a:[1,{b:1}] }, null)).toEqual('filter is required!');
        expect2(marshal(['a', 2], defFilter)).toEqual([ '0=a','1=2' ]);

        //! test simple filter
        if (1){
            const filter: Filter<string> = (name, val) => name.startsWith('a.1') ? `${name}=${val}` : null;
            expect2(marshal({ a:[1,{b:1}] }, filter)).toEqual([ 'a.1.b=1' ]);
        }

        //! test filter-replace
        if (1){
            const origin = { a:[1,{b:1}] };                         // origin
            const target = JSON.parse(JSON.stringify(origin));      // deep copy
            const filter: Filter<string> = (name, val, thiz, key) => {
                if (name == 'a.0') thiz[key] = 3;                   // replace origin.
                if (name == 'a.1.b') thiz[key] = 5;                 // replace origin.
                return `${name}=${val}`;
            };
            expect2(target).toEqual(origin);
            expect2(marshal(target, filter)).toEqual([ 'a.0=1', 'a.1.b=1' ]);
            expect2(target).toEqual({ a:[3,{b:5}] });
            expect2(marshal(target, defFilter)).toEqual([ 'a.0=3', 'a.1.b=5' ]);
        }

        /* eslint-enable prettier/prettier */
        done();
    });

    //! test w/ aws-kms-service
    _it('should pass aws-kms-service()', async done => {
        if (!PROFILE) return done();

        //NOTE - use `alias/lemon-hello-api` by default
        const service = new AWSKMSService();
        const keyId = 'alias/lemon-hello-api';
        const message = `hello lemon!`;

        /* eslint-disable prettier/prettier */
        expect2(await service.hello()).toEqual({ hello: 'aws-kms-service' });
        expect2(await service.keyId()).toEqual(keyId);
        expect2(await service.sample(), 'keyId,message,decrypted').toEqual({ keyId, message, decrypted: message });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test config-service
    it('should pass config-service()', async done => {
        if (!PROFILE) return done();

        //NOTE - use `alias/lemon-hello-api` by default
        const $kms = new AWSKMSService();
        const message = 'hello-lemon';
        const encrypted = await $kms.encrypt(message);
        const secret = `*${encrypted}`;
        console.info(`encrypt[${message}] :=`, secret);

        //! prepare dummy config set.
        const $config = {
            count: 1,
            token: {
                issuer: 'lemon',
                secret,
            },
        };

        /* eslint-disable prettier/prettier */
        const origin = JSON.parse($U.json($config));                                        // deep copy
        const service = await MyConfigService.factory($config);                             // wait until loading completely.

        //! check result..
        expect2(service.hello()).toEqual({ hello: 'config-service' });
        expect2(service.get('count')).toEqual('1');                                         // must be string.
        expect2(service.get('token.issuer')).toEqual(origin.token.issuer);                  // not encrypted.
        expect2(service.get('token.secret')).toEqual(message);                              // decrypted successfully.

        // expect2($config).toEqual(origin);                                                // should be `fail`
        expect2($config.count).toBe(1);                                                     // keep number origin
        expect2($config.token.issuer).toBe(origin.token.issuer);                            // keep issuer
        expect2($config.token.secret).toBe(secret);                                         // NOT updated with decrypted.

        /* eslint-enable prettier/prettier */
        done();
    });
});
