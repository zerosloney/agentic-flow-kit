import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'gen-dev-tour.mjs');

test('计划文本中的 $ 替换序列按字面注入，不破坏 DATA 脚本', () => {
  const root = makeTmp('dev-tour-inject-');
  fs.mkdirSync(path.join(root, '.agents', 'board'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'board', 'dev-tour.html'),
    '<!doctype html>\n<script>\nconst DATA = __TOUR_DATA__;\nconst FILE = __TOUR_FILE__;\nconst MODE = __TOUR_MODE__;\n</script>\n',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  const title = "注入 $& 与 $' 与 `$` 的计划";
  const docPath = path.join(root, 'workflow', 'plans', 'inject.md');
  fs.writeFileSync(
    docPath,
    `# ${title}\n\n## 任务拆解\n\n### T1 修改注入样例\n- 文件：src/inject.mjs\n`,
    'utf8',
  );

  const outPath = path.join(root, 'tour.html');
  const run = spawnSync(process.execPath, [SCRIPT, docPath, '--out', outPath, '--no-diff'], {
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const html = fs.readFileSync(outPath, 'utf8');
  assert.ok(html.includes(title), '标题须按字面保留 $&、$\' 与 `$` 序列');
  assert.equal((html.match(/<\/script>/g) || []).length, 1, '替换序列不得把模板尾部注入 DATA');
  assert.equal((html.match(/const DATA = /g) || []).length, 1);
});
