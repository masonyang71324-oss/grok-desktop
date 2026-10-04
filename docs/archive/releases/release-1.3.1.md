# Grok Desktop 1.3.1

## 中文

- 截图后在输入框粘贴，图片自动保存并显示缩略图；点击可预览，发送后让 Grok 分析所附图片。
- 修复 Grok Build 未声明 ACP 图片输入时无法发送图片的问题。当前 Grok Build 1.0.13 可通过本地 read_file 工具识图，已用真实 ACP 会话验证；支持原生图片输入的版本继续直接传图。
- 图片草稿可在重新载入后恢复；文件缺失或格式错误时保留草稿。中文与英文提示同步更新。

截图位于应用数据目录的 attachments 文件夹，无需手动填写路径。仅发送你附上的图片；读取仍受 Grok 工具能力和当前操作权限约束。

## English

- Paste screenshots into the composer to save them automatically, preview thumbnails and send them for analysis.
- When native ACP image input is unavailable, Grok is asked to view the exact attached local files using read_file. This route was verified with a live Grok Build 1.0.13 ACP session. Native image input remains preferred when available.
- Screenshot drafts survive reloads; missing or invalid files preserve the draft. Both English and Chinese UI text are updated.

Screenshots are stored under attachments in the application data directory. Only selected attachments are sent; local reading remains subject to Grok's tool capabilities and the current permission settings.

This is a prerelease. Windows installer and portable builds are unsigned.
