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
import { _log, _inf, _err, $_, $U, do_parrallel } from '../../engine/';
import { DynamoDBRecord } from 'aws-lambda';
import { LambdaHandler, DynamoStreamHandler, LambdaSubHandler, buildReportError } from './lambda-handler';
import { NextHandler } from '../core-types';
import { toJavascript } from '../../lib/dynamodb-value';
import { Elastic6Service, Elastic6Item } from '../elastic6-service';
import { DynamoOption } from '../dynamo-service';
const NS = $U.NS('HDBS', 'green'); // NAMESPACE TO BE PRINTED.

export type DynamoStreamEvent = DynamoDBRecord['eventName'];
export interface DynamoStreamParam {
    region?: string;
    eventId?: string;
    eventName?: DynamoStreamEvent;
    tableName?: string;
}
export interface DynamoStreamBody<T = any> {
    /**
     * only for keys
     */
    keys?: T;
    /**
     * fields to have different between old & new
     */
    diff: string[];
    /**
     * previous node with only in diff
     */
    prev: T;
    /**
     * the latest node set.
     */
    node: T;
}
export type DynamoStreamNextHandler<T = any> = NextHandler<DynamoStreamParam, void, DynamoStreamBody<T>>;

/**
 * types for stream synchronizer
 */
export interface DynamoStreamFilter<T = any> {
    (id: string, item: T, diff?: string[], prev?: T): boolean;
}
export interface DynamoStreamCallback<T = any> {
    (id: string, eventName: DynamoStreamEvent, item: T, diff?: string[], prev?: T): Promise<void>;
}

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
        super(lambda, register ? 'dds' : undefined);
        // _log(NS, `LambdaDynamoStreamHandler()..`);
    }

    protected listeners: DynamoStreamNextHandler[] = [];
    /**
     * add listener of cron-event.
     * @param handler
     */
    public addListener(handler: DynamoStreamNextHandler) {
        this.listeners.push(handler);
    }

    //! for debugging. save last result
    protected $lastResult: any = null;

    /**
     * Default Handler.
     */
    public handle: DynamoStreamHandler = async (event, context): Promise<void> => {
        //! for each records.
        const records: DynamoDBRecord[] = event.Records || [];
        _log(NS, `handle(len=${records.length})...`);
        // _log(NS, '> event =', $U.json(event));
        const $doReportError = buildReportError(LambdaDynamoStreamHandler.REPORT_ERROR);

        const onStreamRecord = async (record: DynamoDBRecord, i: number): Promise<string> => {
            const region = record.awsRegion;
            const eventId = record.eventID;
            const eventName = record.eventName;
            const tableName = (record.eventSourceARN && record.eventSourceARN.split('/')[1]) || '';
            _log(NS, `> record[${i}].eventName/tableName =`, eventName, tableName);

            const dynamodb = record.dynamodb;
            if (!dynamodb) return; // ignore this.
            const $key = dynamodb.Keys ? toJavascript(dynamodb.Keys, null) : null;
            const $new = dynamodb.NewImage ? toJavascript(dynamodb.NewImage, null) : null; // null if eventName == 'REMOVE'
            const $old = dynamodb.OldImage ? toJavascript(dynamodb.OldImage, null) : null; // null if eventName == 'INSERT'

            //! 이제 변경된 데이터를 추적해서, 이후 처리 지원. (update 는 호출만되어도 이벤트가 발생하게 됨)
            const diff = eventName === 'MODIFY' ? $U.diff($old, $new) : [];
            const node = $new || $old || {}; // make sure not null.
            const prev = $_.reduce(
                diff,
                (M: any, key: any) => {
                    M[key] = $old[key];
                    return M;
                },
                {},
            );

            //! prepare next-handler's param & body.
            const param: DynamoStreamParam = { region, eventId, eventName, tableName };
            const body: DynamoStreamBody = { keys: $key, diff, prev, node };

            //! call all listeners in parrallel.
            const asyncNext = (fn: DynamoStreamNextHandler, j: number) =>
                new Promise(resolve => {
                    resolve(fn('!', param, body, context));
                }).catch(e => $doReportError(e, null, null, { record, i, j }));
            const res = await Promise.all(this.listeners.map(asyncNext));
            _log(NS, `>> result[${i}] =`, $U.json(res));
            return `${i}`;
        };

        //! serialize all record...
        this.$lastResult = await do_parrallel(
            records,
            (record, i) => onStreamRecord(record, i).catch(e => $doReportError(e, null, null, { record, i })),
            1,
        );
    };

    /**
     * create synchronizer to elastic6 via dynamo-stream.
     *  - procedure: (filter) -> (onBeforeSync) -> synchronization -> (onAfterSync)
     *
     * @param options       options of dynamo table.
     * @param service       Elastic6Service instance
     * @param filter        filter function
     * @param onBeforeSync  callback function invoked before synchronization
     * @param onAfterSync   callback function invoked after synchronization
     */
    public static createSyncToElastic6<T extends Elastic6Item>(
        options: DynamoOption,
        service: Elastic6Service<T>,
        filter?: DynamoStreamFilter<T>,
        onBeforeSync?: DynamoStreamCallback<T>,
        onAfterSync?: DynamoStreamCallback<T>,
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
            // node && _log(NS, `> node =`, $U.json(node));

            //! find id.
            const _id = (node && node[idName]) || keys[idName];
            if (!_id) {
                node && _log(NS, `> node =`, $U.json(node));
                _log(NS, `WARN! node[${_id}] is missing! keys =`, $U.json(keys));
                return;
            }

            //! origin object, and apply filter.
            const item: T = 0 ? node : $U.cleanup(node || {}); //! remove internals like '_' '$'.
            const passed: boolean = !filter ? true : filter(_id, item, diff, prev);
            if (passed !== true && passed !== undefined) {
                _log(NS, `WARN! node[${_id}] is by-passed`);
                return;
            }

            //! call pre sync function
            if (onBeforeSync) await onBeforeSync(_id, eventName, item, diff, prev);

            //! update or save.
            if (false) {
            } else if (eventName == 'REMOVE') {
                //! clear data.
                const res = await service.deleteItem(_id); // ignore error.
                _log(NS, `> deleted[${_id}] =`, $U.json(res));
            } else if (diff && diff.length) {
                //! try to update in advance, then save.
                const $upt = $_.reduce(
                    diff,
                    (M: any, key: string) => {
                        M[key] = item[key];
                        return M;
                    },
                    {},
                );
                _log(NS, `> updates[${_id}] =`, $U.json($upt));
                const res = await service.updateItem(_id, $upt).catch((e: Error) => {
                    if (`${e.message}`.startsWith('404 NOT FOUND')) return service.saveItem(_id, item);
                    throw e;
                });
                _log(NS, `> updated[${_id}] =`, $U.json(res));
            } else {
                //! overwrite all.
                const res = await service.saveItem(_id, item);
                _log(NS, `> saved[${_id}] =`, $U.json(res));
            }

            //! call post sync function
            if (onAfterSync) await onAfterSync(_id, eventName, item, diff, prev);
        };
        return handler;
    }
}
