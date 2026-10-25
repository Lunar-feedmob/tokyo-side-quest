import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { closeDb } from "../db/client";
import { closeRedis } from "../infra/redis";
import { ADMIN_ROLES, createAdmin, type AdminRole } from "../services/admin-auth";

// `pnpm admin:create` — interactive only. The password is read without echo and
// never accepted as a CLI argument, so it does not land in shell history or logs.

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error("请在交互式终端中运行 pnpm admin:create"));
      return;
    }
    stdout.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  if (process.argv.length > 2) {
    console.error("pnpm admin:create 不接受命令行参数，请按提示交互输入。");
    process.exitCode = 2;
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const username = (await rl.question("管理员用户名：")).trim();
  const roleAnswer = ((await rl.question(`角色（${ADMIN_ROLES.join(" / ")}，默认 owner）：`)).trim() || "owner") as AdminRole;
  rl.close();
  if (!ADMIN_ROLES.includes(roleAnswer)) throw new Error("未知角色");
  const password = await askHidden("密码（至少 12 位，输入不显示）：");
  const again = await askHidden("再次输入密码：");
  if (password !== again) throw new Error("两次输入的密码不一致");
  const admin = await createAdmin({ username, password, role: roleAnswer });
  console.log(`已创建管理员 ${admin.username}（${roleAnswer}）`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await closeDb();
  });
