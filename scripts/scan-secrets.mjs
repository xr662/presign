// 提交前扫描：仓库会公开给评委，不能带出密钥、本机路径和个人身份信息。
// 只扫 git 会跟踪的文件（git ls-files，含未提交的新文件），和真正会被推上去的内容一致。
// 用法：node scripts/scan-secrets.mjs（npm run scan）
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SELF = "scripts/scan-secrets.mjs";

// 用户名和邮箱前缀拆开拼，免得这个文件本身被自己扫到
const userName = ["xu", "rui"].join("");
const RULES = [
  ["API 密钥", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["私钥", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // 形如 LLM_MAIN_API_KEY=xxxx 的赋值（.env.example 里值是空的，不会命中）
  ["密钥赋值", /(API_KEY|SECRET|TOKEN)s*[=:]s*["']?[A-Za-z0-9_-.]{12,}/],
  ["Windows 本机路径", /[A-Za-z]:\\Users\\/],
  ["Git Bash 本机路径", /\/[a-z]\/Users\//],
  ["本机用户名", new RegExp(`\\b${userName}\\b`, "i")],
  ["个人邮箱", new RegExp(`${userName}\\d+@`, "i")],
];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => f && f !== SELF && !f.endsWith("package-lock.json"));

let hits = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue; // 二进制文件（图片等）跳过
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [name, re] of RULES) {
      if (re.test(line)) {
        hits++;
        console.log(`${f}:${i + 1}  [${name}]`);
      }
    }
  });
}

if (hits > 0) {
  console.log(`\n发现 ${hits} 处不能公开的内容，处理后再提交。`);
  process.exit(1);
}
console.log(`密钥和路径扫描通过（${files.length} 个文件）。`);
