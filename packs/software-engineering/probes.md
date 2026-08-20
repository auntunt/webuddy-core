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

### 1.7
regex-hit("artifacts/01-scope-card.md", "##\\s*使用频率[\\s\\S]{0,200}?[0-9]", "使用频率里的次数")

### 2.3
all(
  table-column-filled("artifacts/02-dictionary.md", "*", "类型"),
  table-column-filled("artifacts/02-dictionary.md", "*", "必填")
)

### 2.5
all(
  table-column-filled("artifacts/02-dictionary.md", "*", "谁填"),
  table-column-filled("artifacts/02-dictionary.md", "*", "什么时候填")
)

### 2.9
regex-hit("artifacts/02-states.md", "##\\s*终态[\\s\\S]{0,200}?\\S", "标出来的终态")

### 2.10
table-column-filled("artifacts/02-states.md", "*", "谁能做")

### 2.12
any(
  not(regex-hit("artifacts/02-permissions.md", "有条件", "有条件的格子")),
  regex-hit("artifacts/02-permissions.md", "##\\s*条件说明[\\s\\S]{0,400}?有条件", "条件说明")
)

## Stage 3-8: 规格、实现、验证、上线

### 3.8
all(
  file-exists("artifacts/03-nonfunctional.md"),
  no-placeholder("artifacts/03-nonfunctional.md")
)

### 4.3
file-exists("CLAUDE.md")

### 4.7
file-exists("db/schema.sql")

### 4.8
file-exists("docker-compose.yml")

### 4.10
all(
  file-exists("package.json"),
  file-exists("src/*.js"),
  file-exists("tests/*.test.js")
)

### 5.3
round-clean("files")

### 5.4
round-clean("deps")

### 5.5
round-clean("schema")

### 5.6
round-clean("tests")

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
not(regex-hit("artifacts/03-features.md", "友好|易用|快速|美观|方便|简洁|良好|合理|尽快|优化|灵活|完善|高效", "模糊形容词"))

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
not(regex-hit("package.json", "\\^|~", "范围版本号"))

### 4.9
not(regex-hit("package.json", "react-redux|mongoose|@apollo/server|graphql|styled-components", "约定外组件"))

### 7.1
regex-hit("artifacts/07-handover.md", "https?://[a-zA-Z0-9.-]+", "访问网址")

### 7.4
regex-hit("artifacts/07-handover.md", "换人部署|他人部署|独立部署", "换人验证记录")

### 7.6
regex-hit("artifacts/07-handover.md", "恢复演练|恢复测试|备份恢复", "恢复演练记录")

### 7.12
not(regex-hit("src/**/*.js", "console\\.log|debugger", "调试代码"))

### 7.20
not(regex-hit("docs/**/*.md", "张三|李四|王五|测试|demo@", "演示真数据"))

### 7.21
regex-hit("artifacts/07-handover.md", "https?://", "演示地址")

### 8.1
file-exists("artifacts/08-issues.md")

### 8.2
table-column-filled("artifacts/08-issues.md", "*", "分级")

### 8.3
all(
  file-exists("artifacts/08-changes.md"),
  table-column-filled("artifacts/08-changes.md", "*", "关联验收标准")
)

### 8.4
not(regex-hit("artifacts/08-issues.md", "类型.*需求", "需求进了问题台账"))

### 8.5
all(
  file-exists("artifacts/02-dictionary.md"),
  file-exists("artifacts/08-changes.md")
)

### 8.6
table-column-filled("artifacts/08-changes.md", "*", "测试是否全绿")

### 8.7
table-column-filled("artifacts/08-changes.md", "*", "是否已备份")

### 8.8
not(regex-hit("artifacts/08-issues.md", "状态.*处理中.*重要|状态.*处理中.*紧急", "逾期重要问题"))
