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
import { S3DummyService, S3StorageService } from './s3-service';
import { loadJsonSync } from '../tools/shared';

//! create service instance.
export const instance = () => {
    const dummy = new S3DummyService('dummy-data.yml');
    const service = new S3StorageService();
    return { service, dummy };
};

describe('carrot-s3-service', () => {
    /* eslint-disable prettier/prettier */

    // load on aws config to memory
    const PROFILE = loadProfile({ env: { ENV: process.env['ENV'] } });
    const { service, dummy } = instance();
    beforeAll( async (done) => {
        if(!PROFILE) return done();
        expect2( await dummy.read('999999').catch(GETERR) ).toEqual("404 NOT FOUND - _id:pedigree/999999.json");
        expect2( await service.read('999999').catch(GETERR) ).toEqual("404 NOT FOUND - _id:pedigree/999999.json");
        done();
    })
    
    it('should be same aws-s3-service with dummy-s3-service', async done => {
        if(!PROFILE) return done();
        
        // compare introduce
        expect2( dummy.hello() ).toEqual("dummy-storage-service:pedigree/_id");
        expect2( service.hello() ).toEqual("aws-s3-service:lemon-hello-www:pedigree");

        // load data
        const mock = loadJsonSync('./mocks/crawl/00_4119_carrot.inbreed_table_033566.json');
        const mock2 = loadJsonSync('./mocks/043319/00_4401_carrot.herit_table.json');

        // save & read object
        expect2( await dummy.$pedigree.savePedigreePullData([mock.node], 'dosage') ).toEqual([{"id": "033566"}]);
        expect2( await dummy.$pedigree.savePedigreePullData([mock2.node], 'dosage') ).toEqual([{"id": "043319"}]);
        expect2( await dummy.read('033566'), '_id,id,type,stereo' ).toEqual({"_id": "pedigree/033566.json", "id": "033566", "stereo": "dosage", "type": "pedigree"});
        const fetchDummy = await dummy.read('033566');
        const fetchDummy2 = await dummy.read('043319');
        expect2( await service.$pedigree.savePedigreePullData([mock.node], 'dosage') ).toEqual([{"id": "033566"}]);
        expect2( await service.$pedigree.savePedigreePullData([mock2.node], 'dosage') ).toEqual([{"id": "043319"}]);
        expect2( await service.read('033566'), '_id,id,type,stereo' ).toEqual({"_id": undefined, "id": "033566", "stereo": "dosage", "type": "pedigree"});
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
        expect2( await dummy.read('033566').catch(GETERR) ).toEqual("404 NOT FOUND - _id:pedigree/033566.json");
        expect2( await dummy.read('043319').catch(GETERR) ).toEqual("404 NOT FOUND - _id:pedigree/043319.json");
        const removeAWS = await service.delete('033566');
        const removeAWS2 = await service.delete('043319');
        expect2( await service.read('033566').catch(GETERR) ).toEqual("404 NOT FOUND - _id:pedigree/033566.json");
        expect2( await service.read('043319').catch(GETERR) ).toEqual("404 NOT FOUND - _id:pedigree/043319.json");

        // exactly same delete object.
        expect2( removeDummy , '!_id').toEqual(removeAWS);
        expect2( removeDummy2 , '!_id').toEqual(removeAWS2);

        done();
    });
    /* eslint-enable prettier/prettier */
});
