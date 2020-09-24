/**
 * `dummy-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-10 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import request from 'supertest';
import { LambdaWEBHandler, LambdaHandler, ProtocolParam } from '../cores';
import { buildEngine } from '../engine';
import { buildExpress, loadJsonSync } from '../tools';
import { expect2, GETERR } from '../common/test-helper';
import { DummyController } from './dummy-controller';

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

//! create instance.
export const instance = (type: string, name?: string, idName: string = 'id') => {
    //! define dummy controller.
    const controller = new DummyController(type, name, idName);
    //! build lambda handler.
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    $web.addController(controller);
    //! build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, $web, app: $express.app };
};

//! main test body.
describe('DummyController', () => {
    const type = 'dummy';
    const name = 'controller';

    //! dummy storage provided by dummy controller.
    it('should pass basic CRUD w/ dummy', async done => {
        //! see `dummy-controller-data.yml`
        const { controller } = instance(type, name);
        /* eslint-disable prettier/prettier */
        //! check dummy data.
        expect2(() => controller.hello()).toEqual(`dummy-controller:${type}/${name}`);
        expect2(await controller.do_list('', { limit: 0 }).catch(GETERR)).toEqual({ limit:0, list:[], page:1, total: 2 });

        expect2(await controller.do_get('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
        expect2(await controller.do_get('A0').catch(GETERR)).toEqual({ id: 'A0', type: 'user', name: 'lemon' });

        //! basic simple CRUD test.
        expect2(await controller.do_get('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await controller.do_delete('A0').catch(GETERR)).toEqual(null);
        expect2(await controller.do_get('A0').catch(GETERR), 'id').toEqual('404 NOT FOUND - id:A0');
        expect2(await controller.do_post('A0', null, { type: '' }).catch(GETERR), 'id,type').toEqual({ id: 'A0', type: null }); // empty string will be saved as null
        expect2(await controller.do_get('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: null });
        expect2(await controller.do_put('A0', null, { type: 'account' }).catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await controller.do_get('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: 'account' });
        /* eslint-enable prettier/prettier */

        done();
    });

    //! dummy contoller api.
    it('should pass basic CRUD w/ dummy-controller', async done => {
        const { controller, app } = instance(type, name);
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual(`dummy-controller:${type}/${name}`);

        //! check basic express.app
        const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //! test each CRUD of API
        expect2(await request(app).get(`/${type}?limit=0`), 'status,body').toEqual({ status:200, body:{ limit:0, list:[], page:1, total: 2 } });
        expect2(await request(app).get(`/${type}/A0`), 'status,body').toEqual({ status:200, body:{ id:'A0', type:'user', name:'lemon' } });

        expect2(await request(app).put(`/${type}/A0`).send({ age: 1 }), 'status,body').toEqual({ status:200, body:{ id:'A0', age:1, type:'user', name:'lemon' } });
        expect2(await request(app).get(`/${type}/A0`), 'status,body').toEqual({ status:200, body:{ id:'A0', age:1, type:'user', name:'lemon' } });

        expect2(await request(app).post(`/${type}/A0`).send({ name: '' }), 'status,body').toEqual({ status:200, body:{ id:'A0', name:null } }); // empty string will be saved as null
        expect2(await request(app).get(`/${type}/A0`), 'status,body').toEqual({ status:200, body:{ id:'A0', name:null } });

        expect2(await request(app).delete(`/${type}/A0`), 'status,body').toEqual({ status:200, body:null });
        expect2(await request(app).get(`/${type}/A0`), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - id:A0' });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! dummy contoller api.
    it('should pass asFuncName()', async done => {
        const { controller } = instance(type, name);
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual(`dummy-controller:${type}/${name}`);

        expect2(controller.asFuncName('GET', '')).toEqual('get');
        expect2(controller.asFuncName('put', '')).toEqual('put');
        expect2(controller.asFuncName('GET', 'h')).toEqual('getH');
        expect2(controller.asFuncName('put', 'h')).toEqual('putH');
        expect2(controller.asFuncName('GET', 'hello')).toEqual('getHello');
        expect2(controller.asFuncName('put', 'hello')).toEqual('putHello');
        expect2(controller.asFuncName('GET', 'HELLO')).toEqual('getHELLO');

        expect2(controller.asFuncName('GET', 'hello', 'world')).toEqual('getHelloWorld');
        expect2(controller.asFuncName('GET', 'hello', 'world-class')).toEqual('getHelloWorldClass');
        expect2(controller.asFuncName('GET', 'hello', '-class')).toEqual('getHelloClass');
        expect2(controller.asFuncName('GET', 'hello', '-')).toEqual('getHello_');
        expect2(controller.asFuncName('GET', 'hello', '-_--')).toEqual('getHello____');
        expect2(controller.asFuncName('GET', 'hello', '-Me')).toEqual('getHelloMe');

        /* eslint-enable prettier/prettier */
        done();
    });
});
