# v5 B7 — per-request `PERF` lines (`handle`, `request` + 4 steps)

Status: implemented 2026-10-28 on `feat/v5-b7-perf-trace` (base `v5` @ `02d5c7dd`). Builds on the D40 `PERF` lines (`docs/v5/B2-c-aws.md`, `HOW_TO_UPGRADE_V5.md` § 8.5).

## Why

A dev cold call showed `Init Duration` 518 ms and `Duration` 1037 ms, of which `initialize` was 999 ms, so the request itself took about 4 ms. The logs did not say which step of the request took that time. B7 adds one summary line per request with the time of each step, and one line per Lambda call.

## Scope

- **`PerfTrace`** in `src/lib/perf.ts` (not in the `lib` barrel, no engine import). `new PerfTrace()` starts at `nowMs()`. `mark(name)` keeps the ms since the previous mark (or the start) and moves the cursor. `elapsed()` is the ms since the start. `marks()` returns a copy. `line(extra)` builds the `key=value` tail.
- **`request` line** in `src/cores/lambda/lambda-web-handler.ts`: one line per `LambdaWEBHandler.handle()`, success and failure.
- **`handle` line** in `src/cores/lambda/index.ts`: one line per call of the `LambdaModule` wrapper `handle()` (includes `engine.initialize()`). The base `LambdaHandler.handle()` is unchanged.
- **No public name change.** `promised`, `mxNextHandler` and `mxNextFailure` keep their signatures; they call new module-private helpers (`nextHandlerOf`, `nextFailureOf`) with no trace. `npm run api:names` output is identical to the base (`npm run api:check` unchanged).

## Line contract

```
PERF: > request <total> ms mode=<MODE> type=<TYPE> [cmd=<CMD>] status=<http> context=<ms> param=<ms> handler=<ms> response=<ms> cold=<1|0>
PERF: > handle <ms> ms type=<HandlerType|unknown> cold=<1|0>
```

- The form is the D40 form: `log(ns, '>', label, '<ms> ms', tail)`. The namespace is `$U.NS('PERF', 'cyan')`. Every ms has one decimal.
- The key order is fixed as above. A key with an empty value is left out (`line()` drops `undefined`, `null` and `''`). `cmd` is printed only when the route has one. `mode` and `type` are left out when the request failed before the param was made (for example a bad context), and for the `/favicon.ico` shortcut.
- Values are route words (`mode`, `type`, `cmd`), the HTTP status and numbers. The line never has a path, an id, a host, a header or a body.
- Logger: `request` uses the file's `_inf`. `handle` uses the `inf` of the module's engine (`LambdaModule.engine`, the same engine that runs `initialize()`), like the `initialize` line in `engine/builder.ts`.

## Measurement points

| Line | Key | Starts | Ends |
| --- | --- | --- | --- |
| `request` | `<total>` | `packContext()` entry (or `handle()` entry if `packContext()` was not called for this event object) | after the response is built (on failure: after the error report, if any) |
| `request` | `context` | `packContext()` entry | `packContext()` return. `0.0` if `packContext()` was not called for this event object |
| `request` | `param` | end of `context` | `promised()` resolved (`transformToParam()`) |
| `request` | `handler` | end of `param` | `handleProtocol()` resolved, or the throw |
| `request` | `response` | end of `handler` | `success()` built the response, or `asFailureResult()` built the failure response |
| `handle` | `<ms>` | wrapper `handle()` entry | wrapper `handle()` return (success, `asFailure`, or the cognito rethrow) |

- `packContext()` and `handle()` are linked by the **event object**: `packContext()` puts a new `PerfTrace` in a module `WeakMap` keyed by the event, and `handle()` takes it out. Lambda (`LambdaHandler.handleEvent`) and the local express server (lemon-devkit, `req.$event`) both pass the same object to the two calls.
- The steps do not add up to `<total>` exactly: the gaps between steps (promise hops, debug logs) are not in any step, and on failure `<total>` also includes the error report (`doReportError`) when `REPORT_ERROR` is on.
- If `packContext()` throws (for example `400 SIGNATURE`), `handle()` is not called, so there is no `request` line. The `handle` line is still printed.
- On failure, a step that did not end is closed at the throw: if the throw came before the handler (in `promised()`), `param` gets the time to the throw and `handler` is near `0.0`.

## Cold

`cold=1` is printed only on the first line of its kind in the process: a module counter for `request` (all `LambdaWEBHandler` instances share it) and another one for `handle`. Every later line has `cold=0`. The first `handle` line of a Lambda cold start includes `initialize`.

## `LS=1`

`LS=1` (the `npm test` default) makes the engine console silent, so the lines are not printed, like every other line. `TS` and `LC` work as before. There is no new switch. The specs read the lines by spying on `$engine.$console.log` (the `request` line) and on an injected engine `inf` (the `handle` line), and use `vi.resetModules()` to get a fresh `cold` counter.

## Example (fake numbers)

Lambda, first call after a cold start, then a second call:

```
2026-10-28 10:00:00 I PERF: > request 3.9 ms mode=GET type=hello status=200 context=1.2 param=0.6 handler=1.4 response=0.3 cold=1
2026-10-28 10:00:00 I PERF: > handle 1003.1 ms type=web cold=1
2026-10-28 10:00:05 I PERF: > request 1.1 ms mode=POST type=hello cmd=hi status=200 context=0.3 param=0.2 handler=0.4 response=0.1 cold=0
2026-10-28 10:00:05 I PERF: > handle 1.3 ms type=web cold=0
```

A failure (`404`):

```
2026-10-28 10:00:09 I PERF: > request 0.9 ms mode=GET type=hello status=404 context=0.3 param=0.2 handler=0.2 response=0.1 cold=0
```

The local express server prints only the `request` line (it does not call the `LambdaModule` wrapper).

## Files

| File | Change |
| --- | --- |
| `src/lib/perf.ts` | `PerfTrace` class and `PerfValue` type |
| `src/lib/perf.spec.ts` | +2 tests (marks, `line()`) |
| `src/cores/lambda/lambda-web-handler.ts` | trace `WeakMap`, `startTrace`/`takeTrace`/`logRequest`; `nextHandlerOf`/`nextFailureOf` (private) behind `mxNextHandler`/`mxNextFailure`; marks in `packContext()` and `handle()` |
| `src/cores/lambda/index.ts` | `handle` line in the `LambdaModule` wrapper |
| `src/cores/lambda/lambda-web-handler.spec.ts` | +2 tests (`request` lines; wrapper `handle` lines). The file is imported by the SNS and SQS specs, so each test runs 3 times |
| `HOW_TO_UPGRADE_V5.md` | § 8.6 |
| `docs/v5/B7-perf-trace.md` (this file) | new |

## Gates (2026-10-28)

| Gate | Base `v5` @ `02d5c7dd` | B7 |
| --- | --- | --- |
| `npm test` (`LS=1`, 2 runs) | 54 files, 561 passed | 54 files, 569 passed (+2 `perf`, +2 web × 3 files), 0 failed |
| `npm run api:names` | 299 names | identical |
| `npm run api:check` | added=17 removed=22 not-allowed=0 | same |
| `npm run esm:smoke` | ok names=139 subpaths=4 | same |
| `@aws-sdk`/`@smithy` in `dist/**/*.d.ts` | 0 | 0 |
| `npx tsc --noEmit`, `npx eslint` (changed `.ts`) | — | 0 errors |
