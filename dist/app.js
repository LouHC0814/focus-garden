(function () {
  'use strict';
  const C = window.FocusGarden;
  const KEY = 'lou-focus-garden-v1';
  const $ = (id) => document.getElementById(id);
  const flowers = ['🌼', '🌷', '🌸', '🌻', '🪻', '🌺'];
  let state = C.initialState();
  let filter = 'all';
  let lastRaw = null;
  let blockedRaw = null;
  let canSave = true;
  let toastTimeout;
  const uid = () => window.crypto?.randomUUID?.() || `seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  function notice(message) { $('storage-notice').textContent = message; $('storage-notice').hidden = false; }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 3500);
  }

  function readFresh() {
    if (!canSave) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw !== lastRaw) {
        state = raw ? C.validateState(JSON.parse(raw)) : C.initialState();
        lastRaw = raw;
      }
    } catch (error) {
      canSave = false;
      try { blockedRaw = localStorage.getItem(KEY); } catch (_) { /* 当前浏览器禁止存储。 */ }
      notice('浏览器记录无法读取，目前使用临时模式，不会覆盖旧记录。可导出记录，或导入有效备份恢复。');
    }
  }

  function save(next) {
    state = C.validateState(next);
    if (!canSave) return;
    try {
      lastRaw = JSON.stringify(state);
      localStorage.setItem(KEY, lastRaw);
    } catch (error) {
      canSave = false;
      notice('浏览器未能保存记录，目前的操作只保留在本页。请导出备份后再关闭页面。');
    }
  }

  function mutate(change, message) {
    try {
      readFresh();
      save(change(C.advance(state, Date.now())));
      render();
      if (message) toast(message);
      return true;
    } catch (error) { toast(error.message); return false; }
  }

  function renderTasks() {
    const list = $('task-list');
    list.replaceChildren();
    const tasks = [...state.tasks].reverse().filter((task) => filter === 'all' || (filter === 'done' ? task.completedAt !== null : task.completedAt === null));
    for (const task of tasks) {
      const row = document.createElement('li');
      row.className = 'task-row' + (task.completedAt !== null ? ' done' : '');
      const label = document.createElement('label');
      label.className = 'task-check';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = task.completedAt !== null; check.dataset.task = task.id;
      const text = document.createElement('span');
      text.className = 'task-text'; text.textContent = task.title;
      label.append(check, text);
      const flower = document.createElement('span');
      flower.className = 'plant-label'; flower.textContent = task.completedAt !== null ? flowers[task.plant] : '🌱'; flower.setAttribute('aria-hidden', 'true');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'task-delete'; remove.textContent = '×'; remove.dataset.delete = task.id; remove.setAttribute('aria-label', `删除任务：${task.title}`);
      row.append(label, flower, remove); list.append(row);
    }
    $('empty-state').hidden = tasks.length > 0;
    $('empty-state').querySelector('p').textContent = state.tasks.length === 0 ? '花园在等你的第一件小事。' : filter === 'done' ? '还没有开花的小事，慢慢来。' : '这里暂时没有待完成的小事。';
    $('empty-state').querySelector('small').textContent = state.tasks.length === 0 ? '不用很大，能开始就很好。' : '每一份进步都会留在花园里。';
    $('task-count').textContent = `${state.tasks.length} 项任务`;
  }

  function drawGarden() {
    const canvas = $('garden');
    const ctx = canvas.getContext('2d');
    const shown = state.tasks.slice(-24);
    const done = shown.filter((task) => task.completedAt !== null).length;
    canvas.setAttribute('aria-label', `像素花园：展示最近 ${shown.length} 项任务，${done} 朵花，${shown.length - done} 棵嫩芽。`);
    $('garden-count').textContent = shown.length ? `${done} 朵花 · ${shown.length - done} 棵芽${state.tasks.length > 24 ? '（最近 24 项）' : ''}` : '等待第一颗种子';
    const night = state.sky === 'night';
    $('sky-button').textContent = night ? '☀ 切换日景' : '☾ 切换夜景';
    $('sky-button').setAttribute('aria-pressed', String(night));
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    rect(0, 0, 320, 166, night ? '#253c4a' : '#e4efdf');
    if (night) {
      for (const [x, y] of [[12, 18], [91, 15], [174, 29], [218, 13], [138, 39], [301, 45], [274, 29]]) { rect(x, y, 2, 2, '#d0dfb7'); }
      rect(39, 18, 13, 14, '#f2df9a'); rect(45, 15, 10, 4, '#f2df9a'); rect(45, 18, 11, 9, '#253c4a');
    } else {
      rect(32, 17, 17, 18, '#ebc967'); rect(36, 13, 9, 4, '#ebc967'); rect(36, 35, 9, 4, '#ebc967');
      rect(26, 23, 4, 5, '#f1d889'); rect(51, 23, 4, 5, '#f1d889');
      for (const [x, y] of [[76, 24], [170, 14], [272, 38]]) { rect(x, y, 24, 5, '#fbfaf0'); rect(x + 5, y - 4, 13, 4, '#fbfaf0'); rect(x + 21, y + 2, 8, 3, '#fbfaf0'); }
    }
    const hills = night ? ['#486252', '#344f42', '#3c5944'] : ['#c5d8b7', '#adca9c', '#a2bf8c'];
    for (let x = 0; x < 320; x += 8) { const y = 58 + Math.round(Math.sin(x / 37) * 6); rect(x, y, 8, 40, hills[0]); }
    for (let x = 0; x < 320; x += 8) { const y = 71 + Math.round(Math.cos(x / 29) * 4); rect(x, y, 8, 29, hills[1]); }
    rect(0, 89, 320, 77, night ? '#496046' : '#b4cf8e');
    const tree = (x, y, small) => {
      rect(x + 10, y + 17, 5, 21, night ? '#6a6650' : '#9b8057');
      rect(x + 4, y + 5, 20, small ? 17 : 23, night ? '#335844' : '#779c66');
      rect(x, y + 12, 27, 12, night ? '#335844' : '#779c66');
      rect(x + 8, y, 13, 7, night ? '#42684b' : '#8eb575');
      rect(x + 4, y + 10, 6, 9, night ? '#42684b' : '#8eb575');
    };
    tree(8, 48, false); tree(287, 55, true);
    // 栅栏与长椅是装饰；任务会种在下方的 24 个花位。
    for (let x = 35; x < 285; x += 13) { rect(x, 78, 3, 15, night ? '#899279' : '#e4ddb2'); }
    rect(34, 82, 252, 3, night ? '#899279' : '#e4ddb2');
    rect(61, 75, 31, 3, '#aa8557'); rect(61, 80, 31, 3, '#aa8557'); rect(65, 83, 3, 8, '#826b48'); rect(86, 83, 3, 8, '#826b48');
    rect(10, 98, 300, 61, night ? '#a28a63' : '#c8a475');
    rect(14, 101, 292, 54, night ? '#65553e' : '#9d8256');
    rect(14, 103, 292, 2, night ? '#706148' : '#b69765');
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 8; col++) {
        const index = row * 8 + col;
        const x = 32 + col * 36; const y = 115 + row * 17;
        rect(x - 8, y + 2, 18, 2, night ? '#524935' : '#876d48');
        const task = shown[index];
        if (!task) { rect(x, y, 2, 1, '#bfac79'); continue; }
        const green = night ? '#8aac67' : '#547f42';
        if (task.completedAt === null) {
          rect(x, y - 7, 2, 9, green); rect(x - 4, y - 6, 4, 3, '#84a85e'); rect(x + 2, y - 9, 4, 3, '#84a85e');
        } else {
          const petals = ['#f3df9a', '#e49696', '#eebcc4', '#e4b85b', '#b6a2d9', '#d79281'];
          rect(x, y - 12, 2, 14, green); rect(x - 5, y - 5, 5, 3, green); rect(x + 2, y - 8, 4, 3, green);
          const color = petals[task.plant];
          rect(x - 3, y - 17, 8, 7, color); rect(x - 5, y - 15, 12, 3, color); rect(x, y - 15, 3, 3, '#b68043');
          rect(x - 2, y - 17, 2, 2, '#fff1c4');
        }
      }
    }
    rect(10, 156, 300, 4, night ? '#857450' : '#b58e61');
    for (const [x, y] of [[2, 146], [315, 117], [5, 104], [286, 164], [49, 163]]) { rect(x, y, 2, 4, night ? '#75875b' : '#83a263'); rect(x - 2, y + 1, 2, 2, night ? '#75875b' : '#83a263'); }
    if (night && done > 0) for (const [x, y] of [[74, 95], [230, 91], [155, 84]]) rect(x, y, 2, 2, '#e7d99a');
  }

  function renderTimer(now) {
    const f = state.focus;
    const ms = C.remaining(state, now);
    $('timer').textContent = C.formatClock(ms);
    $('timer').setAttribute('aria-label', `剩余时间 ${C.formatClock(ms)}`);
    $('timer-label').textContent = f.status === 'running' ? '正在慢慢专注' : f.status === 'paused' ? '休息一下，随时继续' : '准备好就开始';
    $('focus-button').textContent = f.status === 'running' ? 'Ⅱ  暂停一下' : f.status === 'paused' ? '▶  继续专注' : '▶  开始专注';
    $('reset-button').disabled = f.status === 'idle';
    $('duration').disabled = f.status !== 'idle';
    $('custom-minutes').disabled = f.status !== 'idle';
    $('apply-duration').disabled = f.status !== 'idle';
    $('timer-ring').style.setProperty('--progress', `${360 * (1 - ms / f.durationMs)}deg`);
    document.title = f.status === 'running' ? `${C.formatClock(ms)} · 专注花园` : '像素专注花园 · 小事也会开花';
  }

  function render() {
    const now = Date.now();
    const metrics = C.metrics(state, now);
    $('metric-today').textContent = metrics.today;
    $('metric-pending').textContent = metrics.pending;
    $('metric-minutes').textContent = metrics.minutes;
    $('today-label').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
    const minutes = state.focus.durationMs / C.MINUTE;
    $('duration').value = [15, 25, 45].includes(minutes) ? String(minutes) : 'custom';
    $('custom-duration').hidden = $('duration').value !== 'custom';
    $('custom-minutes').value = minutes;
    renderTasks(); drawGarden(); renderTimer(now);
  }

  function tick() {
    const before = state;
    readFresh();
    const next = C.advance(state, Date.now());
    if (next !== state) {
      const minutes = state.focus.durationMs / C.MINUTE;
      save(next); render(); toast(`这一轮专注完成，记下了 ${minutes} 分钟。休息一下吧！`);
    } else if (state !== before) render();
    else {
      renderTimer(Date.now());
      const metrics = C.metrics(state, Date.now());
      $('metric-today').textContent = metrics.today;
    }
  }

  $('task-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (mutate((s) => C.addTask(s, $('task-input').value, uid(), Date.now()), '一颗小种子种下了。')) { $('task-input').value = ''; $('task-input').focus(); }
  });
  document.querySelectorAll('[data-suggestion]').forEach((button) => button.addEventListener('click', () => mutate((s) => C.addTask(s, button.dataset.suggestion, uid(), Date.now()), '一颗小种子种下了。')));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    renderTasks();
  }));
  $('task-list').addEventListener('change', (event) => {
    if (event.target.dataset.task) {
      const id = event.target.dataset.task; const checked = event.target.checked;
      mutate((s) => C.setTaskDone(s, id, checked, Date.now()), checked ? '又一朵小花开了。做得不错！' : '重新种成嫩芽，慢慢完成。');
      const input = [...$('task-list').querySelectorAll('input')].find((item) => item.dataset.task === id);
      input?.focus();
    }
  });
  $('task-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete]');
    if (button) mutate((s) => C.deleteTask(s, button.dataset.delete), '已移除这项任务和对应的植物。');
  });
  $('sky-button').addEventListener('click', () => mutate((s) => C.setSky(s, s.sky === 'day' ? 'night' : 'day')));
  $('duration').addEventListener('change', () => {
    if ($('duration').value === 'custom') { $('custom-duration').hidden = false; $('custom-minutes').focus(); }
    else mutate((s) => C.selectDuration(s, Number($('duration').value)));
  });
  $('apply-duration').addEventListener('click', () => mutate((s) => C.selectDuration(s, Number($('custom-minutes').value)), '专注时长已调整。'));
  $('focus-button').addEventListener('click', () => mutate((s) => s.focus.status === 'running' ? C.pauseFocus(s, Date.now()) : C.startFocus(s, Date.now(), uid())));
  $('reset-button').addEventListener('click', () => mutate((s) => C.resetFocus(s, Date.now()), '这一轮已重置，准备好再开始。'));

  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export-button').addEventListener('click', () => {
    tick();
    const date = new Date();
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    download(blockedRaw !== null ? blockedRaw : JSON.stringify(state, null, 2), `专注花园${blockedRaw !== null ? '原始记录' : '备份'}-${stamp}.json`);
    toast(blockedRaw !== null ? '已导出无法读取的原始记录，可保留用于恢复。' : '备份已导出，记得保存好。');
  });
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files[0];
    try {
      if (!file) return;
      if (file.size > 1_048_576) throw new Error('备份文件过大，请选择本工具导出的 JSON 文件。');
      const imported = C.validateState(JSON.parse(await file.text()));
      if (!window.confirm('导入备份会替换当前任务和专注记录。已经保留需要的备份了吗？')) return;
      canSave = true; blockedRaw = null; $('storage-notice').hidden = true;
      save(C.advance(imported, Date.now())); render(); toast('花园已经从备份恢复。');
    } catch (error) { toast(`导入失败：${error.message}`); }
    finally { $('import-file').value = ''; }
  });
  window.addEventListener('storage', (event) => { if (event.key === KEY || event.key === null) tick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  readFresh();
  const settled = C.advance(state, Date.now());
  if (settled !== state) { save(settled); toast('上次的专注已结束，记录已经补上。'); }
  render();
  setInterval(tick, 500);
})();
