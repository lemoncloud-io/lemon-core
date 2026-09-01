/**
 * `abstract-rest-apis.spec.ts`
 * - unit test spec of `abstract-rest-apis`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-09-21 optimized w/ `abstract-rest-apis`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
//! override environment with `env/<profile>.yml`
import { loadProfile } from '../../environ';
import { describe, it, expect2 } from './commons.spec';
import { GETERR } from '../../common/test-helper';
import { CoreModel, NextContext } from 'lemon-model';
import { $createApi, Reversable } from './abstract-rest-apis';

interface SiteModel extends CoreModel<string> {
    code?: string;
    name?: string;
}

interface SiteView extends Omit<SiteModel, 'linked'> {
    /** flag of linked state. */
    linked?: boolean;
}
type SiteBody = Partial<SiteView>;

/**
 * create dummy instance to test
 */
export const instance = (type: 'authed' | 'public' = 'authed', isDummy = true) => {
    const context: NextContext = {};
    const SITES_API = '//self/sites';
    //* transformer with remote view/body.
    const reversor = new (class implements Reversable<SiteModel, SiteView, SiteBody> {
        public asModel(view: SiteView): SiteModel {
            if (!view) return null as any;
            const { id, code, name, deletedAt } = view;
            return { id, code, name, deletedAt };
        }
        public asBody(model: SiteModel): SiteBody {
            const { id, code, name } = model;
            return { id, code, name };
        }
    })();
    //* it must be the standard rest-api.
    return $createApi<SiteView, SiteBody, SiteModel>(context, SITES_API, { reversor, isDummy });
};

//* main test body.
describe('abstract-rest-apis', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info('! PROFILE=', PROFILE);
    // //* test function
    // it('should pass basic function', async () => {
    //     const { trans } = instance();
    // });

    //* test dummy-rest-api
    it('should pass dummy-rest-api(authed)', async () => {
        const $api = instance('authed', true);

        expect2(() => $api?.hello()).toEqual(`dummy-rest-api://self/sites`);

        expect2(await $api.read('1').catch(GETERR)).toEqual('404 NOT FOUND - dummy-id:1');
        expect2(await $api.update('1', {}).catch(GETERR)).toEqual('404 NOT FOUND - dummy-id:1');
        expect2(await $api.delete('1', {}).catch(GETERR)).toEqual('404 NOT FOUND - dummy-id:1');

        expect2(await $api.insert({ name: 'hello' }).catch(GETERR)).toEqual({ name: 'hello', id: '80001' });
        expect2(await $api.insert({ name: 'world' }).catch(GETERR)).toEqual({ name: 'world', id: '80002' });

        expect2(await $api.read('80001').catch(GETERR)).toEqual({ id: '80001', name: 'hello' });
        expect2(await $api.read('80002').catch(GETERR)).toEqual({ id: '80002', name: 'world' });

        expect2(await $api.update('80001', { name: 'lemon' }).catch(GETERR)).toEqual({ id: '80001', name: 'lemon' });
        expect2(await $api.read('80001').catch(GETERR)).toEqual({ id: '80001', name: 'lemon' });

        expect2(await $api.delete('80001').catch(GETERR)).toEqual({ id: '80001', name: 'lemon' });
        expect2(await $api.read('80001').catch(GETERR)).toEqual('404 NOT FOUND - dummy-id:80001');
        expect2(await $api.update('80001', { name: 'hello' }).catch(GETERR)).toEqual('404 NOT FOUND - dummy-id:80001');

        //* end of test.
    });
});
