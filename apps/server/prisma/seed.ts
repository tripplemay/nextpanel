import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';

const prisma = new PrismaClient();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (question: string): Promise<string> =>
  new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));

async function main() {
  console.log('=== NextPanel — 初始化 Admin 用户 ===\n');

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
  const username = usernameArg ?? ((await ask('管理员用户名 [admin]: ')) || 'admin');

  // Determine password
  const passwordArg = process.argv[3];
  let password: string;
  if (passwordArg) {
    password = passwordArg;
  } else {
    password = await ask('管理员密码（至少 8 位）: ');
    if (password.length < 8) {
      console.error('❌ 密码长度不足 8 位，退出。');
      rl.close();
      process.exit(1);
    }
    const confirm = await ask('再次确认密码: ');
    if (password !== confirm) {
      console.error('❌ 两次密码不一致，退出。');
      rl.close();
      process.exit(1);
    }
  }

  rl.close();

  // Upsert admin user
  const existing = await prisma.user.findUnique({ where: { username } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    await prisma.user.update({
      where: { username },
      data: { passwordHash, role: 'ADMIN' },
    });
    console.log(`\n✅ 用户 "${username}" 密码已重置，角色确认为 ADMIN。`);
  } else {
    await prisma.user.create({ data: { username, passwordHash, role: 'ADMIN' } });
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
