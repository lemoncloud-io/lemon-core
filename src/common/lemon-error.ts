/**
 * `common/lemon-error.ts`
 * - v5 B5: an error that carries the http `status` (S-33, SPEC § 6.6).
 * - the message keeps the wire contract `<status> <CODE> - <detail>` (peers still compare the prefix).
 * - NOTE: only `LemonError` is a root name. `asLemonError()` is internal (not re-exported by the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (v5 B5)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

/**
 * class: `LemonError`
 * - `new LemonError(403, 'NOT ALLOWED', 'no permission')` → message `403 NOT ALLOWED - no permission`.
 * - `mxNextFailure` reads `status` before the message prefix.
 */
export class LemonError extends Error {
    /** http status code (ex: 403) */
    public readonly status: number;
    /** upper-case code text (ex: `NOT ALLOWED`) */
    public readonly code: string;

    /**
     * default constructor
     * @param status    http status code
     * @param code      code text (the message prefix after the status)
     * @param detail    (optional) detail after ` - `
     */
    public constructor(status: number, code: string, detail?: string) {
        super(detail !== undefined && detail !== null ? `${status} ${code} - ${detail}` : `${status} ${code}`);
        this.name = 'LemonError';
        this.status = status;
        this.code = code;
    }
}

/**
 * internal: build a `LemonError` that keeps a given message as is (for errors relayed from a peer).
 * - `code` is read from the `NNN CODE` prefix when present, else `fallbackCode`.
 */
export const asLemonError = (status: number, message: string, fallbackCode: string = 'ERROR'): LemonError => {
    //* read `<status> <CODE>` from the message prefix, if any.
    const m = /^[1-9][0-9]{2} ([A-Z][A-Z _-]*?)(?: - |$)/.exec(`${message ?? ''}`);
    const e = new LemonError(status, m ? m[1] : fallbackCode);
    //* keep the message string exactly (wire contract), only the status becomes typed.
    e.message = `${message ?? ''}`;
    return e;
};
