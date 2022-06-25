import 'reflect-metadata';
import { NextContext } from '../cores';

export const GUARDS_METADATA = '__guards__';
export interface CanActivate {
    /**
     * @param context Current execution context. Provides access to details about
     * the current request pipeline.
     *
     * @returns Value indicating whether or not the current request is allowed to
     * proceed.
     */
    canActivate(context: NextContext): boolean | Promise<boolean>;
}

export function extendArrayMetadata<T extends Array<unknown>>(key: string, metadata: T, target: Function) {
    const previousValue = Reflect.getMetadata(key, target) || [];
    const value = [...previousValue, ...metadata];
    Reflect.defineMetadata(key, value, target);
}
export const isUndefined = (obj: any): obj is undefined => typeof obj === 'undefined';

export const isObject = (fn: any): fn is object => !isNil(fn) && typeof fn === 'object';

export const isFunction = (val: any): boolean => typeof val === 'function';
export const isString = (val: any): val is string => typeof val === 'string';
export const isNumber = (val: any): val is number => typeof val === 'number';
export const isConstructor = (val: any): boolean => val === 'constructor';
export const isNil = (val: any): val is null | undefined => isUndefined(val) || val === null;
export const isEmpty = (array: any): boolean => !(array && array.length > 0);
export const isSymbol = (val: any): val is symbol => typeof val === 'symbol';

export function validateEach(
    context: { name: string },
    arr: any[],
    predicate: Function,
    decorator: string,
    item: string,
): boolean {
    if (!context || !context.name) {
        return true;
    }
    const errors = arr.some(str => !predicate(str));
    if (errors) {
        throw new InvalidDecoratorItemException(decorator, item, context.name);
    }
    return true;
}

export class InvalidDecoratorItemException extends Error {
    private readonly msg: string;
    constructor(decorator: string, item: string, context: string) {
        const message = `Invalid ${item} passed to ${decorator}() decorator (${context}).`;
        super(message);
        this.msg = message;
    }
    public what(): string {
        return this.msg;
    }
}

/**
 * Decorator that binds guards to the scope of the controller or method,
 * depending on its context.
 *
 * When `@UseGuards` is used at the controller level, the guard will be
 * applied to every handler (method) in the controller.
 *
 * When `@UseGuards` is used at the individual handler level, the guard
 * will apply only to that specific method.
 *
 * @param guards a single guard instance or class, or a list of guard instances
 * or classes.
 *
 * @see [Guards](https://docs.nestjs.com/guards)
 *
 * @usageNotes
 * Guards can also be set up globally for all controllers and routes
 * using `app.useGlobalGuards()`.  [See here for details](https://docs.nestjs.com/guards#binding-guards)
 *
 * @publicApi
 */
export function UseGuards(...guards: (CanActivate | Function)[]): MethodDecorator & ClassDecorator {
    return (target: any, key?: string | symbol, descriptor?: TypedPropertyDescriptor<any>) => {
        const isGuardValid = <T extends Function | Record<string, any>>(guard: T) =>
            guard && (isFunction(guard) || isFunction((guard as Record<string, any>).canActivate));

        if (descriptor) {
            validateEach(target.constructor, guards, isGuardValid, '@UseGuards', 'guard');
            extendArrayMetadata(GUARDS_METADATA, guards, descriptor.value);
            return descriptor;
        }
        validateEach(target, guards, isGuardValid, '@UseGuards', 'guard');
        extendArrayMetadata(GUARDS_METADATA, guards, target);
        return target;
    };
}
