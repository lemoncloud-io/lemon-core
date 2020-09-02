/** ****************************************************************************************************************
 *  Service Core
 ** ****************************************************************************************************************/
/**
 * class `HangulService`
 */
export class HangulService {
    /* eslint-disable prettier/prettier */
    // Hangul Jamo
    //  1.Initial consonants (초성)
    public static readonly CHOSEONG = [
        'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
    ];
    //  2. Medial vowels (중성)
    public static readonly JUNGSEONG = [
        'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
    ];
    //  3. Final consonants (종성)
    public static readonly JONGSEONG = [
        'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
        'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
    ];

    // Hangul Composite Jamo(겹자모) -> Hangul Basic Jamo(기본 자모)
    protected static readonly JamoDecomposeMap: Map<string, string> = new Map([
        // 쌍자음
        ['ㄲ', 'ㄱㄱ'], ['ㄸ', 'ㄷㄷ'], ['ㅃ', 'ㅂㅂ'], ['ㅆ', 'ㅅㅅ'], ['ㅉ', 'ㅈㅈ'],
        // 겹받침
        ['ㄳ', 'ㄱㅅ'], ['ㄵ', 'ㄴㅈ'], ['ㄶ', 'ㄴㅎ'], ['ㄺ', 'ㄹㄱ'], ['ㄻ', 'ㄹㅁ'],
        ['ㄼ', 'ㄹㅂ'], ['ㄽ', 'ㄹㅅ'], ['ㄾ', 'ㄹㅌ'], ['ㄿ', 'ㄹㅍ'], ['ㅀ', 'ㄹㅎ'],
        ['ㅄ', 'ㅂㅅ'],
        // 겹모음
        ['ㅐ', 'ㅏㅣ'], ['ㅒ', 'ㅑㅣ'], ['ㅔ', 'ㅓㅣ'], ['ㅖ', 'ㅕㅣ'],
        ['ㅘ', 'ㅗㅏ'], ['ㅙ', 'ㅗㅏㅣ'], ['ㅚ', 'ㅗㅣ'], ['ㅝ', 'ㅜㅓ'], ['ㅞ', 'ㅜㅓㅣ'], ['ㅟ', 'ㅜㅣ'],
        ['ㅢ', 'ㅡㅣ'],
    ]);
    // Hangul Jamo -> Alphabet (in QWERTY 2벌식)
    protected static readonly QwertyMap: Map<string, string> = new Map([
        // 자음
        ['ㄱ', 'r'], ['ㄴ', 's'], ['ㄷ', 'e'], ['ㄹ', 'f'], ['ㅁ', 'a'], ['ㅂ', 'q'],
        ['ㅅ', 't'], ['ㅇ', 'd'], ['ㅈ', 'w'], ['ㅊ', 'c'], ['ㅋ', 'z'], ['ㅌ', 'x'],
        ['ㅍ', 'v'], ['ㅎ', 'g'],
        // 모음
        ['ㅏ', 'k'], ['ㅑ', 'i'], ['ㅓ', 'j'], ['ㅕ', 'u'], ['ㅗ', 'h'], ['ㅛ', 'y'],
        ['ㅜ', 'n'], ['ㅠ', 'b'], ['ㅡ', 'm'], ['ㅣ', 'l'],
        // 쌍자음
        ['ㄲ', 'R'], ['ㄸ', 'E'], ['ㅃ', 'Q'], ['ㅆ', 'T'], ['ㅉ', 'W'],
        // 겹받침
        ['ㄳ', 'rt'], ['ㄵ', 'sw'], ['ㄶ', 'sg'], ['ㄺ', 'fr'], ['ㄻ', 'fa'], ['ㄼ', 'fq'],
        ['ㄽ', 'ft'], ['ㄾ', 'fx'], ['ㄿ', 'fv'], ['ㅀ', 'fg'], ['ㅄ', 'qt'],
        // 겹모음
        ['ㅐ', 'o'],  ['ㅒ', 'O'],  ['ㅔ', 'p'],  ['ㅖ', 'P'],
        ['ㅘ', 'hk'], ['ㅙ', 'ho'], ['ㅚ', 'hl'], ['ㅝ', 'nj'], ['ㅞ', 'np'], ['ㅟ', 'nl'],
        ['ㅢ', 'ml'],
    ]);
    /* eslint-enable prettier/prettier */

    /**
     * say hello
     */
    public hello = () => `hangul-service`;

    /**
     * Identify whether given text is Hangul or not
     * @param text      input text
     * @param partial   (optional) if set true, result is true if there is at least one Korean letter in the text (default: false)
     */
    public isHangul(text: string, partial: boolean = false): boolean {
        if (!text) return partial; // in empty string, return true if partial is false otherwise true

        const isHangulChar = (ch: string) => HangulService.isHangulChar(ch.charCodeAt(0));
        const charArray = [...`${text || ''}`];
        return partial ? charArray.some(isHangulChar) : charArray.every(isHangulChar);
    }

    /**
     * Decompose text into Hangul (Compatibility) Jamo sequence
     *  - 초성, 중성, 종성으로 분해
     *  e.g. '한글' -> 'ㅎㅏㄴㄱㅡㄹ', '맴찟' -> 'ㅁㅐㅁㅉㅣㅅ'
     *
     * [Note]
     *  유니코드 한글 자모는 초/중/종성에 서로 다른 코드 영역이 할당되어 있다.
     *  따라서 동일한 자모라도 초성에 위치할 때와 종성에 위치할 때 코드값이 다르다.
     *  (예. 초성 'ㄱ': U+1100, 종성 'ㄱ': U+11A8)
     *  이를 Compatibility Jamo로서 같은 코드값을 사용하도록 변형한다.
     * [Reference]
     *  - https://en.wikipedia.org/wiki/Hangul_Jamo_(Unicode_block)
     *  - https://en.wikipedia.org/wiki/Hangul_Compatibility_Jamo
     *
     * @param text  input text
     */
    public asJamoSequence(text: string): string {
        return Array.from(text).reduce((str, ch) => {
            if (HangulService.isHangulSyllable(ch.charCodeAt(0))) {
                const decomposed = ch.normalize('NFD');
                let code: number;

                // Initial consonant (Choseong)
                code = decomposed.charCodeAt(0);
                str += HangulService.CHOSEONG[code - 0x1100];
                // Medial vowel (Jungseong)
                code = decomposed.charCodeAt(1);
                str += HangulService.JUNGSEONG[code - 0x1161];
                // Final consonant (Jongseong) - optional
                code = decomposed.charCodeAt(2);
                if (code) str += HangulService.JONGSEONG[code - 0x11a8];
            } else {
                str += ch;
            }

            return str;
        }, '');
    }

    /**
     * Decompose the text to Hangul Basic Jamo sequence (for Search-As-You-Type)
     *  - 다양한 종류의 입력 방식(e.g. 세벌식) 지원을 위해 최소 단위인 기본 자모(24자)로 분해함
     *  e.g. '한글' -> 'ㅎㅏㄴㄱㅡㄹ', '맴찟' -> 'ㅁㅏㅣㅁㅈㅈㅣㅅ'
     *
     * @param text  input text
     */
    public asBasicJamoSequence(text: string): string {
        return Array.from(this.asJamoSequence(text)).reduce((str, ch) => {
            str += HangulService.JamoDecomposeMap.get(ch) || ch;
            return str;
        }, '');
    }

    /**
     * Transform to Alphabet key stroke sequence (for QWERTY/Korean 2-bul)
     *  e.g. '한글' -> 'gksrmf'
     *
     * @param text  input text
     */
    public asAlphabetKeyStokes(text: string): string {
        return Array.from(this.asJamoSequence(text)).reduce((str, ch) => {
            str += HangulService.QwertyMap.get(ch) || ch;
            return str;
        }, '');
    }

    /**
     * 초성만을 추출 (Korean only)
     *  e.g. 한글 -> ㅎㄱ
     *
     * @param text  input text
     */
    public asChoseongSequence(text: string): string {
        let str = '';

        for (const ch of text) {
            const consonant = this.asJamoSequence(ch)[0];
            if (HangulService.CHOSEONG.includes(consonant)) str += consonant;
            else break; // terminate loop if no Choseong found
        }

        return str;
    }

    /**
     * Check the code is Hangul Unicode character
     *
     * @param code  character code
     */
    public static isHangulChar(code: number): boolean {
        // Do not allow Jamo Extended-A (A960-A97F) and Jamo Extended-B (D7B0-D7FF).
        return (
            HangulService.isHangulSyllable(code) ||
            HangulService.isHangulJamo(code) ||
            HangulService.isHangulCompatibilityJamo(code)
        );
    }

    /**
     * Check the code is Hangul syllable
     *
     * @param code  character code
     */
    public static isHangulSyllable(code: number): boolean {
        return code >= 0xac00 && code <= 0xd7a3;
    }

    /**
     * Check the code is Hangul Jamo
     *
     * @param code  character code
     */
    public static isHangulJamo(code: number): boolean {
        return code >= 0x1100 && code <= 0x11ff;
    }

    /**
     * Check the code is Hangul Compatibility Jamo
     *
     * @param code  character code
     */
    public static isHangulCompatibilityJamo(code: number): boolean {
        return code >= 0x3130 && code <= 0x318f;
    }
}

// Default export as instance
export default new HangulService();
