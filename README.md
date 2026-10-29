# 签前

毕业生签约前的合同检查和谈判练习。拍下录用通知、三方协议、实习协议或劳动合同，逐条检查试用期、违约金、社保、竞业限制等条款，每条结论附法条原文和计算过程；再和扮演 HR 的 AI 练习怎么提出修改。

> 本文件在开发过程中逐步补全，截图、架构图和团队信息在功能完成后填入。

## 技术栈

- Next.js 16（App Router）、React 19、TypeScript 严格模式
- Tailwind CSS 4
- 数据库：Node.js 24 内置的 `node:sqlite`（FTS5 全文检索），不依赖原生模块
- 测试：Vitest（单元）、Playwright（端到端，使用本机 Edge）

## 本地运行

需要 Node.js 24 或更高版本。

```bash
npm ci
cp .env.example .env.local   # 填入模型接口密钥等
npm run dev
```

浏览器打开 http://localhost:3000。

## 常用命令

| 命令                | 作用                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `npm run dev`       | 开发服务器                                                               |
| `npm run check`     | 提交前全量检查：ESLint、类型检查、单元测试、文案检查、密钥扫描、生产构建 |
| `npm run lint:copy` | 按写作规范检查界面文字和文档                                             |
| `npm run scan`      | 扫描密钥、本机路径等不能公开的内容                                       |
| `npm run test:e2e`  | 端到端测试                                                               |

## 环境变量

见 `.env.example`，每一项都有说明。`.env*` 文件不进仓库。

## 开发说明

开发中使用了 AI 编程助手。
