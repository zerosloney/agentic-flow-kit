import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripAnsi,
  visualWidth,
  cyan,
  red,
  SPINNER_FRAMES,
  spinner,
  progress,
  progressLine,
  box,
} from '../src/tui/ansi.mjs';
import { createSelect, createMultiSelect, createConfirm } from '../src/tui/widgets.mjs';

const ESC = '\x1b'; // 与 ansi.mjs 内部实现一致的转义起始符

test('select: cursor movement, wrap-around and submit', () => {
  const items = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', hint: '第二个' },
    { value: 'c', label: 'Gamma' },
  ];
  const w = createSelect({ items });
  const v0 = w.view();
  assert.equal(v0.length, items.length);
  assert.ok(v0[0].includes('❯'));
  assert.ok(v0[0].includes('Alpha'));

  // down down up: cursor 0 -> 1 -> 2 -> 1
  w.onKey({ name: 'down' });
  w.onKey({ name: 'down' });
  w.onKey({ name: 'up' });
  const v = w.view();
  assert.ok(v[1].includes('❯'), 'cursor should stay on item 2 (index 1)');
  assert.ok(!v[0].includes('❯'));
  assert.ok(!v[2].includes('❯'));
  assert.ok(v[1].includes('第二个'), 'hint follows the output');

  // down on last item wraps to the first
  const w2 = createSelect({ items, cursor: 2 });
  w2.onKey({ name: 'down' });
  assert.ok(w2.view()[0].includes('❯'));

  // enter returns the current item value; unrelated keys return undefined
  assert.deepEqual(w.onKey({ name: 'return' }), { value: 'b' });
  assert.equal(w.onKey({ name: 'x' }), undefined);
});

test('multiselect: toggle, select-all and min selection guard', () => {
  const items = [
    { value: 'a1', label: 'A1' },
    { value: 'b2', label: 'B2' },
    { value: 'c3', label: 'C3' },
  ];
  const w = createMultiSelect({ items, minMessage: '最少勾选 1 项' });
  w.onKey({ name: 'space' });
  assert.ok(w.view()[0].includes('◉'));
  assert.ok(w.view()[0].includes('✓'));

  // select all (sequence alone works) -> toggle again clears all
  w.onKey({ name: 'a', sequence: 'a' });
  assert.ok(w.view().every((line) => line.includes('◉')));
  w.onKey({ sequence: 'a' });
  assert.ok(w.view().every((line) => !line.includes('◉') && !line.includes('✓')));

  // enter with empty selection -> undefined + red hint line
  assert.equal(w.onKey({ name: 'return' }), undefined);
  const v = w.view();
  assert.equal(v.length, items.length + 1);
  assert.ok(v[v.length - 1].startsWith(ESC + '[31m'), 'hint line should be red');
  assert.ok(stripAnsi(v[v.length - 1]).includes('最少勾选 1 项'), 'should show the injected minMessage');

  // any key clears the error; space checks the current item, then enter succeeds
  w.onKey({ name: 'space' });
  assert.equal(w.view().length, items.length);
  assert.deepEqual(w.onKey({ name: 'return' }), { value: ['a1'] });
});

test('confirm: default, arrow keys and y/n (view is the two option rows only)', () => {
  const w1 = createConfirm({});
  assert.equal(w1.view().length, 2, 'view must hold exactly the two option rows');
  assert.deepEqual(w1.onKey({ name: 'return' }), { value: true });

  const w2 = createConfirm({});
  w2.onKey({ name: 'left' });
  const v2 = w2.view().map(stripAnsi);
  assert.ok(v2.some((line) => line.includes('❯ ● 否')));
  assert.deepEqual(w2.onKey({ name: 'return' }), { value: false });

  // n picks no directly
  const w3 = createConfirm({});
  w3.onKey({ name: 'n', sequence: 'n' });
  assert.ok(w3.view().map(stripAnsi).some((line) => line.includes('❯ ● 否')));
  assert.deepEqual(w3.onKey({ name: 'return' }), { value: false });

  // y flips back to yes; right toggles too
  w3.onKey({ name: 'y', sequence: 'y' });
  assert.deepEqual(w3.onKey({ name: 'return' }), { value: true });
  const w4 = createConfirm({});
  w4.onKey({ name: 'right' });
  assert.deepEqual(w4.onKey({ name: 'return' }), { value: false });
});

test('stripAnsi and visualWidth', () => {
  assert.equal(visualWidth('中文'), 4);
  assert.equal(visualWidth('ab'), 2);
  assert.equal(stripAnsi(cyan('hi')), 'hi');
  assert.equal(visualWidth(cyan('hi')), 2);
  assert.equal(stripAnsi(red('中') + '文'), '中文');
  assert.equal(visualWidth(red('中') + '文'), 4);
  assert.equal(cyan('x'), ESC + '[36mx' + ESC + '[39m');
});

test('progress: bar width and zero-division guard', () => {
  const p = progress(240, 342);
  assert.ok(p.includes('240/342'));
  const bars = (p.match(/[█░]/g) || []).length;
  assert.equal(bars, 24, '█+░ char count should equal the default width');
  assert.doesNotThrow(() => progress(0, 0));
  assert.ok(progress(0, 0).includes('0/0'));
  assert.equal((progress(0, 0).match(/░/g) || []).length, 24);
});

test('spinner and progressLine: frame wrap-around and escape prefix', () => {
  assert.equal(spinner(0), SPINNER_FRAMES[0]);
  assert.equal(spinner(SPINNER_FRAMES.length), SPINNER_FRAMES[0], 'must wrap by SPINNER_FRAMES.length');
  assert.equal(spinner(SPINNER_FRAMES.length + 2), SPINNER_FRAMES[2]);
  const line = progressLine(3, 342);
  assert.ok(line.startsWith('\r\x1b[2K'), 'progressLine must start with CR + erase-line');
  assert.ok(line.includes('\x1b[2K' + SPINNER_FRAMES[3]), 'frame index follows the done counter');
  assert.ok(line.includes('3/342'));
});

test('box: alignment with CJK and ANSI codes', () => {
  const lines = box('标题', ['plain line', cyan('青色') + '中文', '']);
  const widths = lines.map((l) => visualWidth(stripAnsi(l)));
  assert.equal(new Set(widths).size, 1, 'all lines must share the same visual width after stripAnsi');
  assert.ok(stripAnsi(lines[0]).includes('标题'));
  // empty-row structure matches the body: │ ... │
  const empty = stripAnsi(lines[3]);
  assert.ok(empty.startsWith('│') && empty.endsWith('│'));
});

test('SPINNER_FRAMES: every frame is a single char', () => {
  assert.ok(SPINNER_FRAMES.length > 1);
  for (const f of SPINNER_FRAMES) assert.equal(f.length, 1);
});
