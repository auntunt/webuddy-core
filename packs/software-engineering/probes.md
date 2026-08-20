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
