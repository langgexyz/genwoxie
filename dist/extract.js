// 话术提取:从孩子的一句话里取出要写的目标字 + 可用于消歧的语境词。
//
// 返回 { char, context }:
//   char    要写的单个汉字,取不到为 ""
//   context 语境词(「小城夏天的城」里的「小城夏天」),用于回声消歧 + 多音字读音;没有为 ""
//
// 匹配优先级(先具体后兜底):
//   1. 「语境词的X…写」     「小城夏天的城怎么写」
//   2. 「语境词的X」结尾    「妈妈的妈」(没说"写"也算)
//   3. 「写(一个)X」        「写一个大」「怎么写城」
//   4. 「X(字)(怎么)写」    「城怎么写」「飞机怎么写」(词取首字,整词当语境)
//   5. 兜底:第一个非功能词汉字
const FILLER_PREFIX = /^(?:就是|那个|这个|一个|请|帮我|我想|我要)+/u;
// 句子级命令前缀:「请写一下月亮的月」先剥掉「请写一下」再匹配,
// 只剥带量词/礼貌词的组合,不剥裸「写」(「写字的字」里「写字」是语境词本身)。
const COMMAND_PREFIX = /^(?:请|帮我|我想|我要|就是)*(?:写一下|写一个|写个|写下)?/u;
// 兜底扫描要跳过的功能字,避免「怎么写城」取到「怎」。
const FUNCTION_CHARS = new Set("怎么咋如何样写字就是那这个请帮我想要");
const P_POSSESSIVE_WRITE = /(\p{Script=Han}{1,6})的(\p{Script=Han})(?=[^，。！？,.!?]*写)/u;
const P_POSSESSIVE_END = /(\p{Script=Han}{1,6})的(\p{Script=Han})(?:字)?[^\p{Script=Han}]*$/u;
const P_WRITE_THEN_CHAR = /写(?:一个|一下|个|下)?([^\P{Script=Han}字])/u;
const P_WORD_THEN_WRITE = /([^\P{Script=Han}怎么咋如何样写字]{1,4})(?:字)?(?:怎么|咋|如何|怎样)?写/u;
function stripFiller(word) {
    return word.replace(FILLER_PREFIX, "");
}
export function extractTargetCharacter(text) {
    const clean = text.trim().replace(COMMAND_PREFIX, "");
    if (!clean)
        return { char: "", context: "" };
    let m = clean.match(P_POSSESSIVE_WRITE) ?? clean.match(P_POSSESSIVE_END);
    if (m)
        return { char: m[2], context: stripFiller(m[1]) };
    m = clean.match(P_WRITE_THEN_CHAR);
    if (m)
        return { char: m[1], context: "" };
    m = clean.match(P_WORD_THEN_WRITE);
    if (m) {
        const word = stripFiller(m[1]);
        if (word)
            return { char: word.charAt(0), context: word.length > 1 ? word : "" };
    }
    for (const c of clean) {
        if (/\p{Script=Han}/u.test(c) && !FUNCTION_CHARS.has(c))
            return { char: c, context: "" };
    }
    return { char: "", context: "" };
}
// 播报文本:有语境词读「城,小城的城」(顺带解决多音字),没有就只读字。
export function buildSpeechText(char, context) {
    if (!char)
        return "";
    if (context && context !== char)
        return `${char}，${context}的${char}`;
    return char;
}
