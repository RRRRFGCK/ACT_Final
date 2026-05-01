# Imperial CSP ACT 复习

这是一个给 Imperial CSP Advanced Communication Theory 复习用的选择题题库网站。

## 功能

- 上传题目截图，保留原图
- 使用 AI 提取题干索引、A/B/C/D/E 选项、正确答案和解析
- 选项单独保存，方便做选择题练习
- 搜索和查重基于 AI 识别出的文字和选项
- 刷题模式支持点击选项、确认答案、查看解析
- 数据保存到 Supabase，网页部署在 Vercel

## 主要文件

- `index.html`：页面结构
- `styles.css`：样式
- `app.js`：前端逻辑
- `api/extract-question.js`：OpenAI 图片识别接口
- `config.js`：Supabase 前端配置

## 部署提醒

OpenAI API key 只放在 Vercel 的环境变量 `OPENAI_API_KEY` 中，不要写进前端代码或 GitHub。
