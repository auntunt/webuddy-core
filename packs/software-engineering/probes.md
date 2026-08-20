# 探测表达式

本文档记录已翻译为 DSL 的门禁规则。DSL 表达式由 kernel/probes.js 解释执行。

## Stage 1-2: 需求与建模

### 1.1
all(
  file-exists("artifacts/01-scope-card.md"),
  section-filled("artifacts/01-scope-card.md", "使用者"),
  section-filled("artifacts/01-scope-card.md", "现状他现在怎么做"),
  section-filled("artifacts/01-scope-card.md", "一句话替代"),
  section-filled("artifacts/01-scope-card.md", "成功指标"),
  section-filled("artifacts/01-scope-card.md", "使用频率"),
  section-filled("artifacts/01-scope-card.md", "明确不做")
)

### 1.2
count-at-least("artifacts/01-scope-card.md", "列表项", 3)

### 1.3
regex-hit("artifacts/01-scope-card.md", "##\\s*成功指标[\\s\\S]{0,300}?[0-9]", "成功指标里的数字")

### 1.4
section-filled("artifacts/01-scope-card.md", "一句话替代")

### 1.5 使用者别写成人名（缺场景卡由 1.1 报，不在这里重复）
any(
  not(file-exists("artifacts/01-scope-card.md")),
  not(regex-hit("artifacts/01-scope-card.md", "[张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廉贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤]\\s*(总|经理|老师|先生|女士|哥|姐)", "使用者写成了人名"))
)

### 1.7
regex-hit("artifacts/01-scope-card.md", "##\\s*使用频率[\\s\\S]{0,200}?[0-9]", "使用频率里的次数")

### 2.1
all(
  file-exists("artifacts/02-process.md"),
  section-filled("artifacts/02-process.md", "正常流程"),
  not(regex-hit("artifacts/02-process.md", "^\\s*[0-9]+[.、]\\s*[^：:\\n]{0,40}$", "没写谁做的步骤"))
)

### 2.2
all(
  file-exists("artifacts/02-process.md"),
  section-filled("artifacts/02-process.md", "一直不处理怎么办"),
  section-filled("artifacts/02-process.md", "填错了怎么改"),
  section-filled("artifacts/02-process.md", "谁能取消")
)

### 2.3
all(
  table-column-filled("artifacts/02-dictionary.md", "*", "类型"),
  table-column-filled("artifacts/02-dictionary.md", "*", "必填")
)

### 2.4
all(
  file-exists("artifacts/02-dictionary.md"),
  table-column-filled("artifacts/02-dictionary.md", "*", "类型"),
  not(regex-hit("artifacts/02-dictionary.md", "\\|\\s*(字符串|整数|浮点|布尔|时间戳|枚举|数组|对象|varchar|int|bool|string|float|text|json)\\s*\\|", "清单外的字段类型"))
)

### 2.5
all(
  table-column-filled("artifacts/02-dictionary.md", "*", "谁填"),
  table-column-filled("artifacts/02-dictionary.md", "*", "什么时候填")
)

### 2.6 数据之间的关系（实体关系/关联/关系三种写法任一算填了）
all(
  file-exists("artifacts/02-dictionary.md"),
  any(
    section-filled("artifacts/02-dictionary.md", "实体关系"),
    section-filled("artifacts/02-dictionary.md", "关联"),
    section-filled("artifacts/02-dictionary.md", "关系")
  )
)

### 2.7
all(
  file-exists("artifacts/02-states.md"),
  count-at-least("artifacts/02-states.md", "表行", 1),
  table-column-filled("artifacts/02-states.md", "*", "谁能")
)

### 2.8
all(
  file-exists("artifacts/02-states.md"),
  count-at-least("artifacts/02-states.md", "表行", 1),
  regex-hit("artifacts/02-states.md", "办完|完成|终态|结束|归档", "终态标记")
)

### 2.14 别让任何岗位能真删数据（删掉就找不回来，作废更稳）
all(
  file-exists("artifacts/02-permissions.md"),
  table-column-filled("artifacts/02-permissions.md", "*", "*"),
  not(regex-hit("artifacts/02-permissions.md", "^\\|[^|\\n]*删[^|\\n]*\\|(?:[^|\\n]*\\|)*?\\s*能\\s*\\|", "有岗位能真删数据"))
)

### 2.9
regex-hit("artifacts/02-states.md", "##\\s*终态[\\s\\S]{0,200}?\\S", "标出来的终态")

### 2.10
table-column-filled("artifacts/02-states.md", "*", "谁能做")

### 2.11
all(
  file-exists("artifacts/02-permissions.md"),
  table-column-filled("artifacts/02-permissions.md", "*", "*"),
  not(regex-hit("artifacts/02-permissions.md", "\\|\\s*(待定|TBD|看情况|不确定|待确认|\\?)\\s*\\|", "权限格里填了别的词"))
)

### 2.12
all(
  file-exists("artifacts/02-permissions.md"),
  any(
    not(regex-hit("artifacts/02-permissions.md", "有条件", "有条件的格子")),
    regex-hit("artifacts/02-permissions.md", "##\\s*条件说明[\\s\\S]{0,400}?有条件", "条件说明")
  )
)

## Stage 3-8: 规格、实现、验证、上线

### 3.9 验收标准的条数（数的是标准，不是功能行——一条功能常常挂好几条标准）
all(
  file-exists("artifacts/03-features.md"),
  count-at-least("artifacts/03-features.md", "小节", 20)
)

### 3.8
all(
  file-exists("artifacts/03-nonfunctional.md"),
  no-placeholder("artifacts/03-nonfunctional.md")
)

### 4.10 文件摆放跟约定一致（换人接手能猜到东西在哪；与 ref 的差异见 README「与 ref 有意不一致的一条」）
all(
  file-exists("package.json"),
  file-exists("src/**"),
  file-exists("tests/**")
)

### 4.3
file-exists("CLAUDE.md")

### 4.7
file-exists("db/schema.sql")

### 4.8
file-exists("docker-compose.yml")

### 6.2 测试有没有全过（"跑过一次绿的"这件事只有跑的人知道，DSL 只能核到磁盘上真有测试文件）
all(
  file-exists("package.json"),
  file-exists("tests/**")
)

### 6.3
all(
  file-exists("artifacts/06-traceability.md"),
  table-column-filled("artifacts/06-traceability.md", "*", "验收标准"),
  table-column-filled("artifacts/06-traceability.md", "*", "测试文件"),
  table-column-filled("artifacts/06-traceability.md", "*", "层级")
)

### 7.2
file-exists("ops/deploy.sh")

### 7.3
file-exists("ops/rollback.sh")

### 7.5
file-exists("ops/backup.sh")

### 7.4 换个人照文档也能装起来（要落到一个具体人名和一个日期，"换人复核"不算）
all(
  file-exists("artifacts/07-handover.md"),
  section-filled("artifacts/07-handover.md", "部署方式"),
  regex-hit("artifacts/07-handover.md", "换人|另一人|第二人|他人|复核|签字", "换人部署这件事"),
  regex-hit("artifacts/07-handover.md", "由\\s*[^，。；\\n]{0,8}?[一-龥]{2,4}(工程师|工|师|经理|同学|老师)?\\s*(按|照|独立|完成|执行|操作|部署|装)", "装的人是谁"),
  regex-hit("artifacts/07-handover.md", "\\d{4}[-/年]\\s*\\d{1,2}", "哪天装的")
)

### 7.6
all(
  file-exists("artifacts/07-handover.md"),
  section-filled("artifacts/07-handover.md", "备份与恢复"),
  regex-hit("artifacts/07-handover.md", "演练", "恢复演练记录")
)

### 7.16 旧办法哪天停（ref 问的是答问记录，这里改看交接单——写进交接单的日期才是所有人都看得到的那一个）
all(
  file-exists("artifacts/07-handover.md"),
  regex-hit("artifacts/07-handover.md", "旧(办法|流程|系统)|纸单|Excel", "旧办法这件事"),
  regex-hit("artifacts/07-handover.md", "(关闭|停用|停止|不再|作废)[^\\n]{0,20}?\\d{4}[-/年]\\s*\\d{1,2}|\\d{4}[-/年]\\s*\\d{1,2}[-/月]?\\s*\\d{0,2}\\s*[^\\n]{0,12}?(起|开始)?[^\\n]{0,8}?(关闭|停用|停止|不再收|作废)", "旧办法的关闭日期")
)

### 7.8
all(
  file-exists("docs/使用手册.md"),
  no-placeholder("docs/使用手册.md")
)

### 7.13
regex-hit("artifacts/07-handover.md", "https://", "https 开头的网址")

### 7.19
file-exists("db/seeds/*.sql")

### 3.1
all(
  file-exists("artifacts/03-features.md"),
  count-at-least("artifacts/03-features.md", "小节", 1),
  not(regex-hit("artifacts/03-features.md", "###\\s*AC-[0-9]+[^给]*\\n[^给当则]*\\n", "缺给定/当/则的AC"))
)

### 3.2
all(
  file-exists("artifacts/03-features.md"),
  count-at-least("artifacts/03-features.md", "小节", 1),
  not(regex-hit("artifacts/03-features.md", "友好|易用|快速|美观|方便|简洁|良好|合理|尽快|优化|灵活|完善|高效", "模糊形容词"))
)

### 3.4
table-column-filled("artifacts/03-features.md", "*", "验收标准")

### 3.6
count-at-least("artifacts/03-features.md", "小节", 1)

### 3.10
all(
  file-exists("artifacts/01-scope-card.md"),
  file-exists("artifacts/03-features.md")
)

### 4.5
all(
  file-exists("package.json"),
  not(regex-hit("package.json", "\\^|~", "范围版本号"))
)

### 7.1
regex-hit("artifacts/07-handover.md", "https?://[a-zA-Z0-9.-]+", "访问网址")


### 7.20 演示材料里别用真人名（文件得先在，不然"没找到假数据"是因为压根没这文件）
all(
  file-exists("docs/**/*.md"),
  not(regex-hit("docs/**/*.md", "张三|李四|王五|测试|demo@", "演示真数据"))
)

### 8.1
all(
  file-exists("artifacts/08-issues.md"),
  count-at-least("artifacts/08-issues.md", "表行", 1)
)

### 8.2
table-column-filled("artifacts/08-issues.md", "*", "分级")

### 8.3
all(
  file-exists("artifacts/08-changes.md"),
  table-column-filled("artifacts/08-changes.md", "*", "关联验收标准")
)

### 8.8
all(
  file-exists("artifacts/08-issues.md"),
  not(regex-hit("artifacts/08-issues.md", "状态.*处理中.*重要|状态.*处理中.*紧急", "逾期重要问题"))
)
