/**
 * `lambda-alb-handler.ts`
 * - lambda handler to process ALB event.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-05-14 initial version via backbone
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $U, _log, _inf, _err } from '../../engine/';
import { NextContext, NextHandler, NextIdentity } from 'lemon-model';
import { LambdaHandler, ALBHandler, LambdaSubHandler, ALBEvent, ALBResult, Context } from './lambda-handler';
import { buildResponse, HttpHeaderSet, HttpHeaderTool, MyHttpHeaderTool } from './lambda-web-handler';
import * as $lambda from 'aws-lambda';
const NS = $U.NS('HCRN', 'yellow'); // NAMESPACE TO BE PRINTED.

/**
 * ALB Next Handler
 */
export type ALBNextHandler = NextHandler<LambdaALBHandler, ALBResult, ALBEvent>;
/**
 * ALB Original Request Context
 */
export type ALBEventRequestContext = $lambda.ALBEventRequestContext;

/**
 * ALB Http Header Tool
 */
export class ALBHttpHeaderTool implements HttpHeaderTool<ALBEventRequestContext> {
    protected tool: MyHttpHeaderTool;
    public constructor(headers: HttpHeaderSet, options?: { isClone?: boolean }) {
        this.tool = new MyHttpHeaderTool(headers, options);
    }
    public hello(): string {
        return this.tool.hello();
    }
    public getHeaders(name: string): string[] {
        return this.tool.getHeaders(name);
    }
    public getHeader(name: string): string {
        return this.tool.getHeader(name);
    }
    public parseIdentityHeader(name?: string): Promise<NextIdentity> {
        return this.tool.parseIdentityHeader(name);
    }
    public parseLanguageHeader(name?: string): string {
        return this.tool.parseLanguageHeader(name);
    }
    public parseCookiesHeader(name?: string): { [key: string]: string } {
        return this.tool.parseCookiesHeader(name);
    }
    public async prepareContext($org: NextContext, reqContext: ALBEventRequestContext): Promise<NextContext> {
        const errScope = `alb.prepareContext(${$org?.requestId ?? ''})`;
        if (typeof reqContext?.elb?.targetGroupArn !== 'string')
            throw new Error(`.targetGroupArn is invalid - ${errScope}`);
        return { ...$org };
    }
    public onlyDefined<T extends object>(obj: T): T {
        return this.tool.onlyDefined<T>(obj);
    }
}

/**
 * class: LambdaALBHandler
 * - default ALB Handler w/ event-listeners.
 */
export class LambdaALBHandler extends LambdaSubHandler<ALBHandler> {
    /**
     * default constructor w/ registering self.
     */
    public constructor(lambda: LambdaHandler, register?: boolean) {
        super(lambda, register ? 'alb' : undefined);
        // _log(NS, `LambdaALBHandler()..`);
    }

    /** say hello */
    public hello(): string {
        return `lambda-alb-handler`;
    }

    /** the main handler */
    protected handler: ALBNextHandler;

    /**
     * set handler of alb-event.
     * @param handler
     */
    public setHandler(handler: ALBNextHandler) {
        const prev = this.handler;
        this.handler = handler;
        return prev;
    }

    /**
     * build response for ALB.
     *
     * @param statusCode status code like 200, 404, etc.
     * @param body any body to be returned.
     * @param options (optional) options for content-type and origin.
     * @returns ALBResult
     */
    public buildResponse(
        statusCode: number,
        body: any,
        options?: { contentType?: string; origin?: string; credentials?: boolean },
    ): ALBResult {
        const origin = options?.origin ?? null;
        const credentials = options?.credentials ?? null;
        return buildResponse(statusCode, body, { ...options, origin, credentials });
    }

    /**
     * Default ALB Handler.
     */
    public handle: ALBHandler = async (event, context): Promise<ALBResult> => {
        _log(NS, `handle()...`);
        if (!this.handler) return this.buildResponse(403, '403 NOT SUPPORTED - no handler for alb');
        const arn = event?.requestContext?.elb?.targetGroupArn;
        const $res = await this.handler(arn, this, event, context);
        return $res;
    };

    /**
     * builder of tools for http-headers
     * - extracting header content, and parse.
     */
    public tools = (event: ALBEvent): ALBHttpHeaderTool => new ALBHttpHeaderTool(event?.headers);

    /**
     * pack the request context for Http request.
     *
     * @param event origin Event.
     * @param orgContext (optional) original lambda.Context
     */
    public async packContext(event: ALBEvent, orgContext?: Context): Promise<NextContext> {
        _log(NS, `packContext(${event ? '' : 'null'})..`);
        if (!event) return null;
        //* prepare chain object.
        const reqContext = event?.requestContext;
        orgContext && _log(NS, `> orgContext =`, $U.S(orgContext, 256, 32));
        reqContext && _log(NS, `> reqContext =`, $U.S(reqContext, 256, 32));

        // STEP.1 extract the key headers.
        const $tool = this.tools(event);
        const identity = await $tool.parseIdentityHeader();
        const _prepare = (): NextContext => {
            const cookie = $tool.parseCookiesHeader();
            const domain = $tool.getHeader('host');
            const referer = $tool.getHeader('referer');
            const origin = $tool.getHeader('origin');
            const userAgent = $tool.getHeader('user-agent');
            const authorization = $tool.getHeader('authorization');
            return $tool.onlyDefined<NextContext>({
                identity,
                cookie,
                domain,
                referer,
                origin,
                userAgent,
                authorization,
            });
        };

        // STEP.3. prepare the final `next-context`.
        const $ctx = await $tool.prepareContext(_prepare(), reqContext);

        // FINIAL. returns
        return $ctx;
    }
}
