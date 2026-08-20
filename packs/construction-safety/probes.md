### 1.1 施工队资质齐全
all(
  file-exists("资质文件/企业资质证书.pdf"),
  file-exists("资质文件/安全生产许可证.pdf"),
  file-exists("资质文件/项目经理证书.pdf")
)

### 1.3 现场围挡必须到位
all(
  file-exists("现场照片/围挡-东.jpg"),
  file-exists("现场照片/围挡-南.jpg"),
  file-exists("现场照片/围挡-西.jpg"),
  file-exists("现场照片/围挡-北.jpg")
)

### 2.1 每日巡检记录完整
file-exists("巡检记录/*.md")

### 2.3 用电设备接地检测
file-exists("检测报告/接地电阻检测.pdf")

### 3.1 隐患整改闭环
all(
  file-exists("隐患台账.md"),
  regex-hit("隐患台账.md", "整改完成", "整改完成标记")
)
