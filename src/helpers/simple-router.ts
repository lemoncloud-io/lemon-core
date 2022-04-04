/**
 * `simple-router.ts`
 * - support simple routing class
 *
 *
 * @author      Albert <albert@lemoncloud.io>
 * @date        2022-03-31 initial version
 *
 * @copyright (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { do_parrallel } from '../engine';

/**
 * any function to run by router
 */
type RoutingFunc = (...args: any[]) => any;

/**
 * SimpleRouter constructor options
 */
interface SimpleRouterOptions {
    /**
     * allow multiple routing functions on one path(routing key)
     */
    allowMultipleRouter: boolean;
}

/**
 * Simple router class for simple routing by equally matched routing-path
 * @class
 */
export class SimpleRouter {
    /**
     * for saving router key(routing path) with value(routing function)
     */
    protected readonly routerMap: Map<string, RoutingFunc[]>;

    /**
     * if true, allow adding multiple routing functions on one path(routing key)
     */
    public allowMultipleRouter: boolean;

    /**
     * SimpleRouter class constructor
     * @param options - Ref SimpleRouterOptions
     */
    public constructor(options?: SimpleRouterOptions) {
        const defaultOptions: SimpleRouterOptions = {
            allowMultipleRouter: false,
        };
        const { allowMultipleRouter } = Object.assign({}, { ...defaultOptions }, { ...options });
        this.allowMultipleRouter = allowMultipleRouter;
        this.routerMap = new Map();
    }

    /**
     * return added routing functions in path
     * @param path - routing key
     * @returns - routing functions
     */
    public get(path: string) {
        const routingFuncs = this.routerMap.get(path);
        return Array.isArray(routingFuncs) ? routingFuncs : [];
    }

    /**
     * add routing function in path
     * @param path - routing path
     * @param routingFunc - routing function
     */
    public add(path: string, routingFunc: RoutingFunc) {
        const routingFuncs = this.get(path);

        if (this.allowMultipleRouter === false && routingFuncs.length > 0) {
            throw new Error(`Already set router function in path(${path})`);
        }
        routingFuncs.push(routingFunc);
        this.routerMap.set(path, routingFuncs);
    }

    /**
     * remove added routing function in path
     * @param path - routing path
     * @param routingFunc - routing function that you want to remove in path
     * @returns number of deleted functions
     */
    public remove(path: string, routingFunc: RoutingFunc) {
        const routingFuncs = this.get(path);
        const funcsExcludedRoutingFunc = routingFuncs.filter(f => f !== routingFunc);
        this.routerMap.set(path, funcsExcludedRoutingFunc);

        const removedFuncCount = routingFuncs.length - funcsExcludedRoutingFunc.length;
        return removedFuncCount;
    }

    /**
     * remove path (remove all routing function in path)
     * @param path - path for clear router
     */
    public clearPath(path: string) {
        this.routerMap.delete(path);
    }

    /**
     * run routing functions with parameter(params) in matched path
     * @param path - routing path
     * @param params - parameters to hand-off to routing functions
     * @returns - results of all routing functions in matched path
     */
    public async route(path: string, ...params: any[]) {
        const routingFuncs = this.get(path);
        return do_parrallel(routingFuncs, async (routingFunc, index) => routingFunc(...params), routingFuncs.length);
    }
}
