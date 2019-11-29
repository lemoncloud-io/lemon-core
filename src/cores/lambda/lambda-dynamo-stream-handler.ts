/**
 * `lambda-dynamo-stream-handler.ts`
 * - lambda handler to process Dynamo DB Stream event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $_, $U, do_parrallel, doReportError } from '../../engine/';
const NS = $U.NS('HDBS', 'green'); // NAMESPACE TO BE PRINTED.

import { DynamoDBRecord } from 'aws-lambda';
import { LambdaHandler, DynamoStreamHandler, LambdaSubHandler } from './lambda-handler';
import { NextHandler } from './../core-types';
import { toJavascript } from '../../lib/dynamodb-value';
import { Elastic6Service, Elastic6Item } from './../elastic6-service';
import { DynamoOption } from './../dynamo-service';

export interface DynamoStreamParam {
    region?: string;
    eventId?: string;
    eventName?: 'INSERT' | 'MODIFY' | 'REMOVE';
    tableName?: string;
}
export interface DynamoStreamBody<T = any> {
    keys?: T; // only for keys
    diff: T; // different set between old & new
    prev: T; // previous node set.
    node: T; // current node set.
}
export type DynamoStreamNextHandler<T = any> = NextHandler<DynamoStreamParam, void, DynamoStreamBody<T>>;

/**
 * class: LambdaDynamoStreamHandler
 * - default DynamoDBStream Handler w/ event-listeners.
 */
export class LambdaDynamoStreamHandler extends LambdaSubHandler<DynamoStreamHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'dynamo-stream' : undefined);
        _log(NS, `LambdaDynamoStreamHandler()..`);
    }

    protected listeners: DynamoStreamNextHandler[] = [];
    /**
     * add listener of cron-event.
     * @param handler
     */
    public addListener(handler: DynamoStreamNextHandler) {
        this.listeners.push(handler);
    }

    /**
     * Default Handler.
     */
    public handle: DynamoStreamHandler = async (event, context): Promise<void> => {
        //! for each records.
        const records: DynamoDBRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        _log(NS, '> event =', $U.json(event));

        //! serialize all record...
        await do_parrallel(
            records,
            async (record, i): Promise<void> => {
                const region = record.awsRegion;
                const eventId = record.eventID;
                const eventName = record.eventName;
                const tableName = (record.eventSourceARN && record.eventSourceARN.split('/')[1]) || '';
                _log(NS, `> record[${i}].eventName/tableName =`, eventName, tableName);

                try {
                    const dynamodb = record.dynamodb;
                    if (!dynamodb) return; // ignore this.
                    const $key = dynamodb.Keys ? toJavascript(dynamodb.Keys, null) : null;
                    const $new = dynamodb.NewImage ? toJavascript(dynamodb.NewImage, null) : null;
                    const $old = dynamodb.OldImage ? toJavascript(dynamodb.OldImage, null) : null;

                    //! 이제 변경된 데이터를 추적해서, 이후 처리 지원. (update 는 호출만되어도 이벤트가 발생하게 됨)
                    const diff = eventName === 'MODIFY' ? $U.diff($old, $new) : {};
                    const prev = $_.reduce(
                        diff,
                        (node: any, key: any) => {
                            node[key] = $old[key];
                            return node;
                        },
                        {},
                    );

                    //! prepare next-handler's param & body.
                    const param: DynamoStreamParam = { region, eventId, eventName, tableName };
                    const body: DynamoStreamBody = { keys: $key, diff, prev, node: $new };

                    //! call all listeners in parrallel.
                    const res = await Promise.all(this.listeners.map(fn => fn('!', param, body, context)));
                    _log(NS, `>> result[${i}] =`, $U.json(res));
                } catch (e) {
                    _log(NS, `>> error[${i}] =`, e);
                    //! report error.
                    if (LambdaDynamoStreamHandler.REPORT_ERROR) {
                        return doReportError(e, context, event).then(() => {});
                    }
                    throw e;
                }
            },
            1,
        );
    };

    /**
     * create synchronizer to elastic6 via dynamo-stream.
     *
     * @param options       options of dynamo table.
     * @param idName        name of id.
     */
    public static createSyncToElastic6<T extends Elastic6Item>(
        options: DynamoOption,
        service: Elastic6Service<T>,
        filter?: (id: string, item: T, diff?: T, prev?: T) => boolean,
    ): DynamoStreamNextHandler {
        // const _log = console.log;
        const handler: DynamoStreamNextHandler = async (id, param, body, $ctx) => {
            const { tableName, idName } = options;
            const { region, eventId, eventName, tableName: eventTable } = param;
            if (eventTable != tableName) {
                _log(NS, `WARN! table[${tableName}] is matched: table:${region}/${eventTable}`);
                return;
            }
            const { keys, diff, prev, node } = body;
            _log(NS, `! sync[${eventId}].event =`, eventName);
            keys && _log(NS, `> keys =`, $U.json(keys));
            diff && _log(NS, `> diff =`, $U.json(diff));
            prev && _log(NS, `> prev =`, $U.json(prev));
            node && _log(NS, `> node =`, $U.json(node));

            //! find id.
            const _id = node[idName] || keys[idName];
            if (_id === undefined) {
                _log(NS, `WARN! id[${idName}] is undefined`);
                return;
            }

            //! origin object, and apply filter.
            const item: T = node;
            const passed: boolean = !filter ? true : filter(_id, item, diff, prev);
            if (passed !== true && passed !== undefined) {
                _log(NS, `WARN! id[${idName}] is by-passed`);
                return;
            }

            //! update or save.
            if (eventName == 'REMOVE') {
                //! clear data.
                const res = await service.deleteItem(_id).catch(() => {}); // ignore error.
                _log(NS, `> deleted[${_id}] =`, $U.json(res));
            } else if (diff !== undefined) {
                //! try to update in advance, then save.
                const $upt = $_.reduce(
                    diff,
                    (M: any, key: string) => {
                        M[key] = node[key];
                        return M;
                    },
                    {},
                );
                _log(NS, `> updates[${_id}] =`, $U.json($upt));
                const res = await service.updateItem(_id, $upt).catch((e: Error) => {
                    // _log(NS, `>> err[${_id}] =`, e);
                    if (`${e.message}`.startsWith('404 NOT FOUND')) {
                        return service.saveItem(_id, item);
                    }
                    throw e;
                });
                _log(NS, `> updated[${_id}] =`, $U.json(res));
            } else {
                //! overwrite all.
                const res = await service.saveItem(_id, item);
                _log(NS, `> saved[${_id}] =`, $U.json(res));
            }
        };
        return handler;
    }
}
