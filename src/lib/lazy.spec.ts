/**
 * `lazy.spec.ts`
 * - unit test for `lazyInstance()` (v5 B2-b, S-25)
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import { lazyInstance } from './lazy';

// a sample class with an own arrow property, a getter, a field and a method.
class Sample {
    public readonly name: string;
    // own arrow property (like `OS2Instance.hello`).
    public hello = () => `Sample:${this.name}`;
    // set the name.
    public constructor(name: string) {
        this.name = name;
    }
    // prototype getter (like `.options`).
    public get options() {
        return { name: this.name };
    }
    // prototype method that reads `this` (called with the proxy as `this`).
    public upper() {
        return this.name.toUpperCase();
    }
}

describe('lazyInstance', () => {
    // the factory must not run until the first trap.
    it('should not call the factory before access', () => {
        let calls = 0;
        const $x = lazyInstance(() => {
            calls++;
            return new Sample('a');
        });
        const alias = $x; // passing the reference around is not an access.
        expect(alias === $x).toBe(true);
        expect(calls).toBe(0);
        expect($x.hello()).toBe('Sample:a');
        expect(calls).toBe(1);
    });

    // every later trap reuses the same instance.
    it('should call the factory only once', () => {
        let calls = 0;
        const $x = lazyInstance(() => {
            calls++;
            return new Sample('b');
        });
        expect($x.name).toBe('b');
        expect('hello' in $x).toBe(true);
        expect(Object.keys($x)).toEqual(['name', 'hello']);
        ($x as any).extra = 1;
        expect(($x as any).extra).toBe(1);
        expect(calls).toBe(1);
    });

    // own properties and getters are delegated; descriptors are configurable (Proxy invariant).
    it('should pass own property and getter', () => {
        const $x = lazyInstance(() => new Sample('c'));
        expect($x.hello()).toBe('Sample:c');
        expect($x.options).toEqual({ name: 'c' });
        expect($x.upper()).toBe('C');
        const desc = Object.getOwnPropertyDescriptor($x, 'hello');
        expect(typeof desc.value).toBe('function');
        expect(desc.configurable).toBe(true);
        expect({ ...$x }.name).toBe('c');
    });

    // `instanceof` works through the `getPrototypeOf` trap.
    it('should pass instanceof', () => {
        const $x = lazyInstance(() => new (class extends Sample {})('d'));
        expect($x instanceof Sample).toBe(true);
        expect(Object.getPrototypeOf(Object.getPrototypeOf($x))).toBe(Sample.prototype);
    });
});
