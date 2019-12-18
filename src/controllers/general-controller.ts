/**
 * general.controller.ts
 * - common pattern controller for `/{type}`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-16 initial version
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err, $U, $_ } from '../engine/';
import { NextMode } from '../cores/core-types';
import { CoreWEBController } from '../cores/lambda/lambda-web-handler';

/**
 * class: `GeneralController`.
 * - As WebController, routes by path `/hello/{id}/action` to method function like `getHelloAction`
 */
export class GeneralController implements CoreWEBController {
    /**
     * resource type of this Controller.
     */
    public readonly TYPE: string;

    /**
     * default constructor()
     */
    public constructor(type: string) {
        this.TYPE = `${type || ''}`;
    }

    /**
     * name of this resource.
     */
    public hello = () => `general-controller:${this.type()}`;

    /**
     * type of api-endpoint.
     */
    public type = () => `${this.TYPE}`;

    /**
     * decode to target `next-handler`
     * - use pattern `do_<mode>_<cmd?>`
     */
    public decode(mode: NextMode, id: string, cmd: string) {
        const funcName = this.asFuncName(mode, this.type(), cmd);
        const handler = (this as any)[funcName];
        return typeof handler == 'function' ? handler : null;
    }

    /**
     * translate to camel styled method name from mode + cmd
     * ex: GET /0/hi -> getHelloHi
     * ex: GET /0/say-me -> getHelloSayMe
     */
    public asFuncName(mode: string, type?: string, cmd?: string) {
        const upper1st = (s: string) => (s && s.length > 0 ? s[0].toUpperCase() + s.substring(1) : s);
        const camelCased = (s: string) => s.replace(/-([a-z])/g, g => g[1].toUpperCase());
        type = camelCased(upper1st(`${type || ''}`));
        mode = `${mode || 'do'}`.toLowerCase();
        cmd = camelCased(upper1st(`${cmd || ''}`.toLowerCase()));
        return `${mode}${type}${cmd}`.replace(/-/g, '_');
    }
}
