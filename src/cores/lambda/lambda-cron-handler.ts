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
import { $engine, _log, _inf, _err, $U, $_ } from '../../engine/';
const NS = $U.NS('HCRN', 'yellow'); // NAMESPACE TO BE PRINTED.

import { NextHandler } from './../core-types';
import $lambda, { LambdaHandler, CronHandler, LambdaHandlerService } from './lambda-handler';

export interface CronParam {
    name?: string;
    action?: string;
}
export type CronNextHandler = NextHandler<CronParam, void>;

/**
 * class: LambdaCronHandler
 * - default CRON Handler w/ event-listeners.
 */
export class LambdaCronHandler implements LambdaHandlerService<CronHandler> {
    //! shared config.
    public static REPORT_ERROR: boolean = LambdaHandler.REPORT_ERROR;

    /**
     * default constructor w/ registering self.
     */
    protected constructor(lambda: LambdaHandler, register?: boolean) {
        _log(NS, `LambdaCronHandler()..`);
        if (register) {
            lambda.setHandler('cron', this);
        }
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
     */
    public handle: CronHandler = async (event, context): Promise<void> => {
        //! for each records.
        _log(NS, `handle()...`);
        _log(NS, '> event =', $U.json(event));
        const ID = '!';
        const cron: CronParam = event.cron;
        await Promise.all(this.listeners.map(_ => _(ID, cron, null, context)));
    };
}

/**
 * class: `LambdaCronHandlerMain`
 * - default implementations.
 */
class LambdaCronHandlerMain extends LambdaCronHandler {
    public constructor() {
        super($lambda, true);
    }
}

//! create instance & export as default.
const $instance: LambdaCronHandler = new LambdaCronHandlerMain();
export default $instance;
