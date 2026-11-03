/**
 * `cores/index.tx`
 * - core services for serverless micro-service.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 * @date        2026-10-28 v5 B4: named lemon-model re-exports (the 32 v4 root names).
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//* export cores: v5 B4 (S-06) names the lemon-model re-exports - exactly the 32 names of the v4 root (lemon-model 1.1.1).
//* new lemon-model names (1.2 ~ 5.0, incl. `field`/`fieldsOf`/`specsOf`/`FIELDS_KEY`) are NOT on this root: import them from 'lemon-model'.
//* runtime values (`CoreModel` is a class since lemon-model 5.0.0, so value + type).
export { AbstractTransformer, CORE_FIELDS, CoreModel } from 'lemon-model';
//* types: storage models.
export type { CoreModifier, InternalKey, InternalModel, StorageModel } from 'lemon-model';
//* types: search and query.
export type {
    AutocompleteSearchParam,
    Elastic6SimpleQueriable,
    HighlightTerm,
    QueryResult,
    QueryTerm,
    SearchBody,
    SearchQuery,
    SimpleSearchParam,
    SortTerm,
} from 'lemon-model';
//* types: handler context and identity.
export type {
    NextContext,
    NextDecoder,
    NextHandler,
    NextIdentity,
    NextIdentityAccess,
    NextIdentityCognito,
    NextIdentityJwt,
    NextMode,
} from 'lemon-model';
//* types: common helpers and transformers.
export type { Body, Cores, GeneralItem, Incrementable, Reversable, SimpleSet, Transformable, View } from 'lemon-model';
export * from './core-services';

//* export by groups.
export * from './aws/';
export * from './config/';
export * from './lambda/';
export * from './protocol/';
export * from './storage/';
export * from './dynamo/';
export * from './elastic/';
export * from './cache/';
export * from './api/';

//* import `default` with named.
import aws from './aws/';
import config from './config/';
import lambda from './lambda/';
import protocol from './protocol/';

//* export default.
export default { aws, config, lambda, protocol };
