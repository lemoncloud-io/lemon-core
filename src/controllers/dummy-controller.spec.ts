/**
 * `dummy-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-10 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR } from '../common/test-helper';
import { DynamoOption, DummyDynamoService, DynamoService } from '../cores';
import { LambdaWEBHandler, LambdaHandler, ProtocolParam } from '../cores';
import { DummyController } from './dummy-controller';
import { buildEngine } from '../engine/builder';
import { buildExpress } from '../tools/express';
import request from 'supertest';
import { loadJsonSync } from '../tools/shared';

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
export const instance = (type: string, idName: string = 'id') => {
    //! define dummy storage service.
    const tableName = `dummy-${type}`;
    const options: DynamoOption = { tableName, idName };
    const service: DynamoService<any> = new DummyDynamoService<any>(`dummy-${type}-data.yml`, options);
    const controller = new DummyController(type);
    //! build lambda handler.
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    $web.addController(controller);
    //! build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, service, $web, app: $express.app };
};

//! main test body.
describe('DummyController', () => {
    //! dummy storage service.
    it('should pass basic CRUD w/ dummy', async done => {
        //! see `dummy-controller-data.yml`
        const { service } = instance('controller');
        /* eslint-disable prettier/prettier */
        //! check dummy data.
        expect2(() => service.hello()).toEqual('dummy-dynamo-service:dummy-controller');
        expect2(await service.readItem('00').catch(GETERR)).toEqual('404 NOT FOUND - id:00');
        expect2(await service.readItem('A0').catch(GETERR)).toEqual({ id: 'A0', type: 'user', name: 'lemon' });

        //! basic simple CRUD test.
        expect2(await service.readItem('A0').catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await service.deleteItem('A0').catch(GETERR)).toEqual(null);
        expect2(await service.readItem('A0').catch(GETERR), 'id').toEqual('404 NOT FOUND - id:A0');
        expect2(await service.saveItem('A0', { type: '' }).catch(GETERR), 'id,type').toEqual({ id: 'A0', type: '' });
        expect2(await service.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: '' });
        expect2(await service.updateItem('A0', 0, { type: 'account' }).catch(GETERR), 'id').toEqual({ id: 'A0' });
        expect2(await service.readItem('A0').catch(GETERR), 'id,type').toEqual({ id: 'A0', type: 'account' });
        /* eslint-enable prettier/prettier */

        done();
    });

    //! dummy contoller api.
    it('should pass basic CRUD w/ dummy-controller', async done => {
        const { controller, app } = instance('controller');
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('dummy-controller:controller/controller');

        //! check basic express.app
        const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status,text').toEqual({ status: 200, text:`${$pack.name}/${$pack.version}` });

        //! test each CRUD of API
        expect2(await request(app).get('/controller?limit=1'), 'status,body').toEqual({ status:200, body:{ list:[{ id:'A0', type:'user', name:'lemon' }], page:1, limit:1, total:2 }});
        expect2(await request(app).get('/controller/A0'), 'status,body').toEqual({ status:200, body:{ id:'A0', type:'user', name:'lemon' } });

        expect2(await request(app).put('/controller/A0').send({ age: 1 }), 'status,body').toEqual({ status:200, body:{ id:'A0', age:1, type:'user', name:'lemon' } });
        expect2(await request(app).get('/controller/A0'), 'status,body').toEqual({ status:200, body:{ id:'A0', age:1, type:'user', name:'lemon' } });

        expect2(await request(app).post('/controller/A0').send({ name: '' }), 'status,body').toEqual({ status:200, body:{ id:'A0', name:'' } });
        expect2(await request(app).get('/controller/A0'), 'status,body').toEqual({ status:200, body:{ id:'A0', name:'' } });

        expect2(await request(app).delete('/controller/A0'), 'status,body').toEqual({ status:200, body:null });
        expect2(await request(app).get('/controller/A0'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - id:A0' });

        /* eslint-enable prettier/prettier */
        done();
    });
});
