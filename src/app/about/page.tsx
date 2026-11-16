import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const metadata: Metadata = { title: "说明" };

// 说明页（项目方案第 2 节）：原理、数据来源、隐私、免责声明。
// 隐私表每一行都对得上代码里的位置（11-16 逐项核对）：
//   照片和文字只在请求内存里 → src/app/api/ocr、review、practice 的路由都不写文件、不打印内容
//   练习场景 → src/features/practice/scenario.ts 的 sessionStorage
//   登录 Cookie 7 天 → src/lib/auth/session.ts 的 SESSION_DAYS
//   用量库 30 天 → src/lib/ai/usage.ts 启动时删除 30 天前的记录
//   日志 → deploy/Caddyfile 只记错误；服务器 journald 上限 200MB、保留 14 天

const LAWS = [
  "中华人民共和国劳动合同法",
  "中华人民共和国劳动合同法实施条例",
  "中华人民共和国劳动法",
  "中华人民共和国劳动争议调解仲裁法",
  "中华人民共和国社会保险法",
  "中华人民共和国民法典（相关条文）",
  "最高人民法院关于审理劳动争议案件适用法律问题的解释（一）",
  "最高人民法院关于审理劳动争议案件适用法律问题的解释（二）",
  "工资支付暂行规定",
  "最低工资规定",
  "职工带薪年休假条例",
];

const PRIVACY: [string, string, string][] = [
  [
    "合同照片",
    "先在你的浏览器里把身份证号、手机号、银行卡号、邮箱涂黑，涂过的图片发到服务器，转给模型识别文字",
    "服务器只在这次请求里用，不存盘",
  ],
  ["识别出的文字、检查报告", "只在你打开的这个页面里", "刷新或关掉页面就没了"],
  ["谈判练习要谈的条款", "浏览器的 sessionStorage（只在这个标签页里）", "关掉这个标签页就清除"],
  ["谈判练习的对话", "每一轮发到服务器、转给模型，服务器不存", "关掉页面就没了"],
  ["登录状态", "浏览器 Cookie，只有账号名和到期时间，页面脚本读不到", "7 天后失效"],
  [
    "用量记录",
    "服务器上的用量库：每次调用模型的时间、用途、token 数、耗时、是否成功，每次检查的时间和账号。没有合同内容",
    "30 天后自动删除",
  ],
  ["服务器日志", "只记出错的情况，不记每次请求的内容", "最多 200MB，保留 14 天"],
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 leading-7">
        <h1 className="text-2xl font-semibold">说明</h1>

        <h2 className="mt-8 text-lg font-semibold">怎么检查</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
          <li>浏览器先在本地找出文字的位置，把个人信息涂黑，再把图片发给模型识别文字。</li>
          <li>
            模型把合同拆成合同期限、试用期、工资、违约金、竞业限制这些字段，每个字段带原文出处。
          </li>
          <li>
            程序按字段列出检查计划。试用期上限、试用期工资、违约金能不能约定这类有明确规定的问题，由程序按法条计算；规则覆盖不到的条款，先检索相关法条，再由模型判断。
          </li>
          <li>
            程序核对每条结论：出处在合同里、依据的法条在库里、数字出自计算。对不上的去掉或改成“需要确认”。
          </li>
          <li>每条结论附上法条原文和计算过程。法条原文从法规库里取，不由模型生成。</li>
        </ol>
        <p className="mt-3 text-ink-2">
          检查过程会实时显示在页面上，每一步调了哪个工具、输入输出是什么都能展开看。不想自己拍合同，可以先看
          <Link href="/samples" className="underline">
            示例合同
          </Link>
          。
        </p>

        <h2 className="mt-8 text-lg font-semibold">谈判练习</h2>
        <p className="mt-2 text-ink-2">
          AI 扮演
          HR，有好商量、公事公办、强势三种风格，目标是尽量保住公司的条款。旁边的教练每轮给一条提示，提示里的法条只能出自检查报告，程序会核对条号。结束后按依据、改法、语气三项复盘。HR
          的回复可以朗读；浏览器支持语音识别时可以按住说话，识别出的文字先放进输入框，看过再发。HR
          说的话是模拟的，不代表真实公司的态度。
        </p>

        <h2 className="mt-8 text-lg font-semibold">法条来源</h2>
        <p className="mt-2 text-ink-2">
          收录下面 11 部法律、行政法规、司法解释和部门规章，共 524 条，另有最高人民法院发布的 6
          个劳动争议典型案例。条文来自国家机关网站公开发布的文本，每条记录了来源网址和效力状态；每部法规都另找了一家政府网站的转载逐条比对过。
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-2">
          {LAWS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-2 text-ink-2">
          各地最低工资标准截至 2026 年 10 月 1
          日，以人力资源和社会保障部公布的全国表为底，叠加各省后来发布的调整文件，覆盖 31 个省份，40
          个常见城市注明了所在档位。
        </p>

        <h2 className="mt-8 text-lg font-semibold">隐私</h2>
        {/* 不用表格：手机上三列放不下，第三列要横向滑动才看得到 */}
        <dl className="mt-2 divide-y divide-line border-y border-line text-sm">
          {PRIVACY.map(([what, where, howLong]) => (
            <div key={what} className="py-3">
              <dt className="font-medium">{what}</dt>
              <dd className="mt-1 text-ink-2">{where}</dd>
              <dd className="mt-1 text-ink-2">保存多久：{howLong}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-ink-2">
          识别、检查和谈判练习会把涂黑后的图片、合同文字和对话发给模型服务商处理：DeepSeek-v4-flash
          模型，经微信 API 平台调用。法条检索用的向量模型 bge-small-zh-v1.5
          在我们自己的服务器上运行，不发给别人。
        </p>

        <h2 className="mt-8 text-lg font-semibold">免责声明</h2>
        <p className="mt-2 text-ink-2">
          检查结果是风险提示，不构成法律意见。合同条款是否有效，最终以劳动争议仲裁机构和法院的认定为准。涉及具体纠纷，请咨询律师或拨打
          12348 公共法律服务热线。
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
