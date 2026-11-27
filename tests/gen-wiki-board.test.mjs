import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'gen-wiki-board.mjs');

test('wiki 文件名中的 $ 替换序列按字面写入看板 DATA 块', () => {
  const root = makeTmp('wiki-board-inject-');
  const wiki = path.join(root, 'wiki');
  const topic = '边界主题';
  const fileName = "doc $& $' $` 样例.md";
  fs.mkdirSync(path.join(wiki, topic), { recursive: true });
  fs.writeFileSync(path.join(wiki, topic, fileName), '# 样例\n', 'utf8');

  fs.writeFileSync(
    path.join(wiki, 'INDEX.md'),
    [
      '# 知识总览',
      '',
      '| 主题 | 文件数 | 用途 |',
      '|---|---|---|',
      `| ${topic} | 1 | 注入样例 |`,
      '',
      '合计：**1 份**知识文档，**1 个主题**',
      '',
      '## 文件 → 主题 → 归属目录 映射表',
      '',
      '## 命名规则',
      '',
      '- 命名规则示例。',
      '',
    ].join('\n'),
    'utf8',
  );

  const boardName = '知识沉淀总览.html';
  fs.writeFileSync(
    path.join(wiki, boardName),
    '<html><body><script>\nconst DATA = {\n  "summary": {},\n  "topics": []\n};\n</script></body></html>\n',
    'utf8',
  );

  const run = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const board = fs.readFileSync(path.join(wiki, boardName), 'utf8');
  assert.ok(
    board.includes(`"file": ${JSON.stringify(fileName)}`),
    '文件名须按字面写入 DATA，$&、$\' 与 `$` 不得被替换引擎解释',
  );
  assert.equal((board.match(/const DATA = /g) || []).length, 1);
  assert.ok(board.includes('</script></body></html>'), '模板尾部须保留');
});
