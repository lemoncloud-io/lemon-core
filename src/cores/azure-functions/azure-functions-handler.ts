/**
 * API: `/hello`
 * - public service api
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-08-23 initial version
 *
 * @copyright (C) 2023 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AzureFunction, Context, HttpRequest } from '@azure/functions';
import { ProtocolParam, CoreConfigService } from './../core-services';

export type ConfigService = CoreConfigService;

export interface MyHandler {
    (context: Context, req: HttpRequest): Promise<any>;
}

export interface HandlerMap {
    [key: string]: MyHandler;
}

export abstract class AzureFunctionsHandler {
    protected _map: HandlerMap = {};
    public config: ConfigService | undefined;

    public constructor(config?: ConfigService) {
        this.config = config;
    }

    public setHandler(type: string, handler: MyHandler) {
        this._map[type] = handler;
    }

    public async handle(context: Context, req: HttpRequest): Promise<any> {
        const type = req.headers['type']=="httpTrigger" ? 'web' : 'sns';
        const handler = this._map[type];
        if (handler && typeof handler === 'function') {
            return handler(context, req);
        } else {
            throw new Error(`Handler not found for type: ${type}`);
        }
    }

    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        // Implement handling protocol parameters if needed
        throw new Error('Protocol handling not implemented');
    }

    // Pack context if needed
    public async packContext(req: HttpRequest, context: Context): Promise<Context> {
        // Implement context packing logic if needed
        return context;
    }
}
