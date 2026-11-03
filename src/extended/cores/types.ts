/**
 * `types.ts`
 * - common types used in `/cores`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2024-11-14 optimized `IdentityToken`.
 * @date        2026-10-28 v5 B3: re-export only — the single definition lives in `helpers/types.ts`.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
//* v5 B3: keeps the deep path `dist/extended/cores/types` and the L2 barrel names; one definition (`helpers/types.ts`).
export * from '../../helpers/types';
//* lemon-model symbols stay on this path as type-only re-exports (`isolatedModules`).
export type { CoreModel, View, Body } from 'lemon-model';
