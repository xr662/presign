// 生成评审账号的密码哈希，输出一段 用户名:scrypt$盐$哈希，填进服务器的 JUDGE_ACCOUNTS（多个用逗号连）。
// 密码从标准输入读，不放在命令行参数里（会留在 shell 历史里）。脚本不保存、不打印密码。
// 用法：npm run account:hash -- 用户名    然后输入密码回车
import { createInterface } from "node:readline/promises";
import { hashPassword } from "../src/lib/auth/password.ts";

const user = process.argv[2];
if (!user || user.includes(":") || user.includes(",")) {
  console.error("用法：npm run account:hash -- 用户名（用户名里不能有冒号和逗号）");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question("密码（至少 10 位）：");
rl.close();
if (password.length < 10) {
  console.error("密码太短，至少 10 位");
  process.exit(1);
}
console.log(`${user}:${hashPassword(password)}`);
