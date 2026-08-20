/**
 * 术语替换：把内部说法换成用户听得懂的说法。
 *
 * 生效边界（§5.4，很重要）：只在人读渲染层用——CLI 不带 --json 的输出、
 * 提案展示、提问展示。`--json` 与 HTTP 响应永不替换。
 *
 * 为什么机器输出不替换：那两路是给 CI diff 用的。替换了以后，
 * 换一份包（glossary 不同）就会让同一个项目的 JSON 变样，
 * diff 天天红，红到没人看。人读的那一路反过来：术语不换，
 * 面向的那个"会用微信、不会用终端"的人第一眼就走了。
 *
 * 纯函数，不读盘不写盘。
 */

/**
 * 整词替换，长词优先。
 *
 * 长词优先是必须的：{"门禁":"检查项","门禁清单":"检查清单"} 两条同时在，
 * 先换短的会把「门禁清单」变成「检查项清单」——看着通顺，但跟另一处
 * 写的「检查清单」对不上，同一个东西在界面上有了两个名字。
 *
 * 中文没有词边界，所以不能用 \b。这里直接按出现位置扫一遍，
 * 换过的区间不再参与后续匹配——避免 A→B、B→C 连环替换把话换成第三种说法。
 *
 * @param {string} text - 原文
 * @param {object} glossary - {内部说法: 用户说法}，可为空对象
 * @returns {string} 替换后的文本
 */
export function applyGlossary(text, glossary) {
  if (typeof text !== 'string' || text === '') return text === 0 ? text : (text || '');
  if (!glossary || typeof glossary !== 'object') return text;

  const pairs = Object.entries(glossary)
    .filter(([k, v]) => typeof k === 'string' && k.length > 0 && typeof v === 'string')
    .sort((a, b) => b[0].length - a[0].length);

  if (pairs.length === 0) return text;

  let out = '';
  let i = 0;
  outer: while (i < text.length) {
    for (const [from, to] of pairs) {
      if (text.startsWith(from, i)) {
        out += to;
        i += from.length;
        continue outer;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * 给协议对象里所有人读字段做替换，机器字段原样保留。
 *
 * 明确不动的字段：id、kind、severity、verdict、counts、trace 里的任何东西。
 * 那些是机器认的键和值，换掉就没法跟另一端对账了。
 *
 * @param {object} v - buildVerdict 的返回值
 * @param {object} glossary - 术语表
 * @returns {object} 新对象（不改原对象）
 */
export function applyGlossaryToVerdict(v, glossary) {
  if (!v || typeof v !== 'object') return v;
  const g = (s) => applyGlossary(s, glossary);
  return {
    ...v,
    inversion: v.inversion ? { ...v.inversion, say: g(v.inversion.say) } : null,
    blockers: (v.blockers || []).map((b) => ({ ...b, say: g(b.say), how: g(b.how) })),
    humanPending: (v.humanPending || []).map((h) => ({
      ...h,
      lead: g(h.lead),
      asks: (h.asks || []).map((a) => ({ ...a, q: g(a.q), why: g(a.why) })),
    })),
    warnings: (v.warnings || []).map((w) => ({ ...w, headline: g(w.headline) })),
  };
}
