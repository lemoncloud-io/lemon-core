/**
 * `core/utilities.characterization.spec.ts`
 * - characterization tests for `$U`'s priority-5 members (dt, now, env/get_env, hash, qs).
 * - WP-U2 (lemon module hardening, track 1): every case here is lifted directly from the
 *   Behavior tables in `docs/specs/utilities/{dt,now,env,hash,qs}.md` (WP-U1). Expected
 *   values are copied from those tables verbatim — this suite fixes *current* behavior in
 *   writing, it does not judge whether that behavior is correct. See each spec file's
 *   "Known defects — preserved" section for behavior that looks wrong but is intentionally
 *   locked here rather than "fixed".
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-09-02 initial characterization suite (WP-U2).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi, test, afterEach } from 'vitest';
import { expect2 } from '../common/test-helper';
import { Utilities } from './utilities';

import * as $builder from './builder.spec';

export const instance = () => {
    const { $engine } = $builder.instance();
    const $U = new Utilities($engine);
    return { $engine, $U };
};

/**
 * dt.md's Format table and timeZone table were originally asserted as fixed `.toISOString()`
 * literals, derived by re-running under `TZ=Asia/Seoul` and `TZ=UTC` only — neither zone
 * observes DST, so that derivation never actually exercised the DST-mismatch path. Coordinator
 * follow-up (2026-09-02, U2): `utilities.ts:205` takes the offset from call time, not the
 * target date — this helper mirrors that so the table values hold on non-DST machines and the
 * ±1h DST behavior is preserved everywhere. `y`/`m` follow `Date` constructor convention (`m`
 * is 0-indexed). `timeZoneHours` defaults to `0` to match `$U.dt`'s own `timeZone ?? 0`.
 */
const expectedUtcForLocalString = (
    y: number,
    m: number,
    d: number,
    h: number,
    i: number,
    s: number,
    timeZoneHours = 0,
): number => {
    const todayOffset = new Date().getTimezoneOffset();
    const targetOffset = new Date(y, m, d, h, i, s).getTimezoneOffset();
    return Date.UTC(y, m, d, h, i, s) - (todayOffset - targetOffset) * 60 * 1000 - timeZoneHours * 3600 * 1000;
};

//! main test body.
describe(`core/utilities.ts (characterization, WP-U2)`, () => {
    //* ---------------------------------------------------------------------
    //* dt() / Utilities.datetime()  — docs/specs/utilities/dt.md
    //* ---------------------------------------------------------------------
    describe('dt()', () => {
        //* dt.md Format table rows 1-7 (all: timeZone omitted, i.e. `?? 0`).
        //* asserted against `expectedUtcForLocalString(...)` (machine-TZ-independent by
        //* construction — see the helper's doc comment) rather than a fixed `.toISOString()`
        //* literal, since the literal only holds on non-DST machines (coordinator follow-up,
        //* 2026-09-02).
        it.each([
            ['1978-12-01', 1978, 11, 1, 12, 0, 0],
            ['79-11-26', 1979, 10, 26, 12, 0, 0],
            ['19-11-26', 2019, 10, 26, 12, 0, 0],
            ['1978-12-01 12:34', 1978, 11, 1, 12, 34, 0],
            ['1978-12-01 12:34:20', 1978, 11, 1, 12, 34, 20],
            ['19781201', 1978, 11, 1, 12, 0, 0],
            ['19781201 1234', 1978, 11, 1, 12, 34, 0],
        ])('dt.md Format table row: dt(%j) -> UTC(%j-%j-%j %j:%j:%j) (utilities.ts:208-241)', (input, y, m, d, h, i, s) => {
            const { $U } = instance();
            expect($U.dt(input as string).getTime()).toEqual(
                expectedUtcForLocalString(y as number, m as number, d as number, h as number, i as number, s as number),
            );
        });

        //* dt.md Format table rows 8-9: no format matches -> null.
        it("dt.md Format table row: dt('') -> null (no format matches, utilities.ts:242-243)", () => {
            const { $U } = instance();
            expect($U.dt('')).toBeNull();
        });

        it("dt.md Format table row: dt('not-a-date') -> null (no format matches, utilities.ts:242-243)", () => {
            const { $U } = instance();
            expect($U.dt('not-a-date')).toBeNull();
        });

        //* dt.md "timeZone explicit vs. omitted" table (input '1978-12-01') — same
        //* machine-TZ-independence rationale as the Format table above.
        it.each([[undefined], [9], [0], [-5]])(
            "dt.md timeZone table row: dt('1978-12-01', %j) -> UTC(1978-12-01 12:00:00) shifted by timeZone (utilities.ts:206)",
            tz => {
                const { $U } = instance();
                expect($U.dt('1978-12-01', tz as number).getTime()).toEqual(
                    expectedUtcForLocalString(1978, 11, 1, 12, 0, 0, tz ?? 0),
                );
            },
        );

        it('dt.md timeZone table: timeZone 0 and timeZone omitted produce identical output — confirms `?? 0` is nullish coalescing, not falsy-coalescing (utilities.ts:206)', () => {
            const { $U } = instance();
            expect($U.dt('1978-12-01', 0).getTime()).toEqual($U.dt('1978-12-01').getTime());
        });

        //* Sanity connection back to dt.md's literal table values: on THIS run, if the target
        //* date's own offset happens to equal today's call-time offset (true for any non-DST
        //* machine, e.g. KST/UTC, and true year-round there), expectedUtcForLocalString(...)
        //* must produce exactly the literal `.toISOString()` values dt.md's tables document.
        //* On a DST machine where the two offsets differ for a given row, that row's literal
        //* comparison is skipped (logged) rather than asserted, since dt.md's literals were
        //* themselves only derived under non-DST zones (Asia/Seoul, UTC).
        it("dt.md Format/timeZone tables sanity: expectedUtcForLocalString(...) matches dt.md's literal .toISOString() values whenever todayOffset === targetOffset", () => {
            const rows: [string, number, number, number, number, number, number, number, string][] = [
                ['1978-12-01', 1978, 11, 1, 12, 0, 0, 0, '1978-12-01T12:00:00.000Z'],
                ['79-11-26', 1979, 10, 26, 12, 0, 0, 0, '1979-11-26T12:00:00.000Z'],
                ['19-11-26', 2019, 10, 26, 12, 0, 0, 0, '2019-11-26T12:00:00.000Z'],
                ['1978-12-01 12:34', 1978, 11, 1, 12, 34, 0, 0, '1978-12-01T12:34:00.000Z'],
                ['1978-12-01 12:34:20', 1978, 11, 1, 12, 34, 20, 0, '1978-12-01T12:34:20.000Z'],
                ['19781201', 1978, 11, 1, 12, 0, 0, 0, '1978-12-01T12:00:00.000Z'],
                ['19781201 1234', 1978, 11, 1, 12, 34, 0, 0, '1978-12-01T12:34:00.000Z'],
                ["'1978-12-01', timeZone=9", 1978, 11, 1, 12, 0, 0, 9, '1978-12-01T03:00:00.000Z'],
                ["'1978-12-01', timeZone=0", 1978, 11, 1, 12, 0, 0, 0, '1978-12-01T12:00:00.000Z'],
                ["'1978-12-01', timeZone=-5", 1978, 11, 1, 12, 0, 0, -5, '1978-12-01T17:00:00.000Z'],
            ];
            let asserted = 0;
            let skipped = 0;
            rows.forEach(([name, y, m, d, h, i, s, tz, literalIso]) => {
                const todayOffset = new Date().getTimezoneOffset();
                const targetOffset = new Date(y, m, d, h, i, s).getTimezoneOffset();
                if (todayOffset === targetOffset) {
                    const computed = new Date(expectedUtcForLocalString(y, m, d, h, i, s, tz)).toISOString();
                    expect(computed).toEqual(literalIso);
                    asserted++;
                } else {
                    // eslint-disable-next-line no-console
                    console.log(
                        `[dt.md sanity] skipped '${name}': todayOffset(${todayOffset}) !== targetOffset(${targetOffset}) on this run (DST machine) — literal not comparable here.`,
                    );
                    skipped++;
                }
            });
            // Every row must be accounted for (asserted xor skipped) regardless of which
            // machine/TZ this runs on. On a non-DST machine (KST/UTC) every row is asserted and
            // none skipped; on a DST machine mid-DST-season, some or all rows may be skipped —
            // that is expected, not a failure, since it is exactly the condition under which
            // dt.md's literal table values do not apply.
            expect(asserted + skipped).toEqual(rows.length);
        });

        //* dt.md number/Date input table (utilities.ts:257-260) — timeZone silently ignored
        //* (Known defect #2, preserved).
        it.each([[undefined], [9], [-5]])(
            'dt.md number/Date table row: dt(1700000000000, %j) ignores timeZone entirely -> 2023-11-14T22:13:20.000Z (Known defect #2, preserved)',
            tz => {
                const { $U } = instance();
                expect($U.dt(1700000000000, tz as number).toISOString()).toEqual('2023-11-14T22:13:20.000Z');
            },
        );

        it('dt.md number/Date table row: Date input returns the same object reference, not a copy (utilities.ts:259-260, Known defect #4, preserved)', () => {
            const { $U } = instance();
            const D = new Date(2020, 0, 1);
            expect($U.dt(D, 9)).toBe(D);
        });

        //* dt.md undefined/unsupported input table.
        it('dt.md undefined table row: dt(undefined) returns current instant, within 1s of Date.now() (utilities.ts:261-262)', () => {
            const { $U } = instance();
            const before = Date.now();
            const ret = $U.dt(undefined);
            const after = Date.now();
            expect(ret.getTime()).toBeGreaterThanOrEqual(before - 1000);
            expect(ret.getTime()).toBeLessThanOrEqual(after + 1000);
        });

        it("dt.md undefined table row: dt(true) throws 'Invalid type of dt: boolean' (utilities.ts:263-264)", () => {
            const { $U } = instance();
            expect(() => $U.dt(true as any)).toThrow('Invalid type of dt: boolean');
        });

        it("dt.md undefined table row: dt({}) throws 'Invalid type of dt: object' (utilities.ts:259,263-264)", () => {
            const { $U } = instance();
            expect(() => $U.dt({} as any)).toThrow('Invalid type of dt: object');
        });

        it('dt.md Signature: $engine.dt is the same static function reference as Utilities.datetime, a separate access path with identical behavior (builder.ts:246)', () => {
            const { $engine } = instance();
            expect($engine.dt).toBe(Utilities.datetime);
        });

        //* Coordinator U1 note / dt.md defect: `utilities.ts:205` reads the offset at CALL time
        //* (`new Date().getTimezoneOffset()`), not at the target date. On a DST-observing
        //* machine the target date's own offset can differ from "today"'s, shifting the result
        //* by up to 1h. This is DST-dependent offset source (utilities.ts:205), preserved — the
        //* expected value below is computed via the identical offset-difference formula the
        //* source itself uses, so it holds on this (KST, non-DST) machine and is designed to
        //* hold under DST too (cross-checked once under TZ=America/New_York, see U2 report).
        it('dt.md Known defect (coordinator U1 note): DST-dependent offset source (utilities.ts:205), preserved — expected computed via call-time-vs-target-date offset difference, not hardcoded', () => {
            const { $U } = instance();
            const y = 1978,
                m = 11, // December, 0-indexed month
                d = 1;
            const todayOffset = new Date().getTimezoneOffset();
            const targetDateOffset = new Date(y, m, d, 12).getTimezoneOffset();
            const expected = Date.UTC(y, m, d, 12) - (todayOffset - targetDateOffset) * 60 * 1000;
            expect($U.dt('1978-12-01').getTime()).toEqual(expected);
        });
    });

    //* ---------------------------------------------------------------------
    //* now()  — docs/specs/utilities/now.md
    //* ---------------------------------------------------------------------
    describe('now()', () => {
        it('now.md Behavior table row: now() returns the current instant, bracketed by Date.now() before/after the call (utilities.ts:277 -> :261-262)', () => {
            const { $U } = instance();
            const before = Date.now();
            const ret = $U.now();
            const after = Date.now();
            expect(ret.getTime()).toBeGreaterThanOrEqual(before);
            expect(ret.getTime()).toBeLessThanOrEqual(after);
        });

        it('now.md Behavior table row: now() returns a Date instance', () => {
            const { $U } = instance();
            expect($U.now() instanceof Date).toEqual(true);
        });

        //* now.md: "does not go through the string-format branch" — dt(undefined, 9) also
        //* ignores its timeZone argument, same underlying mechanism now() relies on
        //* (dt.md Known defect #3, preserved).
        it('now.md / dt.md Known defect #3, preserved: dt(undefined, 9) ignores timeZone — same as dt(undefined) — the mechanism now() relies on (utilities.ts:261-262)', () => {
            const { $U } = instance();
            const before = Date.now();
            const ret = $U.dt(undefined, 9);
            const after = Date.now();
            expect(ret.getTime()).toBeGreaterThanOrEqual(before);
            expect(ret.getTime()).toBeLessThanOrEqual(after);
        });
    });

    //* ---------------------------------------------------------------------
    //* env() / get_env()  — docs/specs/utilities/env.md
    //* Branch A only (`this._$.environ` present) — per U1's trace, this is the ONLY branch
    //* reachable through `instance()` (buildEngine() always populates `environ`,
    //* builder.ts:211) and the only branch any real `$U` consumer exercises. Branch B (raw
    //* `process.env` fallback, utilities.ts:83-85) is dead code in this codebase per env.md
    //* § "Which branch actually runs" and is intentionally NOT tested here — see U2 report.
    //* ---------------------------------------------------------------------
    describe('env() / get_env() — Branch A (this._$.environ present, the live path)', () => {
        const KEY = '__U2_SPEC_TEST_VAR__';

        afterEach(() => {
            delete process.env[KEY];
        });

        it("env.md Behavior table row: env('hi') unset, no default -> undefined (utilities.spec.ts:30 parity)", () => {
            const { $U } = instance();
            expect2($U.env('hi')).toEqual(undefined);
        });

        it("env.md Behavior table row: env('hi', '') unset -> '' (utilities.spec.ts:31 parity)", () => {
            const { $U } = instance();
            expect2($U.env('hi', '')).toEqual('');
        });

        it("env.md Behavior table row: env('hi', 'hoho') unset -> 'hoho' (utilities.spec.ts:32 parity)", () => {
            const { $U } = instance();
            expect2($U.env('hi', 'hoho')).toEqual('hoho');
        });

        it("env.md Behavior table row: get_env(KEY, 'fallback') with process.env[KEY]='' -> '' NOT 'fallback' (builder.ts:34, val === undefined only)", () => {
            process.env[KEY] = '';
            const { $U } = instance();
            expect($U.get_env(KEY, 'fallback')).toEqual('');
        });

        it("env.md Behavior table row: get_env(KEY, 'fallback') with process.env[KEY]='value1' -> 'value1'", () => {
            process.env[KEY] = 'value1';
            const { $U } = instance();
            expect($U.get_env(KEY, 'fallback')).toEqual('value1');
        });

        it("env.md Behavior table row: get_env(KEY) with process.env[KEY]='123' -> '123' (string, no numeric coercion, unlike qs_parse)", () => {
            process.env[KEY] = '123';
            const { $U } = instance();
            const ret = $U.get_env(KEY);
            expect(ret).toEqual('123');
            expect(typeof ret).toEqual('string');
        });

        it('env.md Behavior table row: env(KEY) and get_env(KEY) return an identical value (utilities.ts:89)', () => {
            process.env[KEY] = 'same-value';
            const { $U } = instance();
            expect($U.env(KEY)).toEqual($U.get_env(KEY));
        });
    });

    //* ---------------------------------------------------------------------
    //* hash()  — docs/specs/utilities/hash.md
    //* ---------------------------------------------------------------------
    describe('hash()', () => {
        it.each([
            ['', '811c9dc5'],
            ['a', 'e40c292c'],
            ['hello', '4f9f2cab'],
            ['123', '7238631b'],
        ])("hash.md Behavior table row: hash(%j) -> %j", (input, expected) => {
            const { $U } = instance();
            expect($U.hash(input)).toEqual(expected);
        });

        //* hash.md Known defect #1, preserved: undefined/null/'' all collapse to the same hash.
        it("hash.md Known defect #1, preserved: hash(undefined) === hash(null) === hash('') === '811c9dc5' (utilities.ts:631)", () => {
            const { $U } = instance();
            expect($U.hash(undefined)).toEqual('811c9dc5');
            expect($U.hash(null)).toEqual('811c9dc5');
            expect($U.hash('')).toEqual('811c9dc5');
        });

        //* hash.md Known defect #2, preserved: number and its string form collapse.
        it("hash.md Known defect #2, preserved: hash(123) === hash('123') === '7238631b' (utilities.ts:633)", () => {
            const { $U } = instance();
            expect($U.hash(123)).toEqual('7238631b');
            expect($U.hash('123')).toEqual('7238631b');
            expect($U.hash(123)).toEqual($U.hash('123'));
        });

        it("hash.md Behavior table row: hash(true) -> '4db211e5' (String(true) coercion, utilities.ts:633)", () => {
            const { $U } = instance();
            expect($U.hash(true)).toEqual('4db211e5');
        });

        it("hash.md Behavior table row: hash({a:1,b:2}) -> '5314055b' (sorted JSON, utilities.ts:632)", () => {
            const { $U } = instance();
            expect($U.hash({ a: 1, b: 2 })).toEqual('5314055b');
        });

        it('hash.md Behavior table row: hash({b:2,a:1}) — different top-level key insertion order -> identical hash (top-level sort, utilities.ts:632)', () => {
            const { $U } = instance();
            expect($U.hash({ b: 2, a: 1 })).toEqual('5314055b');
            expect($U.hash({ b: 2, a: 1 })).toEqual($U.hash({ a: 1, b: 2 }));
        });

        it("hash.md Behavior table row: hash([1,2,3]) -> '488c418a' (array of primitives, unaffected by key sort)", () => {
            const { $U } = instance();
            expect($U.hash([1, 2, 3])).toEqual('488c418a');
        });

        it('hash.md Determinism: hash(\'hello\') called twice in the same process returns the identical value', () => {
            const { $U } = instance();
            const first = $U.hash('hello');
            const second = $U.hash('hello');
            expect(first).toEqual(second);
            expect(first).toEqual('4f9f2cab');
        });

        //* hash.md Known defect #3, preserved: only top-level object keys are sorted; nested
        //* key order changes the hash — these two objects are semantically identical but hash
        //* DIFFERENTLY, and that difference is the current, locked-in behavior.
        it('hash.md Known defect #3, preserved: nested object key order is NOT normalized — hash({a:{x:1,y:2}}) !== hash({a:{y:2,x:1}}) (utilities.ts:632, this.json only sorts top-level)', () => {
            const { $U } = instance();
            const hashA = $U.hash({ a: { x: 1, y: 2 } });
            const hashB = $U.hash({ a: { y: 2, x: 1 } });
            expect(hashA).toEqual('95993e76');
            expect(hashB).toEqual('5d282a46');
            expect(hashA).not.toEqual(hashB);
        });
    });

    //* ---------------------------------------------------------------------
    //* qs_parse() / qs_stringify()  — docs/specs/utilities/qs.md
    //* ---------------------------------------------------------------------
    describe('qs_parse() — numeric-conversion boundary cases', () => {
        it.each([
            ["a=01", { a: '01' }],
            ["a=1e3", { a: '1e3' }],
            ["a=0x10", { a: '0x10' }],
            ["a=", { a: '' }],
            ["a=-0", { a: '-0' }],
            ["a=-1", { a: '-1' }],
            ["a=0", { a: '0' }],
            ["a=00", { a: '00' }],
            ["a=1.5", { a: '1.5' }],
            ["a", { a: '' }],
            ["a=null", { a: 'null' }],
            ["?a=1&b=x", { a: 1, b: 'x' }],
            ["a=%20", { a: ' ' }],
        ])(
            'qs.md Behavior table row: qs_parse(%j) -> %j (Known defect #2, preserved — numeric conversion inconsistent across representations)',
            (input, expected) => {
                const { $U } = instance();
                expect($U.qs_parse(input as string)).toEqual(expected);
            },
        );

        it("qs.md Behavior table row: qs_parse('a=10') -> {a: 10} (number — matches /^[1-9][0-9]*$/, utilities.ts:715-717)", () => {
            const { $U } = instance();
            const ret = $U.qs_parse('a=10');
            expect(ret).toEqual({ a: 10 });
            expect(typeof ret.a).toEqual('number');
        });

        it("qs.md Behavior table row: qs_parse('a&b=1') -> {a: '', b: 1} (mixed: null->'' rule + numeric conversion)", () => {
            const { $U } = instance();
            expect($U.qs_parse('a&b=1')).toEqual({ a: '', b: 1 });
        });

        //* qs.md Known defect #3, preserved: repeated keys bypass numeric conversion entirely
        //* because the regex .test() coerces the array to a comma-joined string first.
        it("qs.md Known defect #3, preserved: qs_parse('a=1&a=2') -> {a: ['1','2']} — repeated numeric-looking key stays strings (utilities.ts:715)", () => {
            const { $U } = instance();
            const ret = $U.qs_parse('a=1&a=2');
            expect(ret).toEqual({ a: ['1', '2'] });
        });
    });

    describe('qs_stringify()', () => {
        it("qs.md Behavior table row: qs_stringify({a:1,b:'x y',c:'z?=y',d:'p&q'}) -> 'a=1&b=x%20y&c=z%3F%3Dy&d=p%26q' (utilities.spec.ts:47-54 parity)", () => {
            const { $U } = instance();
            expect($U.qs_stringify({ a: 1, b: 'x y', c: 'z?=y', d: 'p&q' })).toEqual(
                'a=1&b=x%20y&c=z%3F%3Dy&d=p%26q',
            );
        });

        it("qs.md Behavior table row: qs_stringify({a: undefined}) -> '' — key with undefined value is dropped entirely", () => {
            const { $U } = instance();
            expect($U.qs_stringify({ a: undefined })).toEqual('');
        });

        it("qs.md Behavior table row: qs_stringify({a: null}) -> 'a' — key with null value is emitted bare", () => {
            const { $U } = instance();
            expect($U.qs_stringify({ a: null })).toEqual('a');
        });

        it("qs.md Behavior table row: qs_stringify({a: ''}) -> 'a=' — empty string emitted with trailing '='", () => {
            const { $U } = instance();
            expect($U.qs_stringify({ a: '' })).toEqual('a=');
        });

        it("qs.md Behavior table row: qs_stringify({a: [1,2,3]}) -> 'a=1&a=2&a=3' — array becomes repeated keys", () => {
            const { $U } = instance();
            expect($U.qs_stringify({ a: [1, 2, 3] })).toEqual('a=1&a=2&a=3');
        });

        it("qs.md Behavior table row: qs_stringify({}) -> ''", () => {
            const { $U } = instance();
            expect($U.qs_stringify({})).toEqual('');
        });
    });

    describe('qs round-trip and qs.* delegate identity', () => {
        it('qs.md Round-trip table: stringify -> parse is lossless for this exact object (utilities.spec.ts:47-56 parity)', () => {
            const { $U } = instance();
            const original = { a: 1, b: 'x y', c: 'z?=y', d: 'p&q' };
            const stringified = $U.qs_stringify(original);
            expect(stringified).toEqual('a=1&b=x%20y&c=z%3F%3Dy&d=p%26q');
            expect($U.qs_parse(stringified)).toEqual(original);
        });

        //* qs.md Known defect #1, preserved: round-trip is lossy for numeric-looking string
        //* values — a string '5' becomes the number 5 after stringify -> parse.
        it("qs.md Known defect #1, preserved: qs_stringify({a: '5'}) -> qs_parse gives {a: 5} (number, not the original string) — lossy round-trip for numeric-looking strings", () => {
            const { $U } = instance();
            const stringified = $U.qs_stringify({ a: '5' });
            expect(stringified).toEqual('a=5');
            const reparsed = $U.qs_parse(stringified);
            expect(reparsed).toEqual({ a: 5 });
            expect(typeof reparsed.a).toEqual('number');
        });

        it('qs.md Signature: $U.qs.parse / $U.qs.stringify are behaviorally identical delegates to qs_parse / qs_stringify (utilities.ts:738,741)', () => {
            const { $U } = instance();
            const obj = { a: 1, b: 'x y' };
            expect($U.qs.stringify(obj)).toEqual($U.qs_stringify(obj));
            const qstr = 'a=10&b=x';
            expect($U.qs.parse(qstr)).toEqual($U.qs_parse(qstr));
        });
    });
});
