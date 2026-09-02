# Spec: `$U.qs_parse` / `$U.qs_stringify`

**Status:** Characterization — current behavior, not a target
**Date:** 2026-09-02
**Slug:** utilities/qs

## Signature

```ts
public qs_parse(query: string)                          // utilities.ts:705-720
public qs_stringify(query: { [key: string]: any })       // utilities.ts:726-729
public readonly qs = { parse: ..., stringify: ... }      // utilities.ts:734-743, thin delegates
```

`$U.qs.parse === $U.qs_parse` and `$U.qs.stringify === $U.qs_stringify` in behavior — the `qs`
group (`utilities.ts:738`, `:741`) are one-line arrow delegates with no added logic.
`utilities.spec.ts:44-56`'s only qs-related test calls through `$U.qs.stringify`/`$U.qs.parse`,
not the underlying methods by name (see § Not covered).

Both wrap the `query-string` npm package (`QUERY_STRING`, imported `utilities.ts:16`) — parsing
and stringification syntax itself (bracket/encoding conventions) is that library's contract,
not `$U`'s; this spec covers only the **post-processing `$U` layers on top**.

## `qs_parse` — post-processing over `QUERY_STRING.parse` (`utilities.ts:705-720`)

```ts
public qs_parse(query: string) {
    const param: any = QUERY_STRING.parse(query);
    Object.keys(param).forEach(key => {
        if (param[key] === null) param[key] = '';                          // :711-713
        else if (/^[1-9][0-9]*$/.test(param[key])) param[key] = this.N(param[key]); // :714-717
    });
    return param;
}
```

Two post-processing rules run over whatever `query-string` already parsed:

1. **`null` → `''`** (`utilities.ts:711-713`) — `query-string` returns `null` for a key with no
   `=` and no value (bare flag, e.g. `?a`); this rewrites it to an empty string.
2. **Numeric-looking string → number** (`utilities.ts:714-717`), gated by the regex
   `/^[1-9][0-9]*$/` — **only** strings of one-or-more digits with a **non-zero leading digit**
   qualify; `this.N(...)` (`utilities.ts:339`) does the actual parse.

### Behavior table — numeric-conversion boundary cases

| Input query string | `query-string` raw parse | After `$U` post-processing | Type | Evidence |
| --- | --- | --- | --- | --- |
| `'a=01'` | `'01'` | `'01'` (unchanged — leading zero fails regex) | `string` | `utilities.ts:715` — verified by execution 2026-09-02 |
| `'a=1e3'` | `'1e3'` | `'1e3'` (unchanged — `e` fails `[0-9]*` regex) | `string` | verified by execution 2026-09-02 |
| `'a=0x10'` | `'0x10'` | `'0x10'` (unchanged — leading `0` and `x` both fail) | `string` | verified by execution 2026-09-02 |
| `'a='` (empty value) | `null` | `''` (via rule 1, `null → ''`) | `string` | `utilities.ts:712` — verified by execution 2026-09-02 |
| `'a=-0'` | `'-0'` | `'-0'` (unchanged — leading `-` fails regex) | `string` | verified by execution 2026-09-02 |
| `'a=-1'` | `'-1'` | `'-1'` (unchanged, same reason) | `string` | verified by execution 2026-09-02 |
| `'a=0'` | `'0'` | `'0'` (unchanged — `[1-9]` first char required, bare `'0'` fails) | `string` | verified by execution 2026-09-02 |
| `'a=00'` | `'00'` | `'00'` (unchanged) | `string` | verified by execution 2026-09-02 |
| `'a=10'` | `'10'` | `10` (converted — matches regex) | `number` | verified by execution 2026-09-02 |
| `'a=1.5'` | `'1.5'` | `'1.5'` (unchanged — `.` fails `[0-9]*` regex) | `string` | verified by execution 2026-09-02 |
| `'a'` (bare flag, no `=`) | `null` | `''` (via rule 1) | `string` | verified by execution 2026-09-02 |
| `'a&b=1'` | `{a: null, b: '1'}` | `{a: '', b: 1}` | mixed | verified by execution 2026-09-02 |
| `'a=null'` (literal string "null") | `'null'` (a string, not the JS value `null`) | `'null'` (unchanged — rule 1 only matches actual `null`, not the string) | `string` | verified by execution 2026-09-02 |
| `'a=1&a=2'` (repeated key) | `['1', '2']` (array from `query-string`) | `['1', '2']` — **unconverted**, regex `.test()` on an array coerces it to `'1,2'`, which fails the digit-only pattern | `array of string` | `utilities.ts:715` (regex applied to the whole array value) — verified by execution 2026-09-02 |
| `'?a=1&b=x'` (leading `?`) | handled transparently by `query-string` | `{a: 1, b: 'x'}` | mixed | verified by execution 2026-09-02 — leading `?` needs no special handling in `$U`'s layer; `query-string` itself strips it |
| `'a=%20'` (url-encoded space) | `' '` | `' '` (unchanged; not digit-only) | `string` | verified by execution 2026-09-02 |

## `qs_stringify` (`utilities.ts:726-729`)

```ts
public qs_stringify(query: { [key: string]: any }) {
    return QUERY_STRING.stringify(query);
}
```

No `$U`-side post-processing at all — a direct, one-line pass-through to
`QUERY_STRING.stringify`. All behavior here is `query-string`'s own contract.

| Input | Output | Evidence |
| --- | --- | --- |
| `{a:1, b:'x y', c:'z?=y', d:'p&q'}` | `'a=1&b=x%20y&c=z%3F%3Dy&d=p%26q'` | matches `utilities.spec.ts:47-54`'s existing assertion — verified by execution 2026-09-02 |
| `{a: undefined}` | `''` — key with `undefined` value is dropped entirely | verified by execution 2026-09-02 |
| `{a: null}` | `'a'` — key with `null` value is emitted bare (no `=`) | verified by execution 2026-09-02 |
| `{a: ''}` | `'a='` — empty string is emitted with a trailing `=` | verified by execution 2026-09-02 |
| `{a: [1,2,3]}` | `'a=1&a=2&a=3'` — array becomes repeated keys | verified by execution 2026-09-02 |
| `{}` | `''` | verified by execution 2026-09-02 |

## Round-trip (`qs_stringify` → `qs_parse`)

| Original | Stringified | Re-parsed | Round-trip preserved? |
| --- | --- | --- | --- |
| `{a:1, b:'x y', c:'z?=y', d:'p&q'}` | `'a=1&b=x%20y&c=z%3F%3Dy&d=p%26q'` | `{a:1, b:'x y', c:'z?=y', d:'p&q'}` | **Yes** for this exact object — verified by execution 2026-09-02 (matches `utilities.spec.ts:47-56`, the only existing round-trip-shaped test) |

Round-trip is **not** generally lossless, however — see Known defects below.

## Known defects — preserved

This spec fixes behavior; it does not propose changes.

1. **Round-trip is lossy for numeric-looking string values.** `qs_stringify({a: '5'})` produces
   `'a=5'`, and `qs_parse('a=5')` returns `{a: 5}` (a **number**, per the conversion rule) — a
   string value that happens to look like a non-zero-leading integer silently becomes a number
   after a stringify→parse round trip. This is a direct consequence of `qs_parse`'s numeric
   coercion having no way to know the original value's intended type — `inferred from source`
   combined with the already-verified `'a=10' → 10` row above (not independently re-run as a
   named round-trip case, but follows directly from it).
2. **Numeric conversion is inconsistent across representations of the same numeric value** —
   `'0'`, `'00'`, `'-0'`, `'1.5'`, `'1e3'`, `'0x10'` are all left as strings while `'10'` (and
   any other non-zero-leading plain integer) is converted to a `number`. A consumer that
   normalizes on `typeof` for numeric fields will treat `qty=0` and `qty=10` inconsistently.
3. **Array values bypass numeric conversion entirely** (`'a=1&a=2'` → `['1','2']`, both strings)
   — because the regex test coerces the array to a comma-joined string first, which never
   matches `/^[1-9][0-9]*$/`. A single numeric-looking value (`'a=5'` → `5`, a number) and a
   repeated numeric-looking value (`'a=5&a=6'` → `['5','6']`, strings) are typed
   inconsistently depending purely on whether the key repeats.
4. **The literal string `'null'` is not affected by rule 1** — only `query-string`'s actual
   `null` return (bare keys) triggers the `null → ''` rewrite; a value that is literally the
   text `null` (e.g. `?a=null`) passes through unchanged as the string `'null'`. Not a bug in
   isolation, but a source of confusion given the similarly-named rule.

## Environment dependencies

None — both methods are pure functions of their single argument plus the `query-string`
library's own (also-pure) parse/stringify. No clock, no env vars, no filesystem, no `this._$`.

## Not covered by existing spec

- `utilities.spec.ts:44-56`'s only qs test covers exactly one stringify/parse pair
  (`utilities.spec.ts:47-55`), calling through the `$U.qs.*` group rather than `qs_parse`/
  `qs_stringify` by name. It exercises: number, space, `?`/`=`, and `&` characters in values.
  It does **not** exercise: leading-zero strings, scientific notation, hex-looking strings,
  negative numbers, bare/empty values, repeated keys, a leading `?` on the query string itself,
  or the `null → ''` rewrite (all newly covered above).
- No existing test isolates `qs_parse`/`qs_stringify` from the `qs.parse`/`qs.stringify`
  delegates — U0 marked both as "partial" for exactly this reason (executed only via the `qs`
  group, never asserted by their own method names); this spec's execution confirms the
  delegates are behaviorally identical, so the distinction has no practical effect, but the
  method-name-specific call is still literally untested.

## Evidence

All values verified via the **direct class import** method
(`import { Utilities } from '.../src/engine/utilities'`, minimal `{ log, err }` stub — neither
method touches `this._$`) using `npx ts-node --transpile-only` against the unmodified source.
No source file was modified. All cells are **verified by execution 2026-09-02** except the
lossy-round-trip generalization (item 1 above), marked `inferred from source` since it
generalizes from an already-verified single-value case rather than being independently re-run
end-to-end.
