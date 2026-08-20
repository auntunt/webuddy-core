/**
 * 人工门禁记录的可信度检查。
 *
 * 为什么要有这个文件：`07-门禁清单.md` 通则把「凭什么」列为七要素之一，
 * 写明是「证据文件在哪（测试报告、演练记录、改动清单等）」。
 * 所以一条没写凭据的「通过」，按项目自己的文档就是记录不全——不是通过。
 *
 * 判据只用数得出来的东西，不读代码、不读语义，符合规则二：
 *   1. 日期得是个真日期（能不能解析成 YYYY-MM-DD，不用理解内容）
 *   2. 凭据不能是空的（有没有字，数长度）
 *   3. 同一句凭据不能铺在好几条门禁上（数同一个字符串出现几次）
 *
 * 第三条是这里唯一不显然的一条，说明一下：一句「已完成并留痕」同时当
 * 13 条不同门禁的凭据，它就不是任何一条的凭据，只是点确认时的手滑。
 * 这个判法故意不写关键词黑名单（`24-工程约束反思.md` §3 批过三源不同步的词表），
 * 因为词表要维护、会漏、还得跟文档对齐；数重复不需要维护任何列表，
 * 而且非技术背景的人自己打开 `.webuddy/state.json` 就能数出来同一句话出现几次，
 * 有异议时可以直接指着记录反驳工具。
 *
 * 判不了的时候只降到 ask（记录不可信），绝不降到 fail：
 * 「这条记录信不过」和「这件事做错了」是两回事，混起来会让人去改事实而不是补证据。
 */

/** 同一句凭据铺到几条门禁就算铺得太宽。两条还可能是共用同一份证据文件，三条起就不像了。 */
export const EVIDENCE_REUSE_LIMIT = 3;

/** 日期得能对上 YYYY-MM-DD，而且是真实存在的一天（2026-02-30 不算）。 */
export function validRecordDate(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 凭据文本归一化后再比，免得多打一个空格就算两句不同的话。 */
function normEvidence(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').trim();
}

/**
 * 一句凭据被多少条门禁共用。
 * @param {string} how 凭据原文
 * @param {Record<string, any>} checks 整个 humanChecks
 * @returns {string[]} 用了同一句凭据的门禁号（含自己）
 */
export function evidenceSharedBy(how, checks) {
  const key = normEvidence(how);
  if (!key) return [];
  return Object.keys(checks || {})
    .filter((id) => normEvidence(checks[id]?.how) === key)
    .sort();
}

/**
 * 这条凭据有没有毛病。写入端（命令行 / 服务端 / 界面）和判定端共用这一个函数，
 * 保证「写得进去」和「判得过」是同一套标准——两边标准不一样的话，
 * 人会写进一条自己以为算通过、工具却不认的记录，那比拦住他更难受。
 * @returns {null|{code: string, msg: string}} 没毛病返回 null
 */
export function evidenceIssue(how, checks, selfId) {
  const key = normEvidence(how);
  if (!key) {
    return { code: 'empty', msg: '这条没写凭据。门禁记录七要素里「凭什么」是必填的：证据文件在哪，或者你具体看了什么、看到了什么' };
  }
  const shared = evidenceSharedBy(how, checks).filter((id) => id !== selfId);
  if (shared.length + 1 >= EVIDENCE_REUSE_LIMIT) {
    const n = shared.length + 1;
    const quote = key.length > 10 ? `${key.slice(0, 10)}…` : key;
    // 不列全部门禁号：这句话会在每一条受影响的门禁下面重复一遍，列 14 个号会把清单冲垮。
    // 只报数量和另外一条的编号，人自己打开 .webuddy/state.json 搜这句话就能数全。
    return {
      code: 'reused',
      msg: `凭据只写了「${quote}」，同一句话在另外 ${n - 1} 条门禁上也用了（比如 ${shared[0]}）。一句话同时证明这么多件不同的事，它就没在证明其中任何一件——这一条得单独写你看了什么、看到了什么`,
    };
  }
  return null;
}

/**
 * 判一条人工门禁记录。
 * @param {any} rec humanChecks[id]
 * @param {Record<string, any>} checks 整个 humanChecks（数凭据复用要用）
 * @param {string} id 门禁号
 */
export function judgeHumanRecord(rec, checks, id) {
  if (!rec) {
    return { r: 'ask', detail: '这件事工具看不出来，得你自己看一眼再点个确认。确认后会记下日期，不用再想第二遍' };
  }
  const dateOk = validRecordDate(rec.date);
  const who = rec.by || '你';
  if (rec.result === '通过') {
    if (!dateOk) {
      return { r: 'ask', detail: `记录里的日期是「${rec.date ?? '空'}」，不是个日期。补一条正常的确认，工具才敢把这条算过` };
    }
    const bad = evidenceIssue(rec.how, checks, id);
    if (bad) return { r: 'ask', detail: `${rec.date} ${who} 记过通过，但${bad.msg}` };
    return { r: 'pass', detail: `${rec.date} 由 ${who} 确认：${normEvidence(rec.how).slice(0, 40)}` };
  }
  const note = rec.how || (rec.result === '待改' ? '你标了待改' : '你标了不通过');
  const stamp = dateOk ? `${rec.date} ` : '';
  if (rec.result === '待改') return { r: 'fix', detail: `${stamp}${note}` };
  return { r: 'fail', detail: `${stamp}${note}` };
}
