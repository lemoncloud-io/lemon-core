/**
 * `hangul-service.spec.ts`
 * - unit test for `hangul-service`
 *
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-07-27 initial import
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '..';
import { HangulService } from './hangul-service';

// create service instance
export const instance = () => {
    return { service: new HangulService() };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('HangulService', () => {
    it('hello', async done => {
        const { service } = instance();
        expect2(await service.hello()).toEqual('hangul-service');
        done();
    });

    it('validity of public properties', async done => {
        // 기본 자모
        //  - 자음 14자 ('ㄱ','ㄴ','ㄷ',...,'ㅎ')
        //  - 모음 10자 ('ㅏ','ㅑ','ㅓ',...,'ㅣ')
        // 겹자모
        //  - 쌍자음: 5자 ('ㄲ','ㄸ','ㅃ','ㅆ','ㅉ')
        //  - 겹받침: 11자 ('ㄳ','ㄵ','ㄶ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅄ')
        //  - 겹모음: 11자 ('ㅐ','ㅒ','ㅔ','ㅖ','ㅘ','ㅙ','ㅚ','ㅝ','ㅞ','ㅟ','ㅢ')
        expect2(() => HangulService.CHOSEONG.length).toBe(14 + 5); // 기본 자음 + 쌍자음
        expect2(() => HangulService.JUNGSEONG.length).toBe(10 + 11); // 기본 모음 + 겹모음
        expect2(() => HangulService.JONGSEONG.length).toBe(14 + 11 + 2); // 기본 자음 + 겹받침 + 'ㄲ','ㅆ'

        const isCompatibilityJamo = (ch: string): boolean => HangulService.isHangulCompatibilityJamo(ch.charCodeAt(0));
        expect2(HangulService.CHOSEONG.every(isCompatibilityJamo)).toBe(true);
        expect2(HangulService.JUNGSEONG.every(isCompatibilityJamo)).toBe(true);
        expect2(HangulService.JONGSEONG.every(isCompatibilityJamo)).toBe(true);

        done();
    });

    it('static methods to identity Hangul characters', async done => {
        expect2(HangulService.isHangulJamo(''.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulJamo('A'.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulJamo('가'.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulJamo('ᄀ'.charCodeAt(0))).toBe(true); // U+1100
        expect2(HangulService.isHangulJamo('ㄱ'.charCodeAt(0))).toBe(false); // U+3130

        expect2(HangulService.isHangulCompatibilityJamo(''.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulCompatibilityJamo('A'.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulCompatibilityJamo('가'.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulCompatibilityJamo('ᄀ'.charCodeAt(0))).toBe(false); // U+1100
        expect2(HangulService.isHangulCompatibilityJamo('ㄱ'.charCodeAt(0))).toBe(true); // U+3130

        expect2(HangulService.isHangulSyllable(''.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulSyllable('A'.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulSyllable('가'.charCodeAt(0))).toBe(true);
        expect2(HangulService.isHangulSyllable('ㄱ'.charCodeAt(0))).toBe(false); // U+1100
        expect2(HangulService.isHangulSyllable('ᄀ'.charCodeAt(0))).toBe(false); // U+3130

        expect2(HangulService.isHangulChar(''.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulChar('A'.charCodeAt(0))).toBe(false);
        expect2(HangulService.isHangulChar('가'.charCodeAt(0))).toBe(true);
        expect2(HangulService.isHangulChar('ㄱ'.charCodeAt(0))).toBe(true); // U+1100
        expect2(HangulService.isHangulChar('ᄀ'.charCodeAt(0))).toBe(true); // U+3130

        done();
    });

    it('method to identity Hangul text', async done => {
        const { service } = instance();

        expect2(service.isHangul('', false)).toBe(false);
        expect2(service.isHangul('abc', false)).toBe(false);
        expect2(service.isHangul('123', false)).toBe(false);
        expect2(service.isHangul('$%^', false)).toBe(false);
        expect2(service.isHangul('가a나b다c', false)).toBe(false);
        expect2(service.isHangul('ㄱ', false)).toBe(true);
        expect2(service.isHangul('1q2w한글!', false)).toBe(false);
        expect2(service.isHangul('레몬클라우드', false)).toBe(true);

        expect2(service.isHangul('', true)).toBe(true);
        expect2(service.isHangul('abc', true)).toBe(false);
        expect2(service.isHangul('123', true)).toBe(false);
        expect2(service.isHangul('$%^', true)).toBe(false);
        expect2(service.isHangul('가a나b다c', true)).toBe(true);
        expect2(service.isHangul('ㄱ', true)).toBe(true);
        expect2(service.isHangul('1q2w한글!', true)).toBe(true);
        expect2(service.isHangul('레몬클라우드', true)).toBe(true);

        done();
    });

    it('methods to analyze Hangul text', async done => {
        const { service } = instance();

        expect2(service.asJamoSequence('')).toBe('');
        expect2(service.asJamoSequence('LemonCloud')).toBe('LemonCloud');
        expect2(service.asJamoSequence('레몬Cloud')).toBe('ㄹㅔㅁㅗㄴCloud');
        expect2(service.asJamoSequence('Lemon클라우드')).toBe('Lemonㅋㅡㄹㄹㅏㅇㅜㄷㅡ');
        expect2(service.asJamoSequence('레몬클라우드')).toBe('ㄹㅔㅁㅗㄴㅋㅡㄹㄹㅏㅇㅜㄷㅡ');
        expect2(service.asJamoSequence('픯')).toBe('ㅍㅢㅀ');
        expect2(service.asJamoSequence('똠얌꿍')).toBe('ㄸㅗㅁㅇㅑㅁㄲㅜㅇ');

        expect2(service.asBasicJamoSequence('')).toBe('');
        expect2(service.asBasicJamoSequence('LemonCloud')).toBe('LemonCloud');
        expect2(service.asBasicJamoSequence('레몬Cloud')).toBe('ㄹㅓㅣㅁㅗㄴCloud');
        expect2(service.asBasicJamoSequence('Lemon클라우드')).toBe('Lemonㅋㅡㄹㄹㅏㅇㅜㄷㅡ');
        expect2(service.asBasicJamoSequence('레몬클라우드')).toBe('ㄹㅓㅣㅁㅗㄴㅋㅡㄹㄹㅏㅇㅜㄷㅡ');
        expect2(service.asBasicJamoSequence('픯')).toBe('ㅍㅡㅣㄹㅎ');
        expect2(service.asBasicJamoSequence('똠얌꿍')).toBe('ㄷㄷㅗㅁㅇㅑㅁㄱㄱㅜㅇ');

        expect2(service.asAlphabetKeyStokes('')).toBe('');
        expect2(service.asAlphabetKeyStokes('LemonCloud')).toBe('LemonCloud');
        expect2(service.asAlphabetKeyStokes('레몬Cloud')).toBe('fpahsCloud');
        expect2(service.asAlphabetKeyStokes('Lemon클라우드')).toBe('Lemonzmffkdnem');
        expect2(service.asAlphabetKeyStokes('레몬클라우드')).toBe('fpahszmffkdnem');
        expect2(service.asAlphabetKeyStokes('픯')).toBe('vmlfg');
        expect2(service.asAlphabetKeyStokes('똠얌꿍')).toBe('EhadiaRnd');

        expect2(service.asChoseongSequence('')).toBe('');
        expect2(service.asChoseongSequence('LemonCloud')).toBe('');
        expect2(service.asChoseongSequence('레몬Cloud')).toBe('ㄹㅁ');
        expect2(service.asChoseongSequence('Lemon클라우드')).toBe('');
        expect2(service.asChoseongSequence('레몬클라우드')).toBe('ㄹㅁㅋㄹㅇㄷ');
        expect2(service.asChoseongSequence('픯')).toBe('ㅍ');
        expect2(service.asChoseongSequence('똠얌꿍')).toBe('ㄸㅇㄲ');

        done();
    });
});
