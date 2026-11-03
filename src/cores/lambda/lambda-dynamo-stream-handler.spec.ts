/**
 * `lambda-dynamo-stream-handler.spec.ts`
 * - unit test for `lambda-dynamo-stream-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 * @date        2026-10-27 v5 B2-b: `createSyncToOS2()` with an in-memory fake (no search spec import).
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import { expect2, GETERR } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaDynamoStreamHandler, DynamoStreamFilter, DynamoStreamCallback } from './lambda-dynamo-stream-handler';
import { DynamoOption } from './../dynamo/';
import * as $lambda from './lambda-handler.spec';
import { OS2CoreService } from '../elastic/';

/**
 * in-memory fake of `OS2CoreService` (read/save/update/delete only; no client is ever built).
 * - `updateItem` throws `404 NOT FOUND` for a missing id, so the synchronizer falls back to `saveItem`.
 */
class MemoryOS2Service extends OS2CoreService<any> {
    private buffer: { [id: string]: any } = {};
    // a local endpoint is required by the constructor but never contacted.
    public constructor() {
        super({ endpoint: 'http://127.0.0.1:9', indexName: 'test-memory', idName: '@id' });
    }
    // read from the buffer (404 if missing).
    public async readItem(id: string): Promise<any> {
        const item = this.buffer[id];
        if (item === undefined) throw new Error(`404 NOT FOUND - id:${id}`);
        return item;
    }
    // save into the buffer.
    public async saveItem(id: string, item: any): Promise<any> {
        this.buffer[id] = { id, ...item };
        return { [this.options.idName]: id, ...item, _version: 1 };
    }
    // update in the buffer (404 if missing).
    public async updateItem(id: string, item: any): Promise<any> {
        const org = await this.readItem(id);
        this.buffer[id] = { ...org, ...item };
        return { id, ...item };
    }
    // delete from the buffer.
    public async deleteItem(id: string): Promise<any> {
        const org = this.buffer[id];
        delete this.buffer[id];
        return { ...org };
    }
}

class LambdaDynamoStreamHandlerLocal extends LambdaDynamoStreamHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaDynamoStreamHandlerLocal(lambda);
    return { lambda, service };
};

//! main test body.
describe('LambdaDynamoStreamHandler', () => {
    //* basic handler test
    it('should pass handler listener', async () => {
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.dynamo-stream.json');
        let data: any;
        service.addListener(async (id, param, body, context) => {
            data = { id, param, body, context };
        });
        const res = await service.handle(event, null);
        expect2(res).toEqual({ batchItemFailures: [] }); //* v5 B5: partial batch response (was `undefined`).

        //* check handled data.
        expect2(data, 'id').toEqual({ id: '!' });
        expect2(data, 'param').toEqual({
            param: {
                eventId: 'e6c9208b46a3f10c87cd42555e2a0709',
                eventName: 'MODIFY',
                region: 'ap-northeast-2',
                tableName: 'MetricsTest',
            },
        });
        expect2(data.body, 'diff').toEqual({ diff: ['count', 'hello'] });
        expect2(data.body, 'prev').toEqual({ prev: { count: 4, hello: undefined } });
        expect2(data.body, 'keys').toEqual({ keys: { '@id': 'a_123_test', '@ts': 1574150700000 } });
        expect2(data.body, 'node').toEqual({
            node: { '@id': 'a_123_test', '@ts': 1574150700000, count: 6, hello: 'lemon' },
        });
    });

    //* v5 B5: 1 of 2 records fails → 1 `batchItemFailures` by `dynamodb.SequenceNumber`, and resolves.
    it('should pass batchItemFailures of a failed record (v5)', async () => {
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.dynamo-stream.json');
        const rec2 = JSON.parse(JSON.stringify(event.Records[0]));
        rec2.dynamodb.SequenceNumber = 'seq-2';
        event.Records.push(rec2);
        let calls = 0;
        //* fail only the 2nd record.
        service.addListener(async () => {
            calls++;
            if (calls === 2) throw new Error('boom-dds');
        });
        const res = await service.handle(event, null);
        expect2(res).toEqual({ batchItemFailures: [{ itemIdentifier: 'seq-2' }] });
        expect2(calls).toEqual(2);
    });

    //* test sync to OpenSearch (in-memory fake)
    it('should pass createSyncToOS2()', async () => {
        const { service } = instance();
        const os2 = new MemoryOS2Service();

        const tableName = 'MetricsTest';
        const idName = '@id';
        const id = 'A001';
        const options: DynamoOption = { tableName, idName };

        //* override id value.
        const event: any = loadJsonSync('data/samples/events/sample.event.dynamo-stream.json');
        event.Records[0].dynamodb.Keys[idName] = { S: id };
        event.Records[0].dynamodb.NewImage[idName] = { S: id };
        event.Records[0].dynamodb.OldImage[idName] = { S: id };

        //* to check handlers were called
        let handlersCalled = { filter: false, onBeforeSync: false, onAfterSync: false };

        //STEP 1. update event.
        //* attach handlers.
        const filter: DynamoStreamFilter = (id, item, diff, prev) => {
            expect2(handlersCalled).toEqual({ filter: false, onBeforeSync: false, onAfterSync: false });
            handlersCalled.filter = true;
            // check diff items
            for (const key of Object.keys(item)) if (diff.includes(key)) expect2(item[key]).not.toEqual(prev[key]);
            return true;
        };
        const onBeforeSync: DynamoStreamCallback = async (id, eventName, item, diff, prev) => {
            expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: false, onAfterSync: false });
            handlersCalled.onBeforeSync = true;
            // set extra field
            item['X'] = 'x';
        };
        const onAfterSync: DynamoStreamCallback = async (id, eventName, item, diff, prev) => {
            expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: true, onAfterSync: false });
            handlersCalled.onAfterSync = true;
            // check extra field set
            expect2(item['X']).toBe('x');
        };
        const handler = LambdaDynamoStreamHandler.createSyncToOS2(options, os2, filter, onBeforeSync, onAfterSync);
        service.addListener(handler);

        //* pre-condition.
        expect2(await os2.readItem(id).catch(GETERR)).toEqual(`404 NOT FOUND - id:${id}`);

        //* trigger event, handler
        const res = await service.handle(event, null);
        expect2(res).toEqual({ batchItemFailures: [] }); //* v5 B5: partial batch response (was `undefined`).

        //* check post-condition.
        expect2(await os2.readItem(id).catch(GETERR)).toEqual({
            [idName]: `${id}`,
            '@ts': 1574150700000,
            count: 6,
            hello: 'lemon',
            id: 'A001',
            X: 'x',
        });

        //* check all handlers were called
        expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: true, onAfterSync: true });

        //STEP 2. delete event.
        event.Records[0].eventName = 'REMOVE';
        handlersCalled = { filter: false, onBeforeSync: false, onAfterSync: false };
        const res2 = await service.handle(event, null);
        expect2(res2).toEqual({ batchItemFailures: [] }); //* v5 B5: partial batch response (was `undefined`).
        expect2(await os2.readItem(id).catch(GETERR)).toEqual(`404 NOT FOUND - id:${id}`); // must be deleted.
        expect2(handlersCalled).toEqual({ filter: true, onBeforeSync: true, onAfterSync: true });
    });
});
