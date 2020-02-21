/**
 * `carrot-s3-service.spec.js`
 *
 * @author      Tyler Lee <tyler@lemoncloud.io>
 * @date        2019-12-03 migrated via origin accounts-service.js
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../environ';
import { GETERR, expect2, _it, environ } from '../common/test-helper';
import { S3Service, DummyS3Service } from './s3-service';
import { loadJsonSync } from '../tools/shared';

//! create service instance.
export const instance = () => {
    const dummy = new DummyS3Service('dummy-dynamo-data.yml');
    const service = new S3Service();
    return { service, dummy };
};

describe('carrot-s3-service', () => {
    /* eslint-disable prettier/prettier */

    // load on aws config to memory
    const PROFILE = loadProfile({ env: { ENV: process.env['ENV'] } });
    const { service, dummy } = instance();
    beforeAll( async (done) => {
        if(!PROFILE) return done();
        expect2( await dummy.read('999999').catch(GETERR) ).toEqual("404 NOT FOUND - _id:dummy/999999.json");
        expect2( await service.read('999999').catch(GETERR) ).toEqual("404 NOT FOUND - _id:test/999999.json");
        done();
    })
    
    it('should be same aws-s3-service with dummy-s3-service', async done => {
        if(!PROFILE) return done();
        
        // compare introduce
        expect2( dummy.hello() ).toEqual("dummy-storage-service:memory/_id");
        expect2( service.hello() ).toEqual("aws-s3-service:lemon-hello-www:test");

        // load data
        const mock = loadJsonSync('./data/mocks/carrot.inbreed_table_033566.json');
        const mock2 = loadJsonSync('./data/mocks/carrot.herit_table.json');

        // save & read object
        expect2( await dummy.save('033566', mock.node) , '_id' ).toEqual({"_id": "dummy/033566.json"});
        expect2( await dummy.save('043319', mock2.node), '_id' ).toEqual({"_id": "dummy/043319.json"});
        expect2( await dummy.read('033566'), '_id,id,type,stereo' ).toEqual({"_id": "dummy/033566.json"});
        const fetchDummy = await dummy.read('033566');
        const fetchDummy2 = await dummy.read('043319');
        expect2( await service.save('033566', mock.node), 'mabun' ).toEqual( {"mabun": "033566"});
        expect2( await service.save('043319', mock2.node), 'mabun' ).toEqual( {"mabun": "043319"});
        expect2( await service.read('033566'), '_id,id,type,stereo' ).toEqual({"_id": undefined});
        const fetchAws = await service.read('033566');
        const fetchAws2 = await service.read('043319');

        // exactly same read object.
        expect2( fetchDummy, '!_id' ).toEqual(fetchAws);
        expect2( fetchDummy2, '!_id' ).toEqual(fetchAws2);

        // update object
        const updateDummy = await dummy.update('033566', mock2.node, {user:'carrot'});
        const updateAWS = await service.update('033566', mock2.node, {user:'carrot'});
        expect2(updateDummy, '!_id').toEqual(updateAWS);

        const updatedDummy = await dummy.read('033566');
        const updatedAWS = await service.read('033566');
        expect2(updatedDummy, '!_id').toEqual(updatedAWS);

        // delete data
        const removeDummy = await dummy.delete('033566');
        const removeDummy2 = await dummy.delete('043319');
        expect2( await dummy.read('033566').catch(GETERR) ).toEqual("404 NOT FOUND - _id:dummy/033566.json");
        expect2( await dummy.read('043319').catch(GETERR) ).toEqual("404 NOT FOUND - _id:dummy/043319.json");
        const removeAWS = await service.delete('033566');
        const removeAWS2 = await service.delete('043319');
        expect2( await service.read('033566').catch(GETERR) ).toEqual("404 NOT FOUND - _id:test/033566.json");
        expect2( await service.read('043319').catch(GETERR) ).toEqual("404 NOT FOUND - _id:test/043319.json");

        // exactly same delete object.
        expect2( removeDummy , '!_id').toEqual(removeAWS);
        expect2( removeDummy2 , '!_id').toEqual(removeAWS2);

        done();
    });
    /* eslint-enable prettier/prettier */
});
