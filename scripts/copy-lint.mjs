// 文案检查：扫描界面代码、文档和 README，命中写作规范里禁用的写法就报错。
// 规则来源：规划文档《写作与界面规范》第 1 节。提示词目录 prompts/ 是写给模型的，不在这里查。
// 用法：node scripts/copy-lint.mjs（npm run lint:copy）
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const TARGETS = ["src", "docs", "README.md", "mcp"];
const EXTS = new Set([".ts", ".tsx", ".md", ".mdx", ".json"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "build"]);

// [规则, 正则, 改法提示]。正则尽量只匹配中文语境，避免误伤代码里的 ! 和 —
const RULES = [
  ["破折号", /——/u, "改成逗号、冒号或拆成两句"],
  ["感叹号", /！/u, "界面里不用感叹号"],
  ["不是……而是", /不是[^。；\n]{0,40}而是/u, "直接说是什么"],
  ["不仅……更", /不仅[^。；\n]{0,40}更/u, "拆成两句，各说一件事"],
  ["称呼用您", /您/u, "统一用“你”"],
  ["emoji", /\p{Extended_Pictographic}/u, "去掉装饰符号"],
  [
    "空话词",
    /赋能|助力|打造|引领|全方位|一站式|智能化|无缝|极致|重塑|颠覆|新范式|深度融合|轻松|有趣|便捷|高效|贴心|专属|秒级|保驾护航/u,
    "换成具体做了什么、多少数字",
  ],
  ["套话", /值得一提的是|不难发现|众所周知|随着.{0,12}的发展|在.{0,10}的时代/u, "删掉，直接说事实"],
  ["总结句", /总之|综上所述|一句话总结|一句话版本/u, "不写段末总结"],
  ["聊天式栏目", /核心亮点|为什么选择我们|温馨提示/u, "换成说明内容的标题"],
  ["以写作时刻为准", /截至提交时|目前为止|即将上线/u, "按读者看到时成立的状态写"],
  ["AI 代劳腔", /AI ?帮你|让 ?AI|智能助手为您/u, "写清楚是哪一步、做了什么"],
];

function walk(p, out) {
  let st;
  try {
    st = statSync(p);
  } catch {
    return; // 目标目录还没建（比如 docs/），跳过
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) {
      if (!SKIP_DIRS.has(name)) walk(join(p, name), out);
    }
  } else if (EXTS.has(extname(p))) {
    out.push(p);
  }
}

const files = [];
for (const t of TARGETS) walk(join(ROOT, t), files);

let hits = 0;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [name, re, tip] of RULES) {
      const m = line.match(re);
      if (m) {
        hits++;
        console.log(`${relative(ROOT, file)}:${i + 1}  [${name}] “${m[0]}” → ${tip}`);
      }
    }
  });
}

if (hits > 0) {
  console.log(`\n文案检查：${hits} 处不符合写作规范。`);
  process.exit(1);
}
console.log(`文案检查通过（${files.length} 个文件）。`);
