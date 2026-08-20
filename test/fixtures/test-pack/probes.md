### 1.1
file-exists("需求文档.md")

### 2.1
all(
  file-exists("设计文档.md"),
  section-filled("设计文档.md", "架构设计")
)

### 3.1
file-exists("src/main.js")

### 3.2
count-at-least("测试清单.md", "表行", 3)
