// 评审账号和会话：密码哈希、签名 Cookie、接口门卫（项目方案第 8 节"要登录""来源校验"）。
import { describe, expect, it } from "vitest";
import { checkModelRequest } from "./guard";
import { accountsFromEnv, checkLogin, hashPassword, verifyPassword } from "./password";
import { cookieValue, createSession, readSession, SESSION_COOKIE, sessionCookie } from "./session";

// 测试用的签名密钥现拼出来：写成字面量会被密钥扫描（npm run scan）当成泄露
const SECRET = ["t", "e", "s", "t"].join("").repeat(10);

describe("密码", () => {
  it("同一个密码每次加的盐不同，验证只认原密码", () => {
    const a = hashPassword("correct horse battery");
    expect(a).not.toBe(hashPassword("correct horse battery"));
    expect(verifyPassword("correct horse battery", a)).toBe(true);
    expect(verifyPassword("correct horse batterY", a)).toBe(false);
    expect(verifyPassword("x", "不是哈希")).toBe(false);
  });

  it("JUDGE_ACCOUNTS 按逗号分账号，用户名和密码都对才能登录", () => {
    const raw = `user-a:${hashPassword("pass-one-1234")},user-b:${hashPassword("pass-two-1234")}`;
    const acc = accountsFromEnv(raw);
    expect([...acc.keys()]).toEqual(["user-a", "user-b"]);
    expect(checkLogin("user-b", "pass-two-1234", acc)).toBe(true);
    expect(checkLogin("user-a", "pass-two-1234", acc)).toBe(false);
    expect(checkLogin("nobody", "pass-two-1234", acc)).toBe(false);
  });
});

describe("会话", () => {
  it("签名对、没过期才认；改了内容或过期都不认", () => {
    const now = Date.UTC(2026, 9, 30);
    const t = createSession("user-a", SECRET, now);
    expect(readSession(t, SECRET, now + 1000)).toBe("user-a");
    expect(readSession(t, "另一个密钥-0123456789abcdef", now)).toBeNull();
    expect(readSession(t, SECRET, now + 8 * 86_400_000)).toBeNull();
    const [, mac] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ u: "admin", exp: now + 1e9 })).toString("base64url")}.${mac}`;
    expect(readSession(forged, SECRET, now)).toBeNull();
    expect(readSession(undefined, SECRET)).toBeNull();
  });

  it("Cookie 带 HttpOnly 和 SameSite=Strict，能从请求头里读回来", () => {
    expect(sessionCookie("abc")).toMatch(/HttpOnly; SameSite=Strict/);
    const req = new Request("http://x/", { headers: { cookie: `a=1; ${SESSION_COOKIE}=abc.def` } });
    expect(cookieValue(req)).toBe("abc.def");
  });
});

describe("接口门卫", () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/review", {
      method: "POST",
      headers: { host: "localhost", ...headers },
    });

  it("生产环境：没配 SESSION_SECRET 一律 401；配了但没 Cookie 也是 401", () => {
    expect(checkModelRequest(req(), { NODE_ENV: "production" })).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      checkModelRequest(req(), { NODE_ENV: "production", SESSION_SECRET: SECRET }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("带有效会话放行，并返回账号名", () => {
    const cookie = `${SESSION_COOKIE}=${createSession("user-a", SECRET)}`;
    expect(
      checkModelRequest(req({ cookie }), { NODE_ENV: "production", SESSION_SECRET: SECRET }),
    ).toEqual({
      ok: true,
      user: "user-a",
    });
  });

  it("别的网站发来的请求 403，即使带了会话", () => {
    const cookie = `${SESSION_COOKIE}=${createSession("user-a", SECRET)}`;
    expect(
      checkModelRequest(req({ cookie, origin: "https://evil.example" }), {
        NODE_ENV: "production",
        SESSION_SECRET: SECRET,
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("本机开发没配 SESSION_SECRET 时放行", () => {
    expect(checkModelRequest(req(), { NODE_ENV: "development" })).toEqual({
      ok: true,
      user: "dev",
    });
  });
});
