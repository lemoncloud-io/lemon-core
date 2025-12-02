/**
 * `general-api-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-01-08 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { LambdaWEBHandler, LambdaHandler } from '../cores/lambda';
import { ProtocolParam, Elastic6QueryService, SimpleSearchParam } from '../cores';
import { buildEngine } from '../engine';
import { buildExpress } from '../tools';
import { expect2, GETERR } from '../common/test-helper';
import { GeneralAPIController } from './general-api-controller';
import { TypedStorageService } from '../cores/';
import * as $proxy from '../cores/storage/proxy-storage-service.spec';
import request from 'supertest';

//* local `lambda-web-handler` to server dummy
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

//* create instance.
export const instance = (type: 'dummy', unique?: string, withSearch = false) => {
    const { storage2 } = $proxy.instance(type == 'dummy' ? 'dummy-account-data.yml' : type);
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    const storage = storage2.makeTypedStorageService('test');
    //* create mock search service if requested
    const search = withSearch
        ? ({
              searchSimple: async (param: SimpleSearchParam) => {
                  return { total: 0, list: [] as any[], page: param?.$page || 0, limit: param?.$limit || 12 };
              },
          } as any)
        : null;
    const controller = new MyGeneralAPIController('test', storage, search, unique);

    $web.addController(controller);
    //* build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, app: $express.app, storage };
};

//! main test body.
describe('GeneralController', () => {
    //* general contoller api.
    it('should pass basic CRUD w/ general-controller as name unique', async () => {
        const { controller, app, storage } = instance('dummy', 'name');
        expect2(() => controller.hello()).toEqual('general-api-controller:test');
        expect2(() => storage.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-account-data/_id',
        );

        //* check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //* each function mapping.
        expect2(await request(app).get('/hello/aaa'), 'status,!text,body').toEqual({
            status: 404,
            text: undefined,
            body: {},
        });
        expect2(await request(app).get('/test/aaa'), 'status,text,body').toEqual({
            status: 404,
            text: '404 NOT FOUND - _id:TT:test:aaa',
            body: {},
        });

        //* post name:'AAA' to make new
        expect2(await storage.read('1000001').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000001');
        expect2((await request(app).post('/test/0').send({ name: 'AAA' })).body, 'id,type,name').toEqual({
            id: '1000001',
            type: 'test',
            name: 'AAA',
        });
        expect2(await storage.read('1000001').catch(GETERR), 'id,type,name').toEqual({
            id: '1000001',
            type: 'test',
            name: 'AAA',
        });

        //* test error cases.
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002');
        expect2(await request(app).post('/test/%20').send({ name: 'AAA' }), 'status,text,body').toEqual({
            status: 400,
            text: '@id (string) is required!',
            body: {},
        });
        expect2(await request(app).post('/test/1000002').send({ name: 'AAA' }), 'status,text,body').toEqual({
            status: 400,
            text: '400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]',
            body: {},
        });
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002');

        //* post name:'BBB' -> 'CCC' w/ id
        expect2(await storage.read('bbb').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2((await request(app).post('/test/bbb').send({ name: 'BBB' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        }); // save as 'BBB'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2((await request(app).post('/test/bbb').send({ name: 'CCC' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        }); // rename to 'CCC"
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });
        expect2((await request(app).post('/test/bbb').send({ name: '' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: '',
        }); // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });
        expect2((await request(app).post('/test/bbb').send({ name: 'CCC' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        }); // restore to 'CCC'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });
        expect2((await request(app).post('/test/bbb').send({ name: '' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: '',
        }); // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });

        //* try to save 'AAA'
        expect2(await request(app).post('/test/bbb').send({ name: 'AAA' }), 'status,text,body').toEqual({
            status: 400,
            text: '400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]',
            body: {},
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });

        //* try to update 'CCC'
        // expect2(await request(app).put('/test/bbb').send({ name:'CCC' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: 'CCC' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });

        //* try to update ''
        // expect2(await request(app).put('/test/bbb').send({ name:'' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: '' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: '',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });

        //* try to update 'AAA'
        expect2(await request(app).put('/test/bbb').send({ name: 'AAA' }), 'status,text,body').toEqual({
            status: 400,
            text: '400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]',
            body: {},
        });
        // expect2((await request(app).put('/test/bbb').send({ name:'AAA' })).body, 'id,type,name').toEqual({ id:'bbb', type:undefined, name:'' });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });

        //* try to update 'BBB'
        // expect2(await request(app).put('/test/bbb').send({ name:'BBB' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: 'BBB' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual({
            id: '#name/BBB',
            type: 'test',
            stereo: '#',
            meta: 'bbb',
        }); // lookup-data

        //* try to delete w/o destroy
        // expect2(await request(app).delete('/test/bbb'), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).delete('/test/bbb')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2(((await storage.read('bbb').catch(GETERR)) as any).deletedAt > 0).toEqual(true);
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual({
            id: '#name/BBB',
            type: 'test',
            stereo: '#',
            meta: 'bbb',
        }); // lookup-data (remained)

        //* try to delete w/ destroy
        expect2((await request(app).delete('/test/bbb?destroy')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual(
            '404 NOT FOUND - _id:TT:test:#name/BBB',
        ); // lookup-data (deleted)
    });

    //* general contoller api.
    it('should pass basic CRUD w/ general-controller w/o unique', async () => {
        const { controller, app, storage } = instance('dummy');
        expect2(() => controller.hello()).toEqual('general-api-controller:test');
        expect2(() => storage.hello()).toEqual(
            'typed-storage-service:test/proxy-storage-service:dummy-storage-service:dummy-account-data/_id',
        );

        //* check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //* each function mapping.
        expect2(await request(app).get('/hello/aaa'), 'status,!text,body').toEqual({
            status: 404,
            text: undefined,
            body: {},
        });
        expect2(await request(app).get('/test/aaa'), 'status,text,body').toEqual({
            status: 404,
            text: '404 NOT FOUND - _id:TT:test:aaa',
            body: {},
        });

        //* post name:'AAA' to make new
        expect2(await storage.read('1000001').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000001');
        expect2((await request(app).post('/test/0').send({ name: 'AAA' })).body, 'id,type,name').toEqual({
            id: '1000001',
            type: 'test',
            name: 'AAA',
        });
        expect2(await storage.read('1000001').catch(GETERR), 'id,type,name').toEqual({
            id: '1000001',
            type: 'test',
            name: 'AAA',
        });

        //* test error cases..
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002');
        expect2(await request(app).post('/test/%20').send({ name: 'AAA' }), 'status,text,body').toEqual({
            status: 400,
            text: '@id (string) is required!',
            body: {},
        });
        expect2(await storage.read('1000002').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:1000002');

        //* post name:'BBB' -> 'CCC' w/ id
        expect2(await storage.read('bbb').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2((await request(app).post('/test/bbb').send({ name: 'BBB' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        }); // save as 'BBB'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2((await request(app).post('/test/bbb').send({ name: 'CCC' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: 'CCC',
        }); // rename to 'CCC"
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });
        expect2((await request(app).post('/test/bbb').send({ name: '' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: '',
        }); // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });
        expect2((await request(app).post('/test/bbb').send({ name: 'CCC' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: 'CCC',
        }); // restore to 'CCC'
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });
        expect2((await request(app).post('/test/bbb').send({ name: '' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: '',
        }); // reset to ''
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });

        //* try to save 'AAA'
        // expect2(await request(app).post('/test/bbb').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).post('/test/bbb').send({ name: 'AAA' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: 'AAA',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'AAA',
        });

        //* try to update 'CCC'
        // expect2(await request(app).put('/test/bbb').send({ name:'CCC' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: 'CCC' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: 'CCC',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'CCC',
        });

        //* try to update ''
        // expect2(await request(app).put('/test/bbb').send({ name:'' }), 'status,text,body').toEqual({ status:400, text:'@name (CCC) is not same as ()!', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: '' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: '',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({ id: 'bbb', type: 'test', name: '' });

        //* try to update 'AAA'
        // expect2(await request(app).put('/test/bbb').send({ name:'AAA' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: 'AAA' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: 'AAA',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'AAA',
        });

        //* try to update 'BBB'
        // expect2(await request(app).put('/test/bbb').send({ name:'BBB' }), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).put('/test/bbb').send({ name: 'BBB' })).body, 'id,type,name').toEqual({
            id: 'bbb',
            type: undefined,
            name: 'BBB',
        });
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual(
            '404 NOT FOUND - _id:TT:test:#name/BBB',
        ); // lookup-data (no exists)

        //* try to delete w/o destroy
        // expect2(await request(app).delete('/test/bbb'), 'status,text,body').toEqual({ status:400, text:'400 DUPLICATED NAME - name[AAA] is duplicated to test[1000001]', body:{} });
        expect2((await request(app).delete('/test/bbb')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual({
            id: 'bbb',
            type: 'test',
            name: 'BBB',
        });
        expect2(((await storage.read('bbb').catch(GETERR)) as any).deletedAt > 0).toEqual(true);
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual(
            '404 NOT FOUND - _id:TT:test:#name/BBB',
        ); // lookup-data (no exists)

        //* try to delete w/ destroy
        expect2((await request(app).delete('/test/bbb?destroy')).body.deletedAt > 0).toEqual(true);
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2(await storage.read('bbb').catch(GETERR), 'id,type,name').toEqual('404 NOT FOUND - _id:TT:test:bbb');
        expect2(await storage.read('#name/BBB').catch(GETERR), 'id,type,stereo,meta').toEqual(
            '404 NOT FOUND - _id:TT:test:#name/BBB',
        ); // lookup-data (no exists)

        //* listBase test - search is null
        try {
            await request(app).get('/test?page=1&limit=5');
        } catch (err) {
            expect2(err.message.includes('searchSimple')).toEqual(true);
        }

        //* asFuncName test - base function mapping
        expect2(controller.asFuncName('GET', 'test', '')).toEqual('getBase'); // actually mapped to getBase
        expect2(controller.asFuncName('GET', 'base', '')).toEqual('getBase');
    });

    //* test listBase with search service
    it('should pass listBase() with search service', async () => {
        const { controller, app } = instance('dummy', undefined, true);
        expect2(() => controller.hello()).toEqual('general-api-controller:test');

        //* test listBase with default params
        expect2(await request(app).get('/test'), 'status,body').toEqual({
            status: 200,
            body: { total: 0, list: [], page: 0, limit: 12 },
        });

        //* test listBase with custom page & limit
        expect2(await request(app).get('/test?page=2&limit=20'), 'status,body').toEqual({
            status: 200,
            body: { total: 0, list: [], page: 2, limit: 20 },
        });

        //* test listBase with ipp (legacy parameter)
        expect2(await request(app).get('/test?page=1&ipp=10'), 'status,body').toEqual({
            status: 200,
            body: { total: 0, list: [], page: 1, limit: 10 },
        });
    });

    //* test edge cases
    it('should pass edge cases', async () => {
        const { controller, app, storage } = instance('dummy', 'name', true);

        //* test deleteBase with destroy and unique field
        //* first create an item
        const created = (await request(app).post('/test/edge1').send({ name: 'ToDelete' })).body;
        expect2(created, 'id,type,name').toEqual({ id: 'edge1', type: 'test', name: 'ToDelete' });

        //* verify lookup was created
        expect2(await storage.read('#name/ToDelete').catch(GETERR), 'id,stereo,meta').toEqual({
            id: '#name/ToDelete',
            stereo: '#',
            meta: 'edge1',
        });

        //* delete with destroy
        const deleteResult = await request(app).delete('/test/edge1?destroy');
        expect2(typeof deleteResult.body.deletedAt).toEqual('number');

        //* verify both item and lookup are deleted
        expect2(await storage.read('edge1').catch(GETERR)).toEqual('404 NOT FOUND - _id:TT:test:edge1');
        expect2(await storage.read('#name/ToDelete').catch(GETERR)).toEqual(
            '404 NOT FOUND - _id:TT:test:#name/ToDelete',
        );

        //* test listBase with null param
        const result1 = await controller.listBase('', null, null, null as any);
        expect2(result1, 'total,page,limit').toEqual({ total: 0, page: 0, limit: 12 });

        //* test deleteBase with null param
        await controller.postBase('nulltest', null, { name: 'NullTest' }, null);
        const result2 = await controller.deleteBase('nulltest', null, null, null);
        expect2(result2.deletedAt > 0).toEqual(true);

        //* test deleteBase with destroy on non-existent item
        //* this tests the `: ''` branch where $org is null
        await request(app).delete('/test/never-existed?destroy');

        //* test postBase with id='0' to trigger auto-id generation
        const post0Result = await request(app).post('/test/0').send({ name: 'AutoID' });
        expect2(post0Result.body.type).toEqual('test');
        expect2(typeof post0Result.body.id).toEqual('string');

        //* cleanup
        if (post0Result.body.id) await storage.delete(post0Result.body.id, true);

        //* test putBase with various id types
        await controller.postBase('testput2', null, { name: 'TestPut2' }, null);
        const putResult = await controller.putBase('testput2' as any, null, { extra: 'data' }, null);
        expect2(putResult, 'id').toEqual({ id: 'testput2' });

        //* test postBase with id parameter
        const postResult = await controller.postBase('testpost2' as any, null, { name: 'TestPost2' }, null);
        expect2(postResult, 'id').toEqual({ id: 'testpost2' });

        //* test with id that has whitespace
        await controller.postBase(' testid3 ', null, { name: 'TrimTest' }, null);
        const trimResult = await controller.putBase(' testid3 ' as any, null, { data: 'trimmed' }, null);
        expect2(trimResult, 'id').toEqual({ id: 'testid3' });

        //* test with falsy id
        expect2(await controller.putBase(null as any, null, {}, null).catch(GETERR)).toEqual(
            '@id (string) is required!',
        );
        expect2(await controller.postBase(undefined as any, null, {}, null).catch(GETERR)).toEqual(
            '@id (string) is required!',
        );

        //* cleanup
        await storage.delete('testput2', true);
        await storage.delete('testpost2', true);
        await storage.delete('testid3', true);
        await storage.delete('#name/TestPut2', true);
        await storage.delete('#name/TestPost2', true);
        await storage.delete('#name/TrimTest', true);
    });
});
