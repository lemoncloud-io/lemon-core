# Spec: `$U.hash`

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** utilities/hash

## Signature

```ts
public hash(data: any): string   // utilities.ts:630
```

## Algorithm — confirmed FNV-1a, 32-bit

U0 judged this "FNV-1a" as its own finding, flagged for re-confirmation. Confirmed from source:

```ts
let hval = seed === undefined ? 0x811c9dc5 : seed;              // utilities.ts:648
for (...) {
    hval ^= str.charCodeAt(i);                                   // utilities.ts:651 — XOR (the "1a" in FNV-1a: XOR before multiply)
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24); // utilities.ts:652
}
return ('0000000' + (hval >>> 0).toString(16)).substr(-8);       // utilities.ts:655
```

- **Offset basis**: `0x811c9dc5` = `2166136261` decimal (`utilities.ts:648`) — matches the
  canonical FNV-1a 32-bit offset basis exactly.
- **Prime, expressed as a shift identity**: the update line multiplies `hval` by
  `1 + 2 + 16 + 128 + 256 + 16777216 = 16777619` — i.e.
  `hval * (2^0 + 2^1 + 2^4 + 2^7 + 2^8 + 2^24)` = `hval * 16777619`, the canonical FNV 32-bit
  prime, expressed via shifts instead of a literal multiply (`utilities.ts:652`) — arithmetically
  confirmed (`inferred from source`, shift-to-multiply identity checked by hand, not by a
  separate script).
- **Order**: XOR-then-multiply per character — this is FNV-**1a** specifically (plain FNV-1
  multiplies then XORs). Confirmed by line order at `utilities.ts:651-652`.
- **Output**: `(hval >>> 0)` forces the (possibly negative, per JS 32-bit bitwise semantics)
  `hval` to an unsigned 32-bit value before hex conversion, then left-pads/truncates to exactly
  8 hex digits via `('0000000' + ...).substr(-8)` (`utilities.ts:655`).

## Behavior table — input normalization (`utilities.ts:630-633`, before hashing)

| `data` (as passed to `$U.hash`) | Normalized to (before `hashFnv32a`) | Result | Evidence |
| --- | --- | --- | --- |
| `''` (empty string) | `''` (falsy `→ data \|\| ''` no-op) | `'811c9dc5'` — the offset basis itself, since the hash loop never executes on 0 chars | `utilities.ts:631` — verified by execution 2026-09-02 |
| `undefined` | `''` (`data \|\| ''`) | `'811c9dc5'` (identical to empty string) | `utilities.ts:631` — verified by execution 2026-09-02 |
| `null` | `''` (`data \|\| ''`) | `'811c9dc5'` (identical to empty string and `undefined`) | `utilities.ts:631` — verified by execution 2026-09-02 |
| `'a'` | `'a'` | `'e40c292c'` | verified by execution 2026-09-02 |
| `'hello'` | `'hello'` | `'4f9f2cab'` | verified by execution 2026-09-02 |
| `123` (number) | `String(123)` = `'123'` (`typeof data !== 'string'` branch, `:633`) | `'7238631b'` | `utilities.ts:633` — verified by execution 2026-09-02 |
| `'123'` (string) | `'123'` | `'7238631b'` — **identical to `hash(123)`** | verified by execution 2026-09-02, confirms number/numeric-string collapse to the same hash |
| `true` (boolean) | `String(true)` = `'true'` | `'4db211e5'` | `utilities.ts:633` — verified by execution 2026-09-02 |
| `{a:1, b:2}` (object) | `this.json(data, true)` — **sorted top-level** JSON string, `'{"a":1,"b":2}'` | `'5314055b'` | `utilities.ts:632` — verified by execution 2026-09-02 |
| `{b:2, a:1}` (same object, different insertion order) | same sorted JSON as above | `'5314055b'` — **identical**, top-level key order does not affect hash | `utilities.ts:632` (`this.json(data, true)`, `:161-172`'s sort) — verified by execution 2026-09-02 |
| `[1,2,3]` (array) | `this.json([1,2,3], true)` = `'[1,2,3]'` (array-of-primitives unaffected by key sort) | `'488c418a'` | verified by execution 2026-09-02 |

## Determinism

`hash('hello')` called twice in the same process returned the identical value
(`'4f9f2cab'`) both times — verified by execution 2026-09-02. No hidden state (seed, counters)
affects repeated calls with the same input.

## Known defects — preserved

This spec fixes behavior; it does not propose changes.

1. **`hash(undefined) === hash(null) === hash('')`** (`utilities.ts:631`, all three collapse to
   the empty string before hashing, all three return the offset basis `'811c9dc5'` unchanged).
   A caller distinguishing "no data" from "empty data" by hash value cannot.
2. **`hash(123) === hash('123')`** (`utilities.ts:633`) — numeric input and its string
   representation are indistinguishable by hash. Same holds for any primitive that stringifies
   identically (e.g. `hash(true) === hash('true')`, not separately tested but follows the same
   code path).
3. **Object hashing only sorts top-level keys, not nested ones** — `this.json(data, true)`
   (`utilities.ts:632` → `:161-172`) sorts `Object.keys(o)` at the top level only
   (`utilities.ts:164-168`); it does not recurse. Confirmed by execution: `hash({a:{x:1,y:2}})`
   (`'95993e76'`) differs from `hash({a:{y:2,x:1}})` (`'5d282a46'`) — semantically identical
   objects at any nesting depth beyond the first hash differently depending on nested key
   insertion order. Newly confirmed for this spec; not mentioned in U0 (which only flagged the
   algorithm identity, not this normalization edge case).
4. **32-bit hash space** — no collision resistance guarantee (inherent to FNV-1a's design, not
   a bug, but worth stating: 8 hex digits = 2^32 possible values, well within reach of
   birthday-bound collisions for large input sets). Not independently tested (would require a
   collision-search script disproportionate to this spec's scope); recorded as
   `inferred from source` given the fixed 32-bit `hval` width.

## Environment dependencies

None — pure function of its single argument. No clock, no env vars, no filesystem, no `this._$`
access (does not reference `this` at all except calling `this.json`, itself pure).

## Not covered by existing spec

`utilities.spec.ts` has **no test at all** for `hash` (confirmed absent by full-file read;
U0 independently reached the same "uncovered" verdict in § 2). Every row in the Behavior table
above is newly established for this spec.

## Evidence

All values verified via the **direct class import** method
(`import { Utilities } from '.../src/engine/utilities'`, minimal `{ log, err }` stub — `hash`
touches no `this._$` state) using `npx ts-node --transpile-only` against the unmodified source.
No source file was modified. All cells are **verified by execution 2026-09-02** except the
prime-as-shift-identity arithmetic and the collision-space note, both marked
`inferred from source` above since they were checked by hand rather than by a dedicated script.
