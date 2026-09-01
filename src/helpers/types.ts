/**
 * `types.ts`
 * - common types used in `/cores`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 * @date        2022-06-28 added `Codable` interface for general types.
 * @date        2023-01-18 optimized with `lemon-core@3.2.4`
 * @date        2023-02-15 optimized with `lemon-core@3.2.5`
 * @date        2024-11-14 optimized `IdentityToken`.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
//NOTE - must use `lemon-model` to publish w/o `lemon-core`.
import { NextIdentity, CoreModel, View, Body } from 'lemon-model';
export { CoreModel, View, Body };

/** type: `IdentityTokenSite` */
export interface IdentityTokenSite {
    /** site-code (ex: kwonsun) */
    code?: string;
    /** name of site (ex: 권선) */
    name?: string;
}

/** type: `IdentityTokenUser` */
export interface IdentityTokenUser {
    /** name of user (ex: 홍길동) */
    name?: string;
    /** nick of user (ex: 홍사마) */
    nick?: string;
    /** (optional) login-id of user */
    login?: string;
    /** (optional) email of user */
    email?: string;
}

/** type: `IdentityTokenGroup` */
export interface IdentityTokenGroup {
    /** site-code (ex: kwonsun) */
    code?: string;
    /** name of site (ex: 권선) */
    name?: string;
}

/**
 * type: `IdentityToken` (named as `session`)
 * - 계정토큰(= JWT(IdentityToken))으로, `/refresh`시 AWS Key와 함께 발급됨 (기본, 1일동안 유효함)
 * - `backend-api`에서 조직/그룹/사용자에 맞게 재설정됨!
 * - 세션토큰 검사는 `proxy.getCurrentSession()` 이용하기
 */
export interface IdentityToken<
    T = any,
    U extends IdentityTokenUser = IdentityTokenUser,
    S extends IdentityTokenSite = IdentityTokenSite,
    G extends IdentityTokenGroup = IdentityTokenGroup,
> extends NextIdentity<T> {
    /**
     * site-id (= id in `SiteModel(사이트)`)
     * - `#` 일경우, 특정 site에 엮이지 않음 (무시됨)
     * - `0000` 일경우, 기본 site 정보로 환경설정에 따름
     * - 메인 `backend-api` (see `.iss`)에서 관리되는 `site-model`의 id
     *
     * @see SiteModel
     */
    sid: string;
    /**
     * group-id (= id in `GroupModel(그룹)`)
     * - `group`은 `user`를 물리적 구분으로 나눠서 생각해볼때 이용가능함.
     *
     * @see GroupModel
     */
    gid: string;
    /**
     * user-id (= id in `UserModel(유저)`)
     * - 메인 `backend-api` (see `.iss`)에서 관리되는 `user-model`의 id.
     *
     * @see UserModel
     */
    uid: string;
    /**
     * auth-id (= id in `AuthModel(인정정보)`)
     * - 메인 `backend-api` (see `.iss`)에서 관리되는 `auth-model`의 id.
     * - 인증 정보를 통해서, 로그인의 추가 상세 정보를 알 수 있음.
     *
     * @see AuthModel
     */
    aid: string;

    /**
     * list of roles  (like `user`, `admin`, `super`)
     */
    roles: string[];

    /**
     * (optional) internal `identity-id` (= delegated identity)
     * - `.identityId` 는 aws cognito 인증을 통해서, 현재 인증된 `identity-id`를 알 수 있음
     * - 다만, `delegated`된 경우에는 위임된 id 가 들어감.
     *
     * @deprecated 삭제될 예정! @241114
     */
    iid?: string;

    /**
     * service-name of issuer
     * ex) `lemon-backend-api`
     */
    iss?: string;

    /** Site Info */
    Site: S;
    /** User Info */
    User: U;
    /** (optional) Group Info */
    Group?: G;
}

/**
 * type `ListResult`
 */
export interface ListResult<T, R = any> {
    /**
     * total searched count
     */
    total?: number;
    /**
     * max items count in the page
     */
    limit?: number;
    /**
     * current page number.
     */
    page?: number;
    /**
     * (optional) time took in sec
     */
    took?: number;
    /**
     * items searched
     */
    list: T[];

    /**
     * (optional) aggr list
     */
    aggr?: R[];
}

export interface AggrKeyCount {
    /** name of key(or bucket name) */
    key: string;
    /** number of count */
    val: number;
}

/**
 * type `PaginatedListResult`
 */
export interface PaginatedListResult<T, R = string> extends ListResult<T, R> {
    /**
     * current page
     */
    page: number;
}

/**
 * type `ListParam`
 */
export interface ListParam {
    /**
     * max items count to be fetched
     */
    limit?: number;
    /**
     * (optional) sorting order
     *  - 'asc': older first
     *  - 'desc': newer first
     *  - string: extended sorting features
     */
    sort?: 'asc' | 'desc' | string;
}

/**
 * type `PaginateParam`
 */
export interface PaginateParam extends ListParam {
    /**
     * page # to fetch (0-indexed)
     */
    page?: number;
    /**
     * (optional) offset # from start.
     */
    offset?: number;
    /**
     * (optional) flag to filter by uid
     */
    uid?: string;
    /**
     * (optional) flag to filter by sid (only for admin role)
     */
    sid?: string;
}

/**
 * type `BulkUpdateBody`
 */
export interface BulkUpdateBody<T> extends BulkBody<T> {
    /**
     * list bulk update model with id
     */
    list: T[];
}

/**
 * body data for bulk
 */
export interface BulkBody<T> {
    list: T[];
}

/**
 * list of the selected model-id
 */
export interface BodyList<T extends { id: string } = { id: string }> {
    list: T[];
}

/**
 * type `BulkItemsResult`
 */
export interface BulkItemsResult {
    success: number;
    failed: number;
    failedItems: any[];
}
