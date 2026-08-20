/**
 * 八环节 + 门禁项 + 关键节点提问：全部数据化。
 *
 * ⚠ 搬进 webuddy-core 之后，这个文件不再是门禁模式和严格度的事实源。
 *
 * 内核的 loadPack 只读 SKILL.md（compileSkill 从 `判据类型：auto|human` 和
 * `严格度：block|warn|info` 两行编译门禁表），从来不 import 这个文件的 STAGES
 * 来定 mode/severity。这里唯一还在被读的是 `artifacts` 字段——
 * lib/probe-artifacts.js 拿它推导全部产物文件名。
 *
 * 所以下面每一行的 mode / severity / check 都只是从 ref 抄过来的历史记录，
 * 改它们不会有任何效果。P3 收口时 SKILL.md 里有 23 条门禁的 mode 与这里不一致
 * （比如 2.1 这里写 human、SKILL.md 是 auto），不一致的那一方是这里，
 * 生效的是 SKILL.md。要改门禁模式，去改 SKILL.md。
 *
 * 没把这 23 行对齐过来，是因为对齐会让人以为这个文件又变成事实源了——
 * 而它一旦被当成事实源，下一个人就会改这里然后奇怪为什么不生效。
 *
 * 数据来自 20-环节定稿.md（环节定义）与 07-门禁清单.md（门禁逐项）。
 *
 * 每个门禁项的 `check` 字段只是给人看的判据代号，**代码不读它**。
 * evaluate.js 是按 `gate.id` 去 rules.js / rules-late.js 里找判定函数的
 * （`{...RULES, ...RULES_LATE}[gate.id]`），跟 check 写什么无关。
 * 这里以前写着"check 是探测器事实集里的键名"——那是错的，
 * 照着它改 check 不会有任何效果，反而会让人以为改完就生效了。
 * 加新门禁项要做两件事：在这里加一行，再去 rules 里按 id 写判定函数。
 *
 * `mode` 只有两种：
 *   auto   —— 工具能自己判，非技术人员不用管
 *   human  —— 必须人确认并留痕，工具只能问"做了没有"
 *
 * `severity` 三档。这是"外挂辅助"跟"强制规范"的分界线：
 *   block  —— 真拦。不做一定出事，这一步过不去
 *   warn   —— 亮红灯，但你确认过就能往下走
 *   info   —— 灰色建议，做了加分，不做不拦
 * 三档不是按"重不重要"分的，是按"不做会不会出事"分的。
 * 判断新门禁归哪档，问一句：这条不做，是后面一定得返工，
 * 还是只是不够漂亮？前者 block，后者往下降。
 * 有效档位还会被模式和挂钩状态往下压，见 severity.js——
 * 这里写的是天花板，不是最终值。
 *
 * 铁律（20-环节定稿.md 规则二）：判据不许依赖读代码。
 * 加新检查项前先问"非技术人员能自己判断吗"。答不出就必须是 auto。
 */

export const STAGES = [
  {
    id: 1,
    key: 's1-scope',
    name: '场景定义',
    oneLiner: '说清替代谁的哪个动作',
    question: '为什么要做？',
    artifacts: ['01-scope-card.md'],
    gates: [
      // 1.1-1.4 是场景卡的核心四栏：范围、边界、指标、替代动作。
      // 这四栏空着往下走，后面每一步都在猜，所以只有它们真拦。
      { id: '1.1', mode: 'auto', severity: 'block', check: 'scopeCardFieldsComplete', desc: '场景卡六个部分无空缺', hint: '把场景卡里空着的栏填上，特别是「明确不做」' },
      { id: '1.2', mode: 'auto', severity: 'block', check: 'outOfScopeAtLeast3', desc: '明确不做清单至少三条', hint: '想一下：别人问"能不能顺便管一下 X"，你怎么回答？把三个"不做"写下来' },
      { id: '1.3', mode: 'auto', severity: 'block', check: 'metricMeasurable', desc: '成功指标可测量', hint: '"提升效率"不算。要写成"月底汇总从 4 小时降到 10 分钟"这样带数字的' },
      { id: '1.4', mode: 'auto', severity: 'block', check: 'oneSentenceReplacement', desc: '一句话替代描述填写完整', hint: '填这句：上线后，___ 的 ___ 这个动作被系统替代了' },
      { id: '1.5', mode: 'human', severity: 'warn', check: 'userIsRoleNotName', desc: '使用者是岗位不是姓名', hint: '写"车间班组长"，不要写"张经理"' },
      { id: '1.6', mode: 'human', severity: 'warn', check: 'currentActionHasTools', desc: '现状动作写到具体工具', hint: '只写"手工处理"不够，要说清是纸单、微信群还是 Excel' },
      { id: '1.7', mode: 'auto', severity: 'warn', check: 'frequencyHasMagnitude', desc: '使用频率有数量级', hint: '每天大概多少次？给个数量级就行' },
      // 这里曾经有一条 1.8「三个真实使用者各访谈一次」，已经删掉。
      // 依据 15-需求确认方法.md §6：那套三次对话的做法自己声明「未经实战校准」，
      // 只能作为建议动作讲。把没校准过的方法做成硬门禁，是在预支这套门禁的信用——
      // 人一旦发现有一条红灯拦得没道理，就会开始怀疑其余 90 条。
      // 建议动作现在放在 steps.js 第一步的 risk 字段里，不带门禁。
    ],
  },
  {
    id: 2,
    key: 's2-model',
    name: '流程与数据建模',
    oneLiner: '定清系统里到底存什么',
    question: '做的是什么？',
    artifacts: ['02-process.md', '02-dictionary.md', '02-states.md', '02-permissions.md'],
    gates: [
      { id: '2.1', mode: 'human', severity: 'warn', check: 'processStepsHaveActor', desc: '正常流程每步有「谁做什么」', hint: '把"系统处理"改成具体某个岗位做什么' },
      { id: '2.2', mode: 'human', severity: 'warn', check: 'threeExceptionsAnswered', desc: '三个异常问题全部回答', hint: '一直不处理怎么办、填错了怎么改、谁能取消——三问都要答' },
      // 2.3-2.6 是数据字典的骨架。字段的类型、必填、谁填、几条对几条，
      // 这四件定错了，后面存进去的数据就是错的，返工要重灌数据。
      { id: '2.3', mode: 'auto', severity: 'block', check: 'fieldsHaveTypeAndRequired', desc: '每个字段有类型和必填标记', hint: '数据字典里类型栏或必填栏有空的' },
      { id: '2.4', mode: 'human', severity: 'block', check: 'fieldTypesInAllowedList', desc: '字段类型在允许清单内', hint: '只能用这些：文本、长文本、数字、金额、日期、日期时间、选择、多选、图片、附件、是否' },
      { id: '2.5', mode: 'auto', severity: 'block', check: 'fieldsHaveFillerAndTiming', desc: '每个字段有「谁填、什么时候填」', hint: '每个字段都要说清谁在哪一步填它' },
      { id: '2.6', mode: 'human', severity: 'block', check: 'entityRelationsDeclared', desc: '两类数据之间的关系已写明', hint: '有两类以上数据就要说清关系：一张单配多条明细，还是两边都能对多个' },
      { id: '2.7', mode: 'human', severity: 'warn', check: 'everyStateReachable', desc: '每个状态都有办法走进去', hint: '有个状态谁也走不进去，写了等于没有。对一遍流转表' },
      { id: '2.8', mode: 'human', severity: 'warn', check: 'everyNonFinalStateHasExit', desc: '单子不会卡在某个状态出不来', hint: '单子走到某个状态就卡住了。要么写个下一步，要么标明「到这儿就算办完了」' },
      { id: '2.9', mode: 'auto', severity: 'warn', check: 'finalStatesMarked', desc: '标明了哪些状态算办完了', hint: '哪些状态走到就结束了（已入库、已作废），标出来' },
      { id: '2.10', mode: 'auto', severity: 'warn', check: 'transitionsHaveActor', desc: '流转表每行都写了「谁能做」', hint: '每一步都要说清哪个岗位有权推进' },
      // 空着的权限格上线后就是默认允许，这是会出事的那一类，所以拦。
      { id: '2.11', mode: 'human', severity: 'block', check: 'permissionMatrixNoBlank', desc: '权限表每一格都填了，没有空格', hint: '每个岗位每个操作都要填：能、不能、或有条件。空着的格上线后就成了默认允许' },
      { id: '2.12', mode: 'auto', severity: 'warn', check: 'conditionalPermissionsSpecified', desc: '填「有条件」的地方写清了是什么条件', hint: '写了"有条件"就必须说清什么条件，比如「只能改自己班组的」' },
      { id: '2.13', mode: 'human', severity: 'warn', check: 'threeRealRecordsBackfilled', desc: '拿三张真实旧单子试填过，都填得进去', hint: '这道关最要紧。找三张真的旧单据，照数据字典一栏一栏填，看栏位够不够、类型对不对。填不进去的那一栏就是设计漏了' },
      { id: '2.14', mode: 'human', severity: 'warn', check: 'deletePermissionReviewed', desc: '删除权限已审视', hint: '业务系统里真删数据几乎总是错的。「删除」一栏基本都该是"不能"，改成作废状态' },
    ],
  },
  {
    id: 3,
    key: 's3-spec',
    name: '规格与验收标准',
    oneLiner: '把业务规则写成能判真假的句子',
    question: '做的是什么？',
    artifacts: ['03-features.md', '03-nonfunctional.md'],
    gates: [
      // 3.1 和 3.4 是验收标准这件事的地基：格式对、功能全都有。
      // 这两条不过，环节六「每条标准配一个测试」就无从下手。
      { id: '3.1', mode: 'auto', severity: 'block', check: 'acHasGivenWhenThen', desc: '每条验收标准有完整的给定/当/则', hint: '三段都要写全，只写"则"不行' },
      { id: '3.2', mode: 'auto', severity: 'warn', check: 'noVagueAdjectives', desc: '无模糊形容词', hint: '"友好""快""稳定""合理"这类词一律不能用，因为没法判真假' },
      { id: '3.3', mode: 'human', severity: 'warn', check: 'thenIsDecidable', desc: '「则」部分可判断真假', hint: '"则系统正常工作"不算。要写清具体发生什么，能一眼看出对不对' },
      { id: '3.4', mode: 'auto', severity: 'block', check: 'everyFeatureHasAC', desc: '每个功能至少一条验收标准', hint: '功能清单里有功能没配验收标准' },
      { id: '3.5', mode: 'human', severity: 'warn', check: 'acTraceableToScopeCard', desc: '每条标准都能对上场景卡里的动作', hint: '有验收标准描述了场景卡里没提过的功能' },
      { id: '3.6', mode: 'auto', severity: 'warn', check: 'hasNegativeCases', desc: '有反例/边界条目', hint: '全是正常流程。要补"填错了""没权限""超长"这类' },
      { id: '3.7', mode: 'human', severity: 'warn', check: 'keyPagesHaveWireframe', desc: '主要几个页面画过草图', hint: '把主要页面上有哪些栏、哪些按钮画一下，手画拍张照也行。不画，AI 就自己猜' },
      { id: '3.8', mode: 'auto', severity: 'warn', check: 'nonFunctionalSevenFields', desc: '七件容易漏的事都说清了', hint: '数据大概多少条、点一下要多久出来、数据留几年、什么时间段必须能用、手机还是电脑用、内网还是外网、界面什么语言——七件都要填。漏一件，上线后就是一次返工' },
      // 提示语本来就写着"只提示不阻断"，以前代码不认这句话，现在认了。
      { id: '3.9', mode: 'human', severity: 'info', check: 'acCountInRange', desc: '标准总数在合理区间（20–100）', hint: '少于 20 条通常是想漏了，多于 100 条通常是范围没收住。这条只提示不阻断' },
      { id: '3.10', mode: 'auto', severity: 'warn', check: 'noACOnOutOfScope', desc: '无验收标准覆盖到 out-of-scope 内容', hint: '范围在偷偷扩张：场景卡说不做的东西，验收标准里出现了' },
    ],
  },
  {
    id: 4,
    key: 's4-foundation',
    name: '工程地基',
    oneLiner: '把干活的场地搭好',
    question: '怎么做出来？',
    artifacts: [],
    gates: [
      // 跑得起来、退得回去，这两件没有就没法干活，其余是工程讲究。
      { id: '4.1', mode: 'auto', severity: 'block', check: 'oneCommandStart', desc: '一步就能把软件跑起来', hint: '要先手工改配置才能跑起来，就不算过' },
      { id: '4.2', mode: 'auto', severity: 'warn', check: 'oneCommandTest', desc: '一步就能跑完全部测试', hint: '还没有跑测试的办法。测试是替你反复试功能的小程序，它是你唯一能看出软件好没好的通道' },
      { id: '4.3', mode: 'auto', severity: 'warn', check: 'agentRulesFileExists', desc: '给 AI 写了这个项目的规矩文件', hint: '缺 CLAUDE.md / AGENTS.md 这类文件。它是写给 AI 看的项目规矩，没有它 AI 每一轮都没有边界感' },
      { id: '4.4', mode: 'auto', severity: 'block', check: 'vcsInitialized', desc: '改动有存档，能退回上一版', hint: '项目还没接存档工具（git），改坏了退不回去' },
      // 4.5 不在非技术人员手里——组件版本是 AI 写的，拿它拦人没道理。
      { id: '4.5', mode: 'auto', severity: 'warn', check: 'depsPinnedExact', desc: '用到的现成组件锁定了版本', hint: '组件版本写成了「这一系列的最新版」（带 ^ 或 ~）。别人那边装到的是新版，同样的代码就跑不起来' },
      { id: '4.6', mode: 'auto', severity: 'warn', check: 'noHardcodedSecrets', desc: '密码没写死在代码里，三套环境各用各的配置', hint: '密码或密钥直接写在代码里了。挪到单独的配置里，并确认没跟着代码传上去' },
      { id: '4.7', mode: 'auto', severity: 'warn', check: 'dbConnectionConfigured', desc: '存数据的地方连得上', hint: '数据库（存数据的地方）连不上，或还没配' },
      { id: '4.8', mode: 'auto', severity: 'warn', check: 'coldStartVerified', desc: '换一台空白电脑也能装起来', hint: '现在只在你自己电脑上能跑。这是及格线第二条的预演' },
      { id: '4.9', mode: 'auto', severity: 'warn', check: 'stackMatchesDefault', desc: '没换掉约定好的技术方案', hint: 'AI 自己换了一套技术方案。不一定错，但要你点头一次' },
      // 目录怎么摆是 AI 的事，不该拿来考人。
      { id: '4.10', mode: 'auto', severity: 'info', check: 'projectStructureOk', desc: '文件摆放跟模板一致', hint: '目录结构跟模板不一样了' },
    ],
  },
  {
    id: 5,
    key: 's5-build',
    name: '分步实现',
    oneLiner: '让 AI 一次只做一件事',
    question: '怎么做出来？',
    artifacts: [],
    perSlice: true,
    gates: [
      // 这一环节大半条目要靠轮次和挂钩才看得见。挂钩没装时，
      // 5.2/5.3/5.4/5.5/5.7/5.8 会被自动降到 info（见 severity.js），
      // 免得一堆永远判不出来的条目红在那里。
      { id: '5.1', mode: 'human', severity: 'warn', check: 'sliceDeclaresAC', desc: '这一小步说清了做哪条验收标准', hint: '开工前先说清这一小步做的是哪条验收标准' },
      { id: '5.2', mode: 'human', severity: 'warn', check: 'planBeforeAct', desc: 'AI 动手前先说了要怎么改，你看过才放它动', hint: 'AI 没说一声就直接开始改了。要先让它说打算改哪、怎么改，你看过再放行' },
      { id: '5.3', mode: 'auto', severity: 'warn', check: 'changesInScope', desc: 'AI 只改了它说要改的地方', hint: 'AI 顺手动了它没提过的地方。改多了你看不出来，出问题也不知道从哪查' },
      { id: '5.4', mode: 'auto', severity: 'warn', check: 'noUndeclaredDeps', desc: 'AI 没偷偷加进新的现成组件', hint: 'AI 自己装了个现成组件。这是你根本发现不了的事，所以工具必须拦一次' },
      { id: '5.5', mode: 'auto', severity: 'warn', check: 'schemaUnchanged', desc: '没动数据表的结构', hint: '数据表结构（有哪些栏、什么类型）被悄悄改了。要改得回环节二改数据字典——不是不让改，是别偷偷改' },
      // 改测试和把原来的测试弄绿掉，是这套东西里唯一不能让的两件：
      // 测试是不读代码的人唯一的眼睛，动了它，后面所有绿灯都不算数。
      { id: '5.6', mode: 'auto', severity: 'block', check: 'testsNotTampered', desc: '原来的测试没被动过', hint: 'AI 把测试改了，好让它显示通过。测试是你唯一能看出软件好没好的通道，改测试等于把体温计调低' },
      { id: '5.7', mode: 'human', severity: 'warn', check: 'oneThingPerRound', desc: '本轮只做一件事', hint: '一轮里做了三个功能，出问题定位不了' },
      { id: '5.8', mode: 'human', severity: 'warn', check: 'noDriveByRefactor', desc: '没有"顺手优化"', hint: 'AI 说"我顺便把别处也优化了一下"。原本好用的地方被动过，坏了你也不会想到是它' },
      { id: '5.9', mode: 'human', severity: 'warn', check: 'appRuns', desc: '软件可运行', hint: '起不来了' },
      { id: '5.10', mode: 'human', severity: 'warn', check: 'sliceClickable', desc: '这一小步做出来的东西你能点开看', hint: '只有内部逻辑、没有能点的界面，你没法验收。每一小步都要能点' },
      { id: '5.11', mode: 'auto', severity: 'info', check: 'commitMsgHasAC', desc: '每次存档写清了对应哪条验收标准', hint: '存档说明只写"更新"这种，以后查不出这次改了什么、为什么改' },
      { id: '5.12', mode: 'human', severity: 'block', check: 'existingTestsStillGreen', desc: '原来能过的测试还都能过', hint: '新功能把原来好的地方改坏了' },
    ],
  },
  {
    id: 6,
    key: 's6-verify',
    name: '验证与质量门禁',
    oneLiner: '用测试代替读代码',
    question: '怎么做出来？',
    artifacts: ['06-traceability.md'],
    gates: [
      // 6.1 和 6.2 是「用测试代替读代码」这件事的全部：标准有人管、管的都过了。
      // 这两条塌了，整套判定就没有依据可言，所以只有它们真拦。
      { id: '6.1', mode: 'auto', severity: 'block', check: 'everyACHasTest', desc: '每条验收标准至少配一个测试', hint: '对照表里有标准没配测试' },
      { id: '6.2', mode: 'human', severity: 'block', check: 'allTestsPass', desc: '全部测试都通过', hint: '有测试没通过。测试是你唯一能看出软件好没好的通道，没全过就不能上线' },
      { id: '6.3', mode: 'auto', severity: 'warn', check: 'traceabilityNoBlank', desc: '标准与测试的对照表没有空格', hint: '对照表里有空格。这张表就是「哪条标准由哪个测试管」的一览' },
      { id: '6.4', mode: 'human', severity: 'warn', check: 'testsActuallyAssert', desc: '测试真的在核对结果，不是走个过场', hint: '抽两成打开看：它有没有真的核对结果对不对。AI 会写只跑一遍、什么都不核对的测试来骗过门禁' },
      // 这一条原来是四条（异常/边界/越权/乱跳状态）。拆得太细，
      // 非技术人员看到的是四盏分不清差别的红灯，实际要做的是同一件事：
      // 把"不顺利"的情况也测一遍。合成一条，判定仍然逐项查（rules-late.js '6.5'）。
      { id: '6.5', mode: 'human', severity: 'warn', check: 'unhappyPathsTested', desc: '测过出错和极端的情况', hint: '测的全是一切顺利的情况。填错了、没权限、空的、超长的、乱跳状态——这些也要测' },
      { id: '6.9', mode: 'human', severity: 'warn', check: 'noTestFileTamperThisRound', desc: '这一轮没动过测试', hint: '这一轮又改测试了' },
      // 这条只能靠人。八条底线做没做要看代码，规则二不许判据依赖读代码。
      // 原来标 auto，而工具没有任何路子能拿到这八条的结果——等于永远红着。
      { id: '6.10', mode: 'human', severity: 'warn', check: 'securityBaseline', desc: '八条安全底线都过了', hint: '八条底线：改数据前要登录、每人只看得到自己该看的、防数据库被套话、防页面被塞脚本、密码存成不可还原的乱码、上传限类型和大小、久不操作自动退出、报错不把内部细节抖出去' },
      { id: '6.11', mode: 'auto', severity: 'warn', check: 'noDebugBackdoor', desc: '没有写死的密码，也没留后门', hint: '留了测试账号或后门（不用密码就能进的口子）' },
    ],
  },
  {
    id: 7,
    key: 's7-ship',
    name: '上线与上架',
    oneLiner: '部得上去、有人真在用',
    question: '怎么用起来？',
    artifacts: ['07-handover.md', '07-demo-script.md'],
    batches: { 1: ['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8', '7.9', '7.10', '7.11', '7.12', '7.13'], 2: ['7.14', '7.15'], 3: ['7.16', '7.17'], 4: ['7.18', '7.19', '7.20', '7.21'] },
    gates: [
      // 这一环节只有"网址打得开"是不做一定出事的——它是"上线了"这句话本身。
      // 其余是交付讲究：课程项目、内部工具往往不需要走全套，所以都是 warn。
      { id: '7.1', mode: 'auto', severity: 'block', check: 'liveUrlAlive', desc: '网址打得开', hint: '给用户的那个网址现在打不开' },
      { id: '7.2', mode: 'auto', severity: 'warn', check: 'oneCommandDeploy', desc: '一步就能把新版本发上去', hint: '发版还要一步步手工操作，换个人就发不上去' },
      { id: '7.3', mode: 'auto', severity: 'warn', check: 'rollbackVerified', desc: '发坏了能退回上一版，而且真试过', hint: '有退回上一版的办法，但没真试过，等于没有' },
      { id: '7.4', mode: 'human', severity: 'warn', check: 'otherPersonDeployed', desc: '换个人照文档也能重新装起来', hint: '及格线第二条本身。找另一个人，只给他你的文档，让他从头装一遍，成了双方签字留痕' },
      { id: '7.5', mode: 'auto', severity: 'warn', check: 'backupConfigured', desc: '备份策略已配置且运行', hint: '配了但没跑起来' },
      { id: '7.6', mode: 'human', severity: 'warn', check: 'restoreDrilled', desc: '恢复演练完成有记录', hint: '及格线第三条本身。真删一次真恢复一次，记下日期耗时结果，还要抽几条比对字段值' },
      { id: '7.7', mode: 'human', severity: 'warn', check: 'monitoringVerified', desc: '监控告警配置且通道验证', hint: '发一条测试告警，确认真能收到' },
      // 手册在哪、里头有没有命令行，工具都看不见（它不在 artifacts 里，路径也只有人知道）。同 6.10。
      { id: '7.8', mode: 'human', severity: 'warn', check: 'manualPlainLanguage', desc: '使用手册无技术术语无代码', hint: '手册里出现了命令行或代码。用手册的人不会敲命令' },
      { id: '7.9', mode: 'human', severity: 'warn', check: 'accountsAndPasswordDelivery', desc: '账号建好了，密码是安全地发到每人手上的', hint: '别在微信群里直接发密码——群里的人和截图都留着。至少做到第一次登录必须改密码' },
      { id: '7.10', mode: 'human', severity: 'warn', check: 'handoverChecklistVerified', desc: '交接单每栏都填了，而且真试过一遍', hint: '填了但没试：网址要真打得开、备份要真恢复过一次' },
      { id: '7.11', mode: 'human', severity: 'warn', check: 'trainingRecorded', desc: '教过谁用，名单记下来了', hint: '还没教人用，或者教了没记谁哪天学的。后面谁不会用，找不到人对账' },
      { id: '7.12', mode: 'auto', severity: 'warn', check: 'noDebugInProd', desc: '正式系统里没有测试数据，也没开调试模式', hint: '正式系统里还留着测试时乱填的数据。用户一打开看到假数据，就不会信这个系统' },
      { id: '7.13', mode: 'auto', severity: 'warn', check: 'httpsEnabled', desc: '网址带锁（https）', hint: '网址还是 http 开头。数据在网上是明文跑的，密码也一样' },
      { id: '7.14', mode: 'human', severity: 'warn', check: 'complianceMaterials', desc: '合规材料清单完成（对外发布场景）', hint: '对公众发布要备案。仅内网可标注不适用' },
      { id: '7.15', mode: 'human', severity: 'warn', check: 'dataResidencyOk', desc: '数据出境与存储位置符合要求', hint: '这条跟发布形态无关，内网项目也要过' },
      { id: '7.16', mode: 'human', severity: 'warn', check: 'oldProcessCloseDateSet', desc: '旧流程的关闭时间已明确', hint: '两条里更硬的一条：纸单还在收、Excel 还在传，新系统一定没人用' },
      { id: '7.17', mode: 'human', severity: 'warn', check: 'realUsageInWeek', desc: '上线后一周有真实使用记录', hint: '只有你自己登录过。按六步排查：他知道吗/会用吗/旧办法还能用吗/比原来麻烦吗/敢用吗/才是场景选错' },
      // 7.18-7.21 是「演示就绪」批：系统做出来后总要给老板/同事/客户看，
      // 演示前要备好四样——脚本、数据、数据干净、地址真开过。
      // 全部 warn：没备好不拦上线，但亮红灯提醒。
      { id: '7.18', mode: 'human', severity: 'warn', check: 'demoScriptExists', desc: '有 3 分钟演示脚本', hint: '写一小段：打开哪个页面、点哪几下、每步说什么。照着它，谁都能替你给老板演示一遍' },
      { id: '7.19', mode: 'auto', severity: 'warn', check: 'demoDataPrepared', desc: '演示数据提前准备好了', hint: '让 AI 做一份演示数据（单独一份文件或一键生成），演示前不用现场手忙脚乱编数据' },
      { id: '7.20', mode: 'human', severity: 'warn', check: 'demoNoRealData', desc: '演示数据里没有真实信息', hint: '演示是给别人看的：真实姓名、手机号、密码、客户的真单子都不能出现，换成编的数据' },
      { id: '7.21', mode: 'auto', severity: 'warn', check: 'demoUrlOpened', desc: '演示地址真的打开看过', hint: '用给别人看时的那个地址打开一次，别只在你自己电脑上能开。在工具里跑一次「演示地址」检查' },
    ],
  },
  {
    id: 8,
    key: 's8-operate',
    name: '运行与迭代',
    oneLiner: '出问题有本子记、改动查得到',
    question: '怎么持续？',
    artifacts: ['08-issues.md', '08-changes.md'],
    gates: [
      // 运维这一整环节都不拦：项目还没跑起来就先被运维条目挡住，
      // 是这套东西最容易招人烦的地方。8.9/8.10 更是"以后省事"，只提一句。
      { id: '8.1', mode: 'human', severity: 'warn', check: 'issueLedgerInUse', desc: '有个本子记用户反馈的问题，而且真在记', hint: '本子建了但没往里记东西' },
      { id: '8.2', mode: 'auto', severity: 'warn', check: 'issuesGraded', desc: '每个问题有分级', hint: '紧急当天、重要 3 天、一般下个版本、需求进下一轮场景卡' },
      { id: '8.3', mode: 'auto', severity: 'warn', check: 'changesLinkedToAC', desc: '每次改动都写清了对应哪条验收标准', hint: '变更记录里关联栏是空的，以后说不清这次为什么改' },
      { id: '8.4', mode: 'auto', severity: 'warn', check: 'requestsNotInBugFlow', desc: '「需求」类未混入问题处理流', hint: '防腐烂的关键。新需求当 bug 直接改，系统会改到没人敢动' },
      { id: '8.5', mode: 'auto', severity: 'warn', check: 'schemaChangeWentThroughS2', desc: '改数据表结构前先回环节二改了文档', hint: '直接改的数据表结构，没回环节二先改数据字典' },
      { id: '8.6', mode: 'auto', severity: 'warn', check: 'testsGreenBeforeRelease', desc: '每次变更上线前测试全绿', hint: '没跑测试就上线了' },
      { id: '8.7', mode: 'auto', severity: 'warn', check: 'backupBeforeRelease', desc: '每次变更上线前已备份', hint: '没备份就上线了' },
      { id: '8.8', mode: 'auto', severity: 'warn', check: 'noOverdueIssues', desc: '没有问题拖过说好的处理时限', hint: '有问题挂着超过当初标的时限了（紧急当天、重要三天）' },
      { id: '8.9', mode: 'human', severity: 'info', check: 'nextScopeCardExists', desc: '下一轮要做什么，已经写下来了', hint: '没想下一轮做什么，这个系统三个月后就没人用了' },
      { id: '8.10', mode: 'human', severity: 'info', check: 'knowHowHarvested', desc: '这次学到的东西记下来了', hint: '这一单踩的坑没记下来，下一单还得从零踩一遍' },
    ],
  },
];

/**
 * 及格线三条：结课总验收，对应门禁项。
 *
 * `modes` 是"哪几种场景要求这一条"。课程作业、内部小工具做不到
 * "换个人照文档装一遍"和"真删一次真恢复一次"——这两件要有第二个人、
 * 要有真数据。拿它们卡住一个练手项目，人只会把及格线当摆设。
 * 所以：学习模式只要 P1，原型模式要 P1+P2，正式交付三条都要。
 */
export const PASS_LINE = [
  { id: 'P1', desc: '验收标准全绿', gates: ['6.1', '6.2', '6.3', '6.4'], modes: ['learning', 'mvp', 'full'] },
  { id: 'P2', desc: '换个人照文档也能装起来', gates: ['7.4'], modes: ['mvp', 'full'] },
  { id: 'P3', desc: '数据能恢复', gates: ['7.6'], modes: ['full'] },
];

/** 五问外壳：对外用这套名字，内部用环节编号。两套必须一一对应，不许出现第三套。 */
export const FIVE_QUESTIONS = [
  { q: '为什么要做？', stages: [1], answer: '说不清替代谁的哪个动作，就不该开工' },
  { q: '做的是什么？', stages: [2, 3], answer: '把业务规则写成能判真假的句子' },
  { q: '怎么做出来？', stages: [4, 5, 6], answer: '让 AI 一次只做一件事，用测试代替读代码' },
  { q: '怎么用起来？', stages: [7], answer: '部得上去，而且有人真在用' },
  { q: '怎么持续？', stages: [8], answer: '出问题有本子记，改动查得到' },
];

export const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
export const ALL_GATES = STAGES.flatMap((s) => s.gates.map((g) => ({ ...g, stage: s.id })));
export const GATE_BY_ID = new Map(ALL_GATES.map((g) => [g.id, g]));

// 漏写 severity 的门禁会被当成什么档？三档判定里任何一处兜底，
// 都等于悄悄给它选了一档。这里当场报错，逼人在加门禁时想清楚。
const BAD_SEVERITY = ALL_GATES.filter((g) => !['block', 'warn', 'info'].includes(g.severity));
if (BAD_SEVERITY.length) {
  throw new Error(`这些门禁的 severity 没写或写错了：${BAD_SEVERITY.map((g) => g.id).join(', ')}`);
}
