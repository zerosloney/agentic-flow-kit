// wiki-names-docs.test.mjs — 文档/技能/配置模板里的 wiki 路径随语言渲染：
// 英文安装不得残留中文 wiki 路径引用；中文安装不得残留未渲染的 {{wiki…}} 令牌；
// kit 侧模板只能使用合法的 wiki 令牌名（防拼写漂移）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { wikiTokens } from '../src/install/wiki-names.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

// 英文安装里不应出现的 wiki 路径/目录引用（中文协议名 + 路径分隔符，或看板文件名）。
const ZH_WIKI_REFERENCES = [
  'wiki/数据维护',
  'wiki/开发方案',
  'wiki/产品需求',
  'wiki/项目规范',
  'wiki/用户功能',
  'wiki/测试报告',
  '知识沉淀总览.html',
  'schema变更/',
  '数据修复/',
];

function tmpRepo(prefix) {
  const dir = makeTmp(prefix);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function install(dir, stack, lang) {
  const r = spawnSync(
    process.execPath,
    [BIN, 'install', '--agent', 'trae', '--stack', stack, '--lang', lang, '--target', '.'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' } },
  );
  assert.equal(r.status, 0, r.stderr);
}

// 安装树的文本文件：跳过 .git/、.agents/.kit/ 与安装清单，二进制按 NUL 字节判定。
function textFiles(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (next === '.git' || next === '.agents/.kit') continue;
      textFiles(root, next, out);
    } else if (next !== '.agents/install-manifest.json') {
      if (!fs.readFileSync(path.join(root, next)).includes(0)) out.push(next);
    }
  }
  return out.sort();
}

function scan(dir, files, predicate) {
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(dir, rel), 'utf8').split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      if (predicate(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
  return hits;
}

for (const stack of ['node', 'dotnet']) {
  test(`en install (${stack}) has no Chinese wiki path references`, () => {
    const dir = tmpRepo('flow-kit-wiki-docs-en-');
    install(dir, stack, 'en');
    const hits = scan(dir, textFiles(dir), (line) => ZH_WIKI_REFERENCES.some((ref) => line.includes(ref)));
    assert.deepEqual(hits, [], `Chinese wiki references left in an English install:\n${hits.join('\n')}`);
  });
}

for (const stack of ['node', 'dotnet']) {
  test(`zh-CN install (${stack}) renders every wiki token`, () => {
    const dir = tmpRepo('flow-kit-wiki-docs-zh-');
    install(dir, stack, 'zh-CN');
    const hits = scan(dir, textFiles(dir), (line) => line.includes('{{wiki'));
    assert.deepEqual(hits, [], `unrendered wiki tokens in a zh-CN install:\n${hits.join('\n')}`);

    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(
      agents.includes('wiki/知识沉淀总览.html'),
      'zh-CN install must keep the Chinese board path in AGENTS.md',
    );
  });
}

test('kit templates only use known wiki token names', () => {
  // wikiNamesMember 是 buildVars 直供的 engine.json options.wiki 成员，不属于 wikiTokens。
  const allowed = new Set([...Object.keys(wikiTokens('zh-CN')), 'wikiNamesMember']);
  const files = [
    ...textFiles(KIT, 'templates'),
    ...textFiles(KIT, 'locales'),
  ];
  const hits = scan(KIT, files, (line) => [...line.matchAll(/\{\{(wiki\w*)\}\}/g)].some(([, key]) => !allowed.has(key)));
  assert.deepEqual(hits, [], `unknown wiki tokens:\n${hits.join('\n')}`);
});
