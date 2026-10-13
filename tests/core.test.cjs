const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../dist/core.js');
const NOW = new Date('2026-10-13T09:00:00+08:00').getTime();

test('添加、完成、撤销、删除任务不修改旧状态', () => {
  const empty = C.initialState();
  const added = C.addTask(empty, '  背 10 个单词  ', 'task-1', NOW);
  assert.equal(empty.tasks.length, 0);
  assert.equal(added.tasks[0].title, '背 10 个单词');
  const done = C.setTaskDone(added, 'task-1', true, NOW + 1000);
  assert.equal(done.tasks[0].completedAt, NOW + 1000);
  assert.equal(added.tasks[0].completedAt, null);
  assert.equal(C.setTaskDone(done, 'task-1', true, NOW + 2000).tasks[0].completedAt, NOW + 1000);
  assert.equal(C.setTaskDone(done, 'task-1', false, NOW + 3000).tasks[0].completedAt, null);
  assert.equal(C.deleteTask(done, 'task-1').tasks.length, 0);
});

test('拒绝空任务、过长任务、重复编号和超出任务上限', () => {
  const empty = C.initialState();
  assert.throws(() => C.addTask(empty, '  ', 'a', NOW));
  assert.throws(() => C.addTask(empty, '字'.repeat(81), 'a', NOW));
  let full = empty;
  for (let i = 0; i < 300; i++) full = C.addTask(full, `任务 ${i}`, `task-${i}`, NOW);
  assert.throws(() => C.addTask(full, '重复', 'task-0', NOW));
  assert.throws(() => C.addTask(full, '超出', 'task-301', NOW));
});

test('计时依据结束时间，页面未运行期间也能追上进度', () => {
  const state = C.startFocus(C.selectDuration(C.initialState(), 1), NOW, 'session-1');
  assert.equal(C.remaining(state, NOW + 35_000), 25_000);
  const ended = C.advance(state, NOW + 90_000);
  assert.equal(ended.stats.sessions, 1);
  assert.equal(ended.stats.minutes, 1);
  assert.equal(ended.focus.status, 'idle');
  assert.equal(C.advance(ended, NOW + 100_000).stats.sessions, 1);
});

test('暂停不消耗专注时间，继续时保留本轮编号', () => {
  const running = C.startFocus(C.selectDuration(C.initialState(), 1), NOW, 'session-1');
  const paused = C.pauseFocus(running, NOW + 20_000);
  assert.equal(paused.focus.remainingMs, 40_000);
  assert.equal(C.remaining(paused, NOW + 900_000), 40_000);
  const resumed = C.startFocus(paused, NOW + 120_000, 'session-unused');
  assert.equal(resumed.focus.id, 'session-1');
  assert.equal(resumed.focus.deadline, NOW + 160_000);
  assert.equal(C.advance(resumed, NOW + 160_000).stats.minutes, 1);
});

test('重置未完成的计时不奖励分钟，已结束的计时先结算', () => {
  const running = C.startFocus(C.selectDuration(C.initialState(), 1), NOW, 'session-1');
  assert.equal(C.resetFocus(running, NOW + 20_000).stats.minutes, 0);
  assert.equal(C.resetFocus(running, NOW + 60_000).stats.minutes, 1);
  assert.equal(C.pauseFocus(running, NOW + 60_000).focus.status, 'idle');
});

test('已记账的计时编号不会被重复奖励', () => {
  const first = C.startFocus(C.selectDuration(C.initialState(), 1), NOW, 'session-1');
  const ended = C.advance(first, NOW + 60_000);
  const repeated = C.startFocus(ended, NOW + 70_000, 'session-1');
  assert.equal(C.advance(repeated, NOW + 130_000).stats.sessions, 1);
});

test('时长限制与运行中修改保护', () => {
  for (const minutes of [0, 181, 1.5, NaN, Infinity]) assert.throws(() => C.selectDuration(C.initialState(), minutes));
  const running = C.startFocus(C.initialState(), NOW, 's');
  assert.throws(() => C.selectDuration(running, 15));
  assert.equal(C.startFocus(running, NOW + 10_000, 'another'), running);
});

test('备份可以往返，包括暂停与运行状态', () => {
  const withTask = C.addTask(C.initialState(), '<img src=x onerror=alert(1)>', 'task-1', NOW);
  const running = C.startFocus(withTask, NOW, 'session-1');
  for (const state of [withTask, running, C.pauseFocus(running, NOW + 1000)]) {
    assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(state))), state);
  }
});

test('备份验证拒绝畸形数据且移除未知字段', () => {
  const valid = C.addTask(C.initialState(), '小事', 'task-1', NOW);
  const mutations = [
    (s) => { s.version = 999; },
    (s) => { s.tasks.push({ ...s.tasks[0] }); },
    (s) => { s.tasks[0].title = ''; },
    (s) => { s.tasks[0].completedAt = NOW - 1; },
    (s) => { s.tasks[0].plant = 7; },
    (s) => { s.focus.status = 'broken'; },
    (s) => { s.focus.durationMs = 0; },
    (s) => { s.focus.deadline = NOW; },
    (s) => { s.stats.sessions = 2; },
    (s) => { s.recentSessionIds = ['s', 's']; },
    (s) => { s.sky = 'unknown'; },
  ];
  for (const mutate of mutations) {
    const broken = JSON.parse(JSON.stringify(valid)); mutate(broken);
    assert.throws(() => C.validateState(broken));
  }
  const extra = JSON.parse(JSON.stringify(valid)); extra.untrusted = '去掉';
  assert.equal(C.validateState(extra).untrusted, undefined);
  assert.throws(() => C.validateState(null));
});

test('过期的运行中备份恢复时只补记一次', () => {
  const old = C.startFocus(C.initialState(), NOW, 'old-session');
  const restored = C.validateState(JSON.parse(JSON.stringify(old)));
  const settled = C.advance(restored, NOW + 30 * C.MINUTE);
  assert.equal(settled.stats.minutes, 25);
  assert.equal(C.advance(settled, NOW + 31 * C.MINUTE).stats.minutes, 25);
});

test('今天完成数按本地日历统计，累计专注独立保存', () => {
  let state = C.addTask(C.initialState(), '昨天', 'y', NOW - 24 * 60 * C.MINUTE);
  state = C.setTaskDone(state, 'y', true, NOW - 24 * 60 * C.MINUTE);
  state = C.addTask(state, '今天', 't', NOW);
  state = C.setTaskDone(state, 't', true, NOW);
  state = C.addTask(state, '待办', 'p', NOW);
  assert.deepEqual(C.metrics(state, NOW), { done: 2, pending: 1, today: 1, minutes: 0 });
});

test('显示计时向上取整，负值不会显示负数', () => {
  assert.equal(C.formatClock(1500000), '25:00');
  assert.equal(C.formatClock(1001), '00:02');
  assert.equal(C.formatClock(1), '00:01');
  assert.equal(C.formatClock(-1), '00:00');
});

test('日夜场景可以切换并写进备份', () => {
  assert.equal(C.validateState(C.setSky(C.initialState(), 'night')).sky, 'night');
  assert.throws(() => C.setSky(C.initialState(), 'invalid'));
});
