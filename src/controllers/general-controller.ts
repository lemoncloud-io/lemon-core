/**
 * general.controller.ts
 * - common pattern controller for `/{type}`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-16 initial version
 * @date        2020-01-06 support `GeneralWEBController` w/ `asNextIdentityAccess()`
 *
 * @copyright   (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { _log, _inf, _err } from '../engine/';
import { NextMode, NextContext, NextIdentityAccess, ProtocolService, ProtocolParam, NextHandler } from '../cores/';
import { CoreWEBController } from '../cores/lambda';
import $protocols from '../cores/protocol/';

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
     * - use pattern `<mode><type?><cmd?>`
     */
    public decode(mode: NextMode, id: string, cmd: string) {
        const funcName = this.asFuncName(mode, this.type(), cmd);
        const handler = (this as any)[funcName];
        const find1 = typeof handler == 'function' ? handler : null;
        if (!find1) {
            const funcName = this.asFuncNameByDo(mode, this.type(), cmd);
            const handler = (this as any)[funcName];
            const find2 = typeof handler == 'function' ? handler : null;
            return find2;
        }
        return find1;
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

    /**
     * translate to camel styled function name like `doGetHello()`
     *
     * ex: GET / -> doList
     * ex: GET /0/hi -> doGetHi
     * ex: POST /0/say-me -> doPostSayMe
     */
    public asFuncNameByDo(mode: string, type?: string, cmd?: string) {
        const upper1st = (s: string) => (s && s.length > 0 ? s[0].toUpperCase() + s.substring(1) : s);
        const camelCased = (s: string) => s.replace(/-([a-z])/g, g => g[1].toUpperCase());
        mode = `${mode || type || 'get'}`.toLowerCase();
        mode = camelCased(upper1st(`${mode || ''}`));
        cmd = camelCased(upper1st(`${cmd || ''}`.toLowerCase()));
        return `do${mode}${cmd}`.replace(/-/g, '_');
    }
}

/**
 * class: `GeneralWEBController`
 * - support additional helper functions for web-controller.
 */
export class GeneralWEBController extends GeneralController {
    /**
     * the base controller to bypass.
     */
    public readonly base: CoreWEBController;

    /**
     * default constructor()
     *
     * @param type  type of this controller.
     * @param base  the base controller to bypass.
     */
    public constructor(type: string, base?: CoreWEBController) {
        super(type);
        this.base = base;
    }

    /**
     * name of this resource.
     */
    public hello = () => `general-web-controller:${this.type()}${this.base ? '/' + this.base.hello() : ''}`;

    /**
     * decode func from self to base.
     */
    public decode(mode: NextMode, id: string, cmd: string) {
        //! find handler from self
        const ret = super.decode(mode, id, cmd);
        //! if not found, then find via base.
        if (!ret && this.base) {
            const handler = this.base.decode(mode, id, cmd);
            const builder = (thiz: any, func: NextHandler): NextHandler => (i, p, b, c) => func.call(thiz, i, p, b, c);
            return typeof handler == 'function' ? builder(this.base, handler) : null;
        }
        return ret;
    }

    /**
     * translate to `NextIdentityAccess` from origin NextContext
     *
     * @param context   the requested NextContext
     */
    public async asNextIdentityAccess(context: NextContext): Promise<NextIdentityAccess> {
        //! ignore if .identity is already populated.
        if (context && context.identity) {
            const $old: NextIdentityAccess = context.identity as NextIdentityAccess;
            if ($old.Site !== undefined) return $old;
        }

        //! call service via protocol
        // const proto: ProtocolService = $cores.protocol.service;
        const proto: ProtocolService = $protocols.service;
        //TODO - use env to configure `lemon-accounts-api` service @200106
        const param: ProtocolParam = proto.fromURL(context, 'api://lemon-accounts-api/oauth/0/pack-context', {}, {});
        const result = await proto.execute(param);
        const res: NextIdentityAccess = result as NextIdentityAccess;

        //! overwrite the origin context with this identity.
        if (context) context.identity = res;

        //! returns;
        return res;
    }
}
