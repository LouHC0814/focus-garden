(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FocusGarden = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const MAX_TASKS = 300;
  const MINUTE = 60_000;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const timestamp = (value) => whole(value, 0, 8_640_000_000_000_000);
  const idOkay = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  const idle = (minutes) => ({ status: 'idle', id: null, durationMs: minutes * MINUTE, remainingMs: minutes * MINUTE, deadline: null, startedAt: null });

  function initialState() {
    return { version: VERSION, tasks: [], focus: idle(25), stats: { sessions: 0, minutes: 0 }, recentSessionIds: [], sky: 'day' };
  }

  function validateState(value) {
    check(value && typeof value === 'object' && value.version === VERSION, '备份版本不支持。请导入本工具导出的 JSON 文件。');
    check(Array.isArray(value.tasks) && value.tasks.length <= MAX_TASKS, '任务列表无效，最多保留 300 项任务。');
    const taskIds = new Set();
    for (const task of value.tasks) {
      check(task && idOkay(task.id) && !taskIds.has(task.id), '任务编号无效或重复。');
      taskIds.add(task.id);
      check(typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 80, '任务名称须为 1—80 个字符。');
      check(timestamp(task.createdAt) && (task.completedAt === null || (timestamp(task.completedAt) && task.completedAt >= task.createdAt)), '任务时间无效。');
      check(whole(task.plant, 0, 5), '植物类型无效。');
    }
    const focus = value.focus;
    check(focus && ['idle', 'running', 'paused'].includes(focus.status), '计时器状态无效。');
    check(whole(focus.durationMs, MINUTE, 180 * MINUTE) && focus.durationMs % MINUTE === 0, '专注时长须为 1—180 分钟。');
    check(whole(focus.remainingMs, 0, focus.durationMs), '剩余时间无效。');
    if (focus.status === 'idle') {
      check(focus.id === null && focus.deadline === null && focus.startedAt === null && focus.remainingMs === focus.durationMs, '空闲计时器数据无效。');
    } else {
      check(idOkay(focus.id) && timestamp(focus.startedAt), '专注记录编号或开始时间无效。');
      check(focus.status === 'running' ? timestamp(focus.deadline) && focus.deadline >= focus.startedAt : focus.deadline === null, '计时结束时间无效。');
      check(focus.remainingMs > 0, '暂停或运行中的计时器必须有剩余时间。');
    }
    check(value.stats && whole(value.stats.sessions, 0, 10_000_000) && whole(value.stats.minutes, 0, 1_800_000_000), '累计专注记录无效。');
    check(value.stats.minutes >= value.stats.sessions && value.stats.minutes <= value.stats.sessions * 180, '累计分钟与完成次数不一致。');
    check(Array.isArray(value.recentSessionIds) && value.recentSessionIds.length <= 50 && value.recentSessionIds.every(idOkay), '专注记录编号列表无效。');
    check(new Set(value.recentSessionIds).size === value.recentSessionIds.length && value.recentSessionIds.length <= value.stats.sessions, '专注记录编号重复或数量不一致。');
    check(['day', 'night'].includes(value.sky), '花园场景无效。');
    // 只复制已知字段，避免把无关内容带入应用状态。
    return {
      version: VERSION,
      tasks: value.tasks.map((t) => ({ id: t.id, title: t.title.trim(), createdAt: t.createdAt, completedAt: t.completedAt, plant: t.plant })),
      focus: { status: focus.status, id: focus.id, durationMs: focus.durationMs, remainingMs: focus.remainingMs, deadline: focus.deadline, startedAt: focus.startedAt },
      stats: { sessions: value.stats.sessions, minutes: value.stats.minutes },
      recentSessionIds: [...value.recentSessionIds], sky: value.sky,
    };
  }

  function addTask(state, title, id, now) {
    const clean = title.trim();
    check(clean.length > 0 && clean.length <= 80, '给这件小事起一个 1—80 字的名字吧。');
    check(state.tasks.length < MAX_TASKS, '已经有 300 项任务，先整理一些旧任务吧。');
    check(idOkay(id) && !state.tasks.some((task) => task.id === id) && timestamp(now), '任务编号或时间无效。');
    const next = copy(state);
    const hash = [...id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
    next.tasks.push({ id, title: clean, createdAt: now, completedAt: null, plant: hash % 6 });
    return next;
  }

  function setTaskDone(state, id, done, now) {
    const next = copy(state);
    const task = next.tasks.find((item) => item.id === id);
    check(task, '这项任务已经不存在了。');
    check(timestamp(now), '当前设备时间无效。');
    task.completedAt = done ? task.completedAt ?? Math.max(now, task.createdAt) : null;
    return next;
  }

  function deleteTask(state, id) {
    const next = copy(state);
    next.tasks = next.tasks.filter((item) => item.id !== id);
    return next;
  }

  function remaining(state, now) {
    const f = state.focus;
    return f.status === 'running' ? Math.max(0, Math.min(f.durationMs, f.deadline - now)) : f.remainingMs;
  }

  function advance(state, now) {
    if (state.focus.status !== 'running' || remaining(state, now) > 0) return state;
    const next = copy(state);
    if (!next.recentSessionIds.includes(next.focus.id)) {
      next.stats.sessions += 1;
      next.stats.minutes += next.focus.durationMs / MINUTE;
      next.recentSessionIds.push(next.focus.id);
      next.recentSessionIds = next.recentSessionIds.slice(-50);
    }
    next.focus = idle(next.focus.durationMs / MINUTE);
    return next;
  }

  function selectDuration(state, minutes) {
    check(state.focus.status === 'idle', '先结束或重置这一轮，再调整时长。');
    check(whole(minutes, 1, 180), '专注时长须为 1—180 分钟。');
    const next = copy(state);
    next.focus = idle(minutes);
    return next;
  }

  function startFocus(state, now, id) {
    const current = advance(state, now);
    if (current.focus.status === 'running') return current;
    check(timestamp(now) && idOkay(id), '专注开始时间或编号无效。');
    const next = copy(current);
    if (next.focus.status === 'idle') {
      next.focus.id = id;
      next.focus.startedAt = now;
    }
    next.focus.deadline = now + next.focus.remainingMs;
    next.focus.status = 'running';
    return next;
  }

  function pauseFocus(state, now) {
    const current = advance(state, now);
    if (current.focus.status !== 'running') return current;
    const next = copy(current);
    next.focus.remainingMs = remaining(current, now);
    next.focus.deadline = null;
    next.focus.status = 'paused';
    return next;
  }

  function resetFocus(state, now) {
    const next = copy(advance(state, now));
    next.focus = idle(next.focus.durationMs / MINUTE);
    return next;
  }

  function setSky(state, sky) {
    check(['day', 'night'].includes(sky), '花园场景无效。');
    const next = copy(state);
    next.sky = sky;
    return next;
  }

  function metrics(state, now) {
    const dateKey = (time) => { const d = new Date(time); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    return {
      done: state.tasks.filter((task) => task.completedAt !== null).length,
      pending: state.tasks.filter((task) => task.completedAt === null).length,
      today: state.tasks.filter((task) => task.completedAt !== null && dateKey(task.completedAt) === dateKey(now)).length,
      minutes: state.stats.minutes,
    };
  }

  function formatClock(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  return { VERSION, MAX_TASKS, MINUTE, initialState, validateState, addTask, setTaskDone, deleteTask, remaining, advance, selectDuration, startFocus, pauseFocus, resetFocus, setSky, metrics, formatClock };
});
