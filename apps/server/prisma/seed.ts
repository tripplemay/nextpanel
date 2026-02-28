import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';

const prisma = new PrismaClient();

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let input = '';
      process.stdin.on('data', (chunk: Buffer) => {
        const char = chunk.toString();
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (char === '\u0003') {
          process.exit();
        } else if (char === '\u007f') {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      });
      process.stdin.resume();
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log('=== NextPanel — 初始化 Admin 用户 ===\n');

  // Check environment variables required for the app
  const envWarnings: string[] = [];
  if (!process.env.JWT_SECRET) envWarnings.push('JWT_SECRET');
  if (!process.env.ENCRYPTION_KEY) envWarnings.push('ENCRYPTION_KEY');
  if (envWarnings.length > 0) {
    console.warn(
      `⚠️  警告：以下环境变量未设置：${envWarnings.join(', ')}\n` +
        '   请在 apps/server/.env 中配置后再启动服务。\n',
    );
  }

  // Determine username
  const usernameArg = process.argv[2];
  const username = usernameArg ?? ((await prompt('管理员用户名 [admin]: ')) || 'admin');

  // Determine password
  const passwordArg = process.argv[3];
  let password: string;
  if (passwordArg) {
    password = passwordArg;
  } else {
    password = await prompt('管理员密码（至少 8 位）: ', true);
    if (password.length < 8) {
      console.error('❌ 密码长度不足 8 位，退出。');
      process.exit(1);
    }
    const confirm = await prompt('再次确认密码: ', true);
    if (password !== confirm) {
      console.error('❌ 两次密码不一致，退出。');
      process.exit(1);
    }
  }

  // Upsert admin user
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    const overwrite =
      (await prompt(`\n用户 "${username}" 已存在，是否重置密码？[y/N] `)).toLowerCase();
    if (overwrite !== 'y') {
      console.log('已取消，未做任何更改。');
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { username },
      data: { passwordHash, role: 'ADMIN' },
    });
    console.log(`\n✅ 用户 "${username}" 密码已重置，角色确认为 ADMIN。`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { username, passwordHash, role: 'ADMIN' },
    });
    console.log(`\n✅ Admin 用户 "${username}" 创建成功。`);
  }

  console.log('\n现在可以运行 pnpm dev 并使用该账号登录面板。');
}

main()
  .catch((e) => {
    console.error('Seed 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
