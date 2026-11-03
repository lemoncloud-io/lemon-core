/**
 * `lambda-cron-handler.ts`
 * - lambda handler to process CRON event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err } from '../../engine/';
import { NextHandler } from 'lemon-model';
import { LambdaHandler, CronHandler, LambdaSubHandler, buildReportError } from './lambda-handler';
const NS = $U.NS('HCRN', 'yellow'); // NAMESPACE TO BE PRINTED.

export interface CronParam {
    name?: string;
    action?: string;
}
export type CronNextHandler = NextHandler<CronParam, void>;

/**
 * class: LambdaCronHandler
 * - default CRON Handler w/ event-listeners.
 */
export class LambdaCronHandler extends LambdaSubHandler<CronHandler> {
    //* shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'cron' : undefined);
        // _log(NS, `LambdaCronHandler()..`);
    }

    protected listeners: CronNextHandler[] = [];
    /**
     * add listener of cron-event.
     * @param handler
     */
    public addListener(handler: CronNextHandler) {
        this.listeners.push(handler);
    }

    /**
     * Default CRON Handler.
     * - v5 B5: each listener is caught and reported, then resolves `void` (no propagation to the top).
     */
    public handle: CronHandler = async (event, context): Promise<void> => {
        //* for each records.
        _log(NS, `handle()...`);
        _log(NS, '> event =', $U.json(event));
        const ID = '!';
        const cron: CronParam = event.cron;
        const $doReportError = buildReportError(LambdaCronHandler.REPORT_ERROR);
        //* v5: catch per listener (a sync throw too), report, and keep going.
        const asyncNext = (fn: CronNextHandler, j: number) =>
            new Promise(resolve => resolve(fn(ID, cron, null, context))).catch(e =>
                $doReportError(e, null, null, { cron, j }),
            );
        await Promise.all(this.listeners.map(asyncNext));
    };
}
