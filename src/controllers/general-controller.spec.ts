/**
 * `general-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-16 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import request from 'supertest';
import { LambdaWEBHandler, LambdaHandler } from '../cores/lambda';
import { ProtocolParam, NextHandler } from '../cores';
import { buildEngine, $U } from '../engine';
import { buildExpress, loadJsonSync } from '../tools';
import { expect2 } from '../common/test-helper';
import { GeneralController, GeneralWEBController } from './general-controller';

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

class GeneralControllerLocal extends GeneralController {
    public constructor(type: string) {
        super(type);
    }
    public async getHelloWorld(id: string) {
        const type = this.type();
        return { hello: `world-${id}`, type };
    }
    public getHelloLemon: NextHandler = async (id: string) => {
        const type = this.type();
        return { hello: `lemon-${id}`, type };
    };
}

class GeneralControllerLocal2 extends GeneralControllerLocal {
    public constructor(type: string) {
        super(type);
    }
    public doGetLemonPie: NextHandler = async (id: string) => {
        const type = this.type();
        return { hello: `lemon-pie:${id}`, type };
    };
}

//! create instance.
export const instance = (type: string, useProxy: boolean = false) => {
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    const controller = new GeneralControllerLocal(type);
    const controller2 = new GeneralControllerLocal2(type + '2');
    const controller3 = new GeneralWEBController(type + '3', useProxy ? controller : null); // use proxy pattern.
    $web.addController(controller);
    $web.addController(controller2);
    $web.addController(controller3);
    //! build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, controller2, controller3, app: $express.app };
};

//! main test body.
describe('GeneralController', () => {
    //! general contoller api.
    it('should pass asFuncName()', async done => {
        const { controller, controller2, controller3 } = instance('hello');
        const { controller: controller0 } = instance(null);

        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller0.hello()).toEqual('general-controller:');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3');

        expect2(controller.asFuncName('LIST', 'Hello')).toEqual('listHello');
        expect2(controller.asFuncName('GET', null)).toEqual('get');
        expect2(controller.asFuncName('GET', '')).toEqual('get');
        expect2(controller.asFuncName('put', '')).toEqual('put');
        expect2(controller.asFuncName('GET', 'h')).toEqual('getH');
        expect2(controller.asFuncName('put', 'h')).toEqual('putH');
        expect2(controller.asFuncName('GET', 'hello')).toEqual('getHello');
        expect2(controller.asFuncName('put', 'hello')).toEqual('putHello');
        expect2(controller.asFuncName('GET', 'HELLO')).toEqual('getHELLO');

        expect2(controller.asFuncName('', 'hello')).toEqual('doHello');
        expect2(controller.asFuncName(null, 'hello')).toEqual('doHello');
        expect2(controller0.asFuncName('', 'hello')).toEqual('doHello');
        expect2(controller0.asFuncName(null, 'hello')).toEqual('doHello');

        expect2(controller.asFuncName('GET', 'hello', 'world')).toEqual('getHelloWorld');
        expect2(controller.asFuncName('POST', 'hello', 'world-class')).toEqual('postHelloWorldClass');
        expect2(controller.asFuncName('GET', 'hello', '-class')).toEqual('getHelloClass');
        expect2(controller.asFuncName('PUT', 'hello', '-')).toEqual('putHello_');
        expect2(controller.asFuncName('GET', 'hello', '-_--')).toEqual('getHello____');
        expect2(controller.asFuncName('GET', 'hello', '-Me')).toEqual('getHelloMe');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! general contoller api.
    it('should pass asFuncNameByDo()', async done => {
        const { controller, controller2, controller3 } = instance('hello');
        const { controller: controller0 } = instance(null);

        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller0.hello()).toEqual('general-controller:');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3');

        expect2(controller.asFuncNameByDo('LIST', 'Hello')).toEqual('doList');
        expect2(controller.asFuncNameByDo('GET', null)).toEqual('doGet');
        expect2(controller.asFuncNameByDo('GET', '')).toEqual('doGet');
        expect2(controller.asFuncNameByDo('put', '')).toEqual('doPut');
        expect2(controller.asFuncNameByDo('GET', 'h')).toEqual('doGet');
        expect2(controller.asFuncNameByDo('put', 'h')).toEqual('doPut');
        expect2(controller.asFuncNameByDo('GET', 'hello')).toEqual('doGet');
        expect2(controller.asFuncNameByDo('put', 'hello')).toEqual('doPut');
        expect2(controller.asFuncNameByDo('GET', 'HELLO')).toEqual('doGet');

        expect2(controller.asFuncNameByDo('', 'hello')).toEqual('doHello');
        expect2(controller.asFuncNameByDo(null, 'hello')).toEqual('doHello');
        expect2(controller0.asFuncNameByDo('', 'hello')).toEqual('doHello');
        expect2(controller0.asFuncNameByDo(null, 'hello')).toEqual('doHello');

        expect2(controller.asFuncNameByDo('GET', 'hello', 'world')).toEqual('doGetWorld');
        expect2(controller.asFuncNameByDo('POST', 'hello', 'world-class')).toEqual('doPostWorldClass');
        expect2(controller.asFuncNameByDo('GET', 'hello', '-class')).toEqual('doGetClass');
        expect2(controller.asFuncNameByDo('PUT', 'hello', '-')).toEqual('doPut_');
        expect2(controller.asFuncNameByDo('GET', 'hello', '-_--')).toEqual('doGet____');
        expect2(controller.asFuncNameByDo('GET', 'hello', '-Me')).toEqual('doGetMe');

        /* eslint-enable prettier/prettier */
        done();
    });

    //! general contoller api.
    it('should pass basic CRUD w/ general-controller', async done => {
        const { app, controller, controller2, controller3 } = instance('hello');
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3');

        //! check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //! each function mapping.
        expect2(await request(app).get('/hello/aa/world'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'world-aa' } });     // via `getHelloWorld()`
        expect2(await request(app).get('/hello/bb/lemon'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'lemon-bb' } });     // via `getHelloLemon()`
        expect2(await request(app).get('/hello/bb/world'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'world-bb' } });     // via `getHelloWorld()` @hello
        expect2(await request(app).get('/hello/bb/lemon-pie'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello/bb/lemon-pie' });

        expect2(await request(app).get('/hello2/aa'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello2/aa' });
        expect2(await request(app).get('/hello2/aa/some'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello2/aa/some' });
        expect2(await request(app).get('/hello2/bb/world'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello2/bb/world' });        // nor `getHelloWorld()` @hello
        expect2(await request(app).get('/hello2/bb/lemon-pie'), 'status,body').toEqual({ status:200, body:{ type:'hello2', hello:'lemon-pie:bb' } });   // via `doGetLemonPie()` @hello2

        expect2(await request(app).get('/hello3/aa/world'), 'status,text,body').toEqual({ status:404, body:{ }, text:'404 NOT FOUND - GET /hello3/aa/world' });
        expect2(await request(app).get('/hello3/bb/lemon'), 'status,text,body').toEqual({ status:404, body:{ }, text:'404 NOT FOUND - GET /hello3/bb/lemon' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! general contoller api.
    it('should pass basic CRUD w/ general-controller w/ proxy', async done => {
        const { app, controller, controller2, controller3 } = instance('hello', true);
        /* eslint-disable prettier/prettier */
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3/general-controller:hello');

        //! check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //! each function mapping.
        expect2(await request(app).get('/hello/aa/world'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'world-aa' } });     // via `getHelloWorld()`
        expect2(await request(app).get('/hello/bb/lemon'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'lemon-bb' } });     // via `getHelloLemon()`
        expect2(await request(app).get('/hello/bb/world'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'world-bb' } });     // via `getHelloWorld()` @hello
        expect2(await request(app).get('/hello/bb/lemon-pie'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello/bb/lemon-pie' });

        expect2(await request(app).get('/hello2/aa'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello2/aa' });
        expect2(await request(app).get('/hello2/aa/some'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello2/aa/some' });
        expect2(await request(app).get('/hello2/bb/world'), 'status,text').toEqual({ status:404, text:'404 NOT FOUND - GET /hello2/bb/world' });        // nor `getHelloWorld()` @hello
        expect2(await request(app).get('/hello2/bb/lemon-pie'), 'status,body').toEqual({ status:200, body:{ type:'hello2', hello:'lemon-pie:bb' } });   // via `doGetLemonPie()` @hello2

        expect2(await request(app).get('/hello3/aa/world'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'world-aa' } });     // via `getHelloWorld()` from .base
        expect2(await request(app).get('/hello3/bb/lemon'), 'status,body').toEqual({ status:200, body:{ type:'hello', hello:'lemon-bb' } });     // via `getHelloLemon()` from .base
        /* eslint-enable prettier/prettier */
        done();
    });

    //! general contoller api.
    it('should pass doNotifyServiceEvent()', async done => {
        const { controller3: $api } = instance('hello');
        const $pack = loadJsonSync('package.json');
        const endpoint = '#';

        expect2(() => $api.doNotifyServiceEvent({}, 'test', '_', null, undefined, endpoint)).toEqual(
            $U.json({
                endpoint,
                subject: 'event://lemon-core-local',
                message: {
                    type: 'test',
                    id: '_',
                    state: '',
                    service: `api://lemon-core-dev/test/_#${$pack.version}`,
                },
            }),
        );

        expect2(() => $api.doNotifyServiceEvent({}, 'TST!', '_', 'ok', { a: 1, b: 'c' }, endpoint)).toEqual(
            $U.json({
                endpoint,
                subject: 'event://lemon-core-local',
                message: {
                    type: 'TST!',
                    id: '_',
                    state: 'ok',
                    service: `api://lemon-core-dev/TST!/_#${$pack.version}`,
                    // service: `api://lemon-core-dev/TST!/_?a=1&b=c#${$pack.version}`,
                    param: { a: 1, b: 'c' },
                },
            }),
        );

        done();
    });
});
