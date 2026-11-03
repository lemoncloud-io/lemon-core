/**
 * `lib/lazy.ts`
 * - (internal) lazy singleton as a `Proxy`: nothing is built until the first trap.
 * - not exported by the `lib` barrel.
 *
 * Why a Proxy (not a getter): the ESM wrapper reads every value export once at load
 * (`export const X = cjs.X`). A getter would build the instance at that moment;
 * reading a Proxy builds nothing.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 v5 B2-b (S-25)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */

/**
 * make a lazy instance: `factory()` runs once, on the first trap, and every trap is then delegated.
 * - traps: `get`, `has`, `ownKeys`, `getOwnPropertyDescriptor`, `getPrototypeOf`, `set`.
 * - `instanceof` works via `getPrototypeOf`.
 *
 * @param factory   builds the real instance (called at most once)
 */
export const lazyInstance = <T extends object>(factory: () => T): T => {
    let instance: T = null;
    // build once, then reuse.
    const real = (): T => {
        if (instance === null) instance = factory();
        return instance;
    };
    // the proxy target is an empty object; the real instance only lives in the closure.
    const target = {} as T;
    return new Proxy<T>(target, {
        // read a property (own field, getter or method) from the real instance.
        get: (_t, prop) => Reflect.get(real(), prop),
        // `prop in proxy`.
        has: (_t, prop) => Reflect.has(real(), prop),
        // `Object.keys(proxy)` and friends.
        ownKeys: () => Reflect.ownKeys(real()),
        // descriptors must be configurable: the empty target does not hold the property (Proxy invariant).
        getOwnPropertyDescriptor: (_t, prop) => {
            const desc = Reflect.getOwnPropertyDescriptor(real(), prop);
            return desc ? { ...desc, configurable: true } : undefined;
        },
        // the real prototype, so `proxy instanceof Class` is true.
        getPrototypeOf: () => Reflect.getPrototypeOf(real()),
        // write a property on the real instance.
        set: (_t, prop, value) => Reflect.set(real(), prop, value),
    });
};
