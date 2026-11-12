// 浏览器启动与连接：Node 自己起浏览器，不依赖 shell 脚本
// 环境变量 CDP_URL 存在时直接连该地址（不接管其生命周期）
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';

const CANDIDATES = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

export function findBrowser() {
  if (process.env.BROWSER_PATH && existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const list = CANDIDATES[process.platform] ?? CANDIDATES.linux;
  return list.find((p) => p && existsSync(p)) ?? null;
}

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

const waitForCdp = async (url, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${url}/json/version`);
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const killTree = (pid) => {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch { /* 已退出 */ }
};

/**
 * 打开浏览器。返回 { browser, close }。
 * 有 CDP_URL 时连接外部实例；否则自己拉起并在 close 时清理。
 */
export async function openBrowser(opts = {}) {
  const { width = 1440, height = 900, timeoutMs = 15000 } = opts;

  if (process.env.CDP_URL) {
    const browser = await chromium.connectOverCDP(process.env.CDP_URL);
    return { browser, close: () => browser.close().catch(() => {}) };
  }

  const exe = findBrowser();
  if (!exe) {
    throw new Error('未找到 Edge/Chrome。请安装其中之一，或用 BROWSER_PATH 指定路径，或设置 CDP_URL 连接已启动的浏览器。');
  }

  const port = await freePort();
  const profile = mkdtempSync(path.join(os.tmpdir(), 'vf-profile-'));
  const proc = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-crashpad', '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const endpoint = `http://127.0.0.1:${port}`;
  const cleanup = () => {
    killTree(proc.pid);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* 可能仍被占用 */ }
  };

  if (!(await waitForCdp(endpoint, timeoutMs))) {
    cleanup();
    throw new Error(`浏览器调试端口未就绪（${endpoint}）。受限沙箱下 Chromium 无法创建命名管道，需要放宽权限；或用 CDP_URL 连接外部已启动的浏览器。`);
  }

  const browser = await chromium.connectOverCDP(endpoint);
  return {
    browser,
    close: async () => {
      await browser.close().catch(() => {});
      cleanup();
    },
  };
}
