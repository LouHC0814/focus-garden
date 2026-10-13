// 可选的真实浏览器检查：仅使用 Node 内置模块与已安装的 Chrome / Edge。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('../scripts/serve.cjs');
const C = require('../dist/core.js');
if (typeof WebSocket === 'undefined') throw new Error('浏览器检查需要 Node.js 22 或更新版本。');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url); this.pending = new Map(); this.events = new Map(); this.nextId = 0; this.errors = [];
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    this.socket.addEventListener('message', (event) => {
      const data = JSON.parse(String(event.data));
      if (data.id && this.pending.has(data.id)) {
        const pending = this.pending.get(data.id); this.pending.delete(data.id); clearTimeout(pending.timeout);
        if (data.error) pending.reject(new Error(data.error.message)); else pending.resolve(data.result);
      }
      if (data.method === 'Runtime.exceptionThrown') this.errors.push(data.params.exceptionDetails);
      if (data.method === 'Page.javascriptDialogOpening') this.call('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      if (data.method && this.events.has(data.method)) {
        const waiting = this.events.get(data.method); this.events.delete(data.method);
        for (const item of waiting) { clearTimeout(item.timeout); item.resolve(data.params); }
      }
    });
  }
  async call(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`浏览器命令超时：${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timeout }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  wait(method) {
    return new Promise((resolve, reject) => {
      const item = { resolve, timeout: setTimeout(() => reject(new Error(`等待事件超时：${method}`)), 15000) };
      const waiting = this.events.get(method) || []; waiting.push(item); this.events.set(method, waiting);
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception));
    return result.result.value;
  }
}

async function until(callback, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await callback(); if (result) return result; await delay(60); }
  throw new Error(`检查超时：${label}`);
}

(async () => {
  const repo = path.resolve(__dirname, '..');
  const runtime = path.join(repo, '.runtime', `browser-${Date.now()}`);
  const downloads = path.join(runtime, 'downloads');
  await fs.mkdir(downloads, { recursive: true });
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  let executable;
  for (const candidate of candidates) { try { await fs.access(candidate); executable = candidate; break; } catch (_) {} }
  if (!executable) throw new Error('未找到浏览器。请把 CHROME_PATH 设置为 Chrome 或 Edge 的绝对路径。');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let logs = '';
  let cdp;
  try {
    assert.equal((await fetch(address)).status, 200);
    const profile = path.join(runtime, 'profile');
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    browser.stderr.on('data', (data) => { logs = (logs + data).slice(-12000); });
    const port = await until(async () => { try { return Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch (_) { return false; } }, '浏览器启动');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((item) => item.type === 'page');
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
    await cdp.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    async function navigate(url) { const loaded = cdp.wait('Page.loadEventFired'); await cdp.call('Page.navigate', { url }); await loaded; }
    async function reload() { const loaded = cdp.wait('Page.loadEventFired'); await cdp.call('Page.reload', {}); await loaded; }
    const saved = () => cdp.evaluate("JSON.parse(localStorage.getItem('lou-focus-garden-v1'))");
    async function add(title) { await cdp.evaluate(`document.getElementById('task-input').value=${JSON.stringify(title)};document.getElementById('task-form').requestSubmit();`); }
    async function importFile(file) {
      const document = await cdp.call('DOM.getDocument');
      const node = await cdp.call('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#import-file' });
      await cdp.call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file] });
    }
    await navigate(address);
    assert.equal(await cdp.evaluate("document.getElementById('metric-today').textContent"), '0');
    await add('背 10 个单词'); await add('做一道概率题'); await add('整理一下桌面');
    await cdp.evaluate("document.querySelector('.task-check input').click()");
    let state = await saved();
    assert.equal(state.tasks.length, 3); assert.equal(C.metrics(state, Date.now()).done, 1);
    await reload();
    assert.equal(await cdp.evaluate("document.querySelectorAll('.task-row').length"), 3);
    assert.equal(await cdp.evaluate("document.getElementById('metric-today').textContent"), '1');
    await cdp.evaluate("document.querySelector('[data-filter=done]').click()");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.task-row').length"), 1);
    await cdp.evaluate("document.querySelector('[data-filter=all]').click()");
    await add('<img src=x onerror="window.__unsafe=1">');
    assert.equal(await cdp.evaluate("document.querySelectorAll('#task-list img').length"), 0);
    assert.equal(await cdp.evaluate('window.__unsafe === undefined'), true);
    await cdp.evaluate("document.querySelector('.task-delete').click()");
    assert.equal((await saved()).tasks.length, 3);
    await cdp.evaluate("document.getElementById('sky-button').click()");
    assert.equal((await saved()).sky, 'night');
    await reload(); assert.equal(await cdp.evaluate("document.getElementById('sky-button').getAttribute('aria-pressed')"), 'true');
    await cdp.evaluate("document.getElementById('sky-button').click();document.getElementById('focus-button').click()");
    await delay(1200);
    const beforeReload = await saved();
    assert.equal(beforeReload.focus.status, 'running');
    await reload(); assert.equal((await saved()).focus.deadline, beforeReload.focus.deadline);
    await cdp.evaluate("document.getElementById('focus-button').click()");
    assert.equal((await saved()).focus.status, 'paused');
    await cdp.evaluate("document.getElementById('focus-button').click()");
    assert.equal((await saved()).focus.id, beforeReload.focus.id);
    await cdp.evaluate("document.getElementById('reset-button').click()");
    assert.equal((await saved()).stats.minutes, 0);
    await cdp.evaluate("document.getElementById('export-button').click()");
    const backupName = await until(async () => (await fs.readdir(downloads)).find((name) => name.endsWith('.json')), '备份下载');
    const exported = C.validateState(JSON.parse(await fs.readFile(path.join(downloads, backupName), 'utf8')));
    assert.equal(exported.tasks.length, 3);
    await cdp.evaluate("document.querySelector('.task-delete').click()"); assert.equal((await saved()).tasks.length, 2);
    await importFile(path.join(downloads, backupName));
    await until(async () => (await saved()).tasks.length === 3, '恢复备份');
    const invalid = path.join(runtime, '无效备份.json'); await fs.writeFile(invalid, '{"version":999}');
    await importFile(invalid); await until(() => cdp.evaluate("document.getElementById('toast').textContent.startsWith('导入失败')"), '拒绝无效备份');
    assert.equal((await saved()).tasks.length, 3);
    // 使用已过期的测试时间验证恢复结算；不伪称真实专注了一分钟。
    const expired = C.startFocus(C.selectDuration(exported, 1), Date.now() - 65000, 'expired-test-session');
    const fixture = path.join(runtime, '过期计时测试.json'); await fs.writeFile(fixture, JSON.stringify(expired));
    await importFile(fixture);
    await until(async () => (await saved()).stats.minutes === 1, '过期计时补记');
    await reload(); assert.equal((await saved()).stats.minutes, 1); assert.equal((await saved()).stats.sessions, 1);
    // 演示图片恢复到普通任务示例，不包含时间测试产生的专注统计。
    await importFile(path.join(downloads, backupName));
    await until(async () => (await saved()).stats.minutes === 0, '恢复截图示例');
    await cdp.evaluate("document.getElementById('toast').classList.remove('visible');document.activeElement.blur()");
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    const layout = await cdp.call('Page.getLayoutMetrics');
    const desktop = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: Math.ceil(layout.cssContentSize.height), scale: 1 } });
    await fs.writeFile(path.join(repo, 'docs', '桌面演示.png'), Buffer.from(desktop.data, 'base64'));
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    assert.equal(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    const mobileLayout = await cdp.call('Page.getLayoutMetrics');
    const mobile = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: Math.ceil(mobileLayout.cssContentSize.height), scale: 1 } });
    await fs.writeFile(path.join(repo, 'docs', '手机演示.png'), Buffer.from(mobile.data, 'base64'));
    // local file 模式也应能打开，避免直接双击时遇到模块 CORS 问题。
    const fileUrl = require('node:url').pathToFileURL(path.join(repo, 'dist', 'index.html')).href;
    await navigate(fileUrl); await add('本地文件测试');
    assert.equal(await cdp.evaluate("document.querySelectorAll('.task-row').length"), 1);
    assert.equal(cdp.errors.length, 0, JSON.stringify(cdp.errors));
    console.log('真实浏览器检查通过：任务、保存、筛选、计时、备份、输入安全、手机布局与直接双击模式。');
    console.log(`桌面与手机截图已保存到 ${path.join(repo, 'docs')}`);
  } catch (error) { console.error(logs); throw error; }
  finally {
    if (cdp) { try { await cdp.call('Browser.close'); } catch (_) {} cdp.socket.close(); }
    if (browser && browser.exitCode === null) browser.kill();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
