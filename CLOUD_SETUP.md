# 多人在线版上线方案

目标：把当前本地题库改成一个大家都能打开同一个网址、实时上传和刷题的网站。

## 推荐架构

- 前端：当前静态网页
- 部署：Vercel 或 Netlify
- 数据库：Supabase Postgres
- 图片存储：Supabase Storage
- 登录：Supabase Auth，可先用邮箱登录
- OCR：第一版继续用浏览器端 Tesseract.js
- AI 解析：后续加一个后端 API，避免把 OpenAI API key 暴露在前端

## 为什么用 Supabase

- 有数据库、登录、文件存储、实时订阅
- 免费额度够小组复习项目起步
- 前端接入简单
- 后面可以升级权限和审核流程

## 数据库表

在 Supabase SQL Editor 里执行：

```sql
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  course text not null default '未分类课程',
  topic text not null default '未分类章节',
  type text not null default '选择题',
  difficulty text not null default '普通',
  text text not null,
  answer text default '',
  explanation text default '',
  tags text[] default '{}',
  reviewed boolean not null default false,
  image_url text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.questions enable row level security;

create policy "Anyone can read questions"
on public.questions
for select
to anon
using (true);

create policy "Anyone can add questions"
on public.questions
for insert
to anon
with check (true);

create policy "Anyone can update questions"
on public.questions
for update
to anon
using (true)
with check (true);

create policy "Anyone can delete questions"
on public.questions
for delete
to anon
using (true);
```

## 文件存储

在 Supabase Storage 新建 bucket：

- bucket 名：`question-images`
- public：可以先设为 `true`，简单起步

后面如果题目图片比较敏感，可以改成 private bucket，再通过后端签名 URL 访问。

## 前端需要改什么

当前版本的数据存在浏览器 `localStorage`。多人版需要改成：

- `loadQuestions()` 从 Supabase 读取
- `saveQuestionFromForm()` 保存到 Supabase
- 删除、编辑、标记复习都更新 Supabase
- 图片上传到 Supabase Storage
- 使用 Supabase realtime 订阅 `questions` 表变化

## 配置文件

新增一个 `config.js`：

```js
window.APP_CONFIG = {
  SUPABASE_URL: "你的 Supabase Project URL",
  SUPABASE_ANON_KEY: "你的 Supabase anon public key"
};
```

注意：`anon key` 可以放前端，`service role key` 和 OpenAI API key 绝对不要放前端。

## 部署步骤

1. 创建 Supabase 项目
2. 执行上面的 SQL
3. 创建 `question-images` bucket
4. 把 Supabase URL 和 anon key 填到 `config.js`
5. 把项目上传到 GitHub
6. 用 Vercel 或 Netlify 导入这个 GitHub 仓库
7. 得到一个公开网址，发给同学使用

## 合规建议

- 网站标题和说明保持为“复习题库”和“错题整理”
- 只收集允许分享的练习题、公开资料、自己整理的题
- 加一条上传确认：不得上传正在进行的考试题或违反课程规则的材料
- 如果要多人编辑，建议保留创建者和时间记录

## 后续功能优先级

1. 登录和云端题库
2. 实时同步
3. 图片云存储
4. 重复题合并
5. 管理员审核
6. 后端 AI 解析

## OpenAI 图片识别上线步骤

### 1. 给 Supabase 表增加选择题字段

在 Supabase SQL Editor 运行：

```sql
alter table public.questions
add column if not exists options jsonb default '[]'::jsonb,
add column if not exists correct_answer text default '';
```

### 2. 在 Vercel 添加 OpenAI API Key

进入 Vercel 项目 `act-final`：

`Settings -> Environment Variables`

添加：

```text
OPENAI_API_KEY=你的 OpenAI API key
```

只添加到 Vercel 环境变量，不要写进 `config.js` 或前端代码。

### 3. 重新部署

把本地代码推送到 GitHub 后，Vercel 会自动重新部署。部署完成后，打开线上网址，上传图片并点击 `AI 精准识别`。
