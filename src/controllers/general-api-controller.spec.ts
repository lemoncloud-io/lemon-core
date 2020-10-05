/**
 * `general-api-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-01-08 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import request from 'supertest';
import { LambdaWEBHandler, LambdaHandler } from '../cores/lambda';
import { ProtocolParam, Elastic6QueryService } from '../cores';
import { buildEngine } from '../engine';
import { buildExpress, loadJsonSync } from '../tools';
import { expect2, GETERR } from '../common/test-helper';
import { GeneralAPIController } from './general-api-controller';
import { TypedStorageService } from '../cores/proxy-storage-service';

import * as $proxy from '../cores/proxy-storage-service.spec';

//! local `lambda-web-handler` to server dummy
class LambdaWEBHandlerLocal extends LambdaWEBHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
    public result: any = null;
    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        const result: TResult = await super.handleProtocol(param);
        this.result = result;
        return result;
    }
}

// eslint-disable-next-line prettier/prettier
class MyGeneralAPIController extends GeneralAPIController<TypedStorageService<$proxy.MyModel, $proxy.MyType>, $proxy.MyType> {
    public constructor(
        type: string,
        storage: TypedStorageService<$proxy.MyModel, $proxy.MyType>,
        search: Elastic6QueryService<any>,
        uniqueField?: string,
    ) {
        super(type, storage, search, uniqueField);
    }
}

//! create instance.
export const instance = (type: 'dummy', unique?: string) => {
    const { storage2 } = $proxy.instance(type == 'dummy' ? 'dummy-account-data.yml' : type);
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    const storage = storage2.makeTypedStorageService('test');
    const controller = new MyGeneralAPIController('test', storage, null, unique);
    $web.addController(controller);
    //! build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, app: $express.app, storage };
};

//! main test body.
describe('GeneralController', () => {
    //! general contoller api.
    it('should pass basic CRUD w/ general-controller as name unique', async done => {
        const { controller, app, storage } = instance('dummy', 'name');
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-api-controller:test');
        expect2(() => storage.hello()).toEqual('typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-account-data/_id');

        //! check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //! each function mapping.
        expect2(await request(app).get('/hello/aaa'), 'status,!text,body').toEqual({ status:404, text:undefined, body:{} });
        expect2(await request(app).get('/test/aaa'), 'status,text,body').toEqual({ status:404, text:'404 NOT FOUND - _id:TT:test:aaa', body:{} });

        //! post name:'AAA' to make new
        expect2(await storage.read('1000001').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000001')
        expect2((await request(app).post('/test/0').send({ name:'AAA' })).body, 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' });
        expect2(await storage.read('1000001').catch(GETERR), 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' })

        //! test error cases.
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002')
        expect2(await request(app).post('/test/%20').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'@id (string) is required!', body:{} });
        expect2(await request(app).post('/test/1000002').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002')

        //! post name:'BBB' -> 'CCC' w/ id
        expect2(await storage.read('bbb').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:bbb')
        expect2((await request(app).post('/test/bbb').send({ name:'BBB' })).body, 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' });               // save as 'BBB'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' })
        expect2((await request(app).post('/test/bbb').send({ name:'CCC' })).body, 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' });               // rename to 'CCC"
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' })
        expect2((await request(app).post('/test/bbb').send({ name:'' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });           // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })
        expect2((await request(app).post('/test/bbb').send({ name:'CCC' })).body, 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' });               // restore to 'CCC'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' })
        expect2((await request(app).post('/test/bbb').send({ name:'' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });           // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })

        //! try to save 'AAA'
        expect2(await request(app).post('/test/bbb').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })

        //! try to update 'CCC'
        // expect2(await request(app).put('/test/bbb').send({ name:'CCC' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'CCC' })).body, 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' })

        //! try to update ''
        // expect2(await request(app).put('/test/bbb').send({ name:'' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })

        //! try to update 'AAA'
        expect2(await request(app).put('/test/bbb').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        // expect2((await request(app).put('/test/bbb').send({ name:'AAA' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })

        //! try to update 'BBB'
        // expect2(await request(app).put('/test/bbb').send({ name:'BBB' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'BBB' })).body, 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' });
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual({ id:'#name/BBB', type:'test', stereo:'#', meta:'bbb' });     // lookup-data

        //! try to delete w/o destroy
        // expect2(await request(app).delete('/test/bbb'), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).delete('/test/bbb')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' });
        expect2((await storage.read('bbb').catch(GETERR) as any).deletedAt > 0).toEqual(true);
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual({ id:'#name/BBB', type:'test', stereo:'#', meta:'bbb' });     // lookup-data (remained)

        //! try to delete w/ destroy
        expect2((await request(app).delete('/test/bbb?destroy')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual('404 NOT FOUND - _id:TT:test:#name/BBB');                     // lookup-data (deleted)

        /* eslint-enable prettier/prettier */
        done();
    });

    //! general contoller api.
    it('should pass basic CRUD w/ general-controller w/o unique', async done => {
        const { controller, app, storage } = instance('dummy');
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-api-controller:test');
        expect2(() => storage.hello()).toEqual('typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-account-data/_id');

        //! check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200});

        //! each function mapping.
        expect2(await request(app).get('/hello/aaa'), 'status,!text,body').toEqual({ status:404, text:undefined, body:{} });
        expect2(await request(app).get('/test/aaa'), 'status,text,body').toEqual({ status:404, text:'404 NOT FOUND - _id:TT:test:aaa', body:{} });

        //! post name:'AAA' to make new
        expect2(await storage.read('1000001').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000001')
        expect2((await request(app).post('/test/0').send({ name:'AAA' })).body, 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' });
        expect2(await storage.read('1000001').catch(GETERR), 'id,type,name').toEqual({ id:'1000001', type:'test', name:'AAA' })

        //! test error cases..
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002')
        expect2(await request(app).post('/test/%20').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'@id (string) is required!', body:{} });
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002')

        //! post name:'BBB' -> 'CCC' w/ id
        expect2(await storage.read('bbb').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:bbb')
        expect2((await request(app).post('/test/bbb').send({ name:'BBB' })).body, 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' });               // save as 'BBB'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' })
        expect2((await request(app).post('/test/bbb').send({ name:'CCC' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'CCC' });               // rename to 'CCC"
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' })
        expect2((await request(app).post('/test/bbb').send({ name:'' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });           // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })
        expect2((await request(app).post('/test/bbb').send({ name:'CCC' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'CCC' });               // restore to 'CCC'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' })
        expect2((await request(app).post('/test/bbb').send({ name:'' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });           // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })

        //! try to save 'AAA'
        // expect2(await request(app).post('/test/bbb').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).post('/test/bbb').send({ name:'AAA' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'AAA' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'AAA' })

        //! try to update 'CCC'
        // expect2(await request(app).put('/test/bbb').send({ name:'CCC' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'CCC' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'CCC' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'CCC' })

        //! try to update ''
        // expect2(await request(app).put('/test/bbb').send({ name:'' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'' })

        //! try to update 'AAA'
        // expect2(await request(app).put('/test/bbb').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'AAA' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'AAA' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'AAA' })

        //! try to update 'BBB'
        // expect2(await request(app).put('/test/bbb').send({ name:'BBB' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name:'BBB' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'BBB' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' })
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual('404 NOT FOUND - _id:TT:test:#name/BBB');                     // lookup-data (no exists)

        //! try to delete w/o destroy
        // expect2(await request(app).delete('/test/bbb'), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).delete('/test/bbb')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id:'bbb', type:'test', name:'BBB' });
        expect2((await storage.read('bbb').catch(GETERR) as any).deletedAt > 0).toEqual(true);
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual('404 NOT FOUND - _id:TT:test:#name/BBB');                     // lookup-data (no exists)

        //! try to delete w/ destroy
        expect2((await request(app).delete('/test/bbb?destroy')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual('404 NOT FOUND - _id:TT:test:#name/BBB');                     // lookup-data (no exists)

        /* eslint-enable prettier/prettier */
        done();
    });
});
