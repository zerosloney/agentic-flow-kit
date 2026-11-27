// pre-shell-check.test.mjs — E9-H1/H2 回归：deny/ask 门禁与绕钩别名不得被 shell 展开或
// `-c` 紧贴写法携带。驱动**真实 hook 文件**（stdin 喂宿主 payload），清单读临时项目内的
// 安装副本（FLOW_KIT_PROJECT_ROOT 指向 .agents/hooks/gates.json），不 mock 内部函数。
// 表驱动：每行 [命令, 期望判定, 守的边界]；无输出 = 放行是宿主约定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'pre-shell-check.cjs');

// 临时项目取安装后形态：.agents/install-manifest.json + .agents/hooks/gates.json。
function makeProject() {
  const dir = makeTmp('fk-pre-shell-');
  fs.mkdirSync(path.join(dir, '.agents', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install-manifest.json'), '{"kit":"agentic-flow-kit"}\n');
  fs.copyFileSync(
    path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'gates.json'),
    path.join(dir, '.agents', 'hooks', 'gates.json')
  );
  return dir;
}

const PROJECT = makeProject();

function invoke(command, toolName = 'Bash') {
  const payload = {
    session_id: 'pre-shell-check-test',
    hook_event_name: 'PreToolUse',
    cwd: PROJECT,
    tool_name: toolName,
    tool_input: { command }
  };
  const run = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: PROJECT },
    timeout: 60_000
  });
  assert.equal(run.status, 0, `hook exited ${run.status}: ${run.stderr}`);
  // 清单读取失败会走 FALLBACK_GATES 并在 stderr 告警——断言空 stderr 证明测的是安装副本清单。
  assert.equal(run.stderr, '', `hook stderr: ${run.stderr}`);
  const out = (run.stdout || '').trim();
  return out ? JSON.parse(out).hookSpecificOutput : null;
}

function decide(command, toolName = 'Bash') {
  const out = invoke(command, toolName);
  return out ? out.permissionDecision : 'allow';
}

const CASES = [
  // 既有判定：无展开命令与基线一致。
  ['git reset --hard', 'deny', '红线原文仍 deny'],
  ['drop database prod', 'deny', '红线原文仍 deny'],
  ['dotnet ef database update', 'deny', '红线原文仍 deny'],
  ['git push --force origin main', 'deny', '强推仍 deny'],
  ['git commit --no-verify -m x', 'deny', '长旗标仍 deny'],
  ['git commit -n -m x', 'deny', '短旗标仍 deny'],
  ['git -c alias.ci=commit ci -n', 'deny', '空格形态 -c 别名仍 deny'],
  ['rm -rf build', 'ask', 'ask 原文仍 ask'],
  ['git checkout main', 'ask', 'ask 原文仍 ask'],
  ['git clean -n', 'ask', 'ask 原文仍 ask'],
  ['git branch -D feature', 'ask', 'ask 原文仍 ask'],
  ['git status', 'allow', '普通命令仍 allow'],
  ['npm run build', 'allow', '普通命令仍 allow'],
  ['rm -f log.txt', 'allow', '非递归删除仍 allow'],
  ['git reset HEAD file.txt', 'allow', '非 --hard 重置仍 allow'],
  // E9-H2：-c 一次性别名的紧贴/等价形态一律 deny。
  ['git -calias.ci=commit ci -n', 'deny', '紧贴 -calias 别名'],
  ['git -c=alias.ci=commit ci -n', 'deny', '-c=alias 别名'],
  ['git -c$IFS alias.ci=commit ci -n', 'deny', '$IFS 分隔的 -c 别名'],
  ['git -c "alias.ci=commit -n" ci', 'deny', '带空格引号值的 -c 别名'],
  // E9-H1：展开不得携带 deny 面红线（本段含展开 + 骨架命中 deny 清单 → deny）。
  ['git reset --$(echo hard)', 'deny', '命令替换携带 --hard'],
  ['git$IFS reset --hard', 'deny', '变量展开拼接命令名'],
  ['git reset --`echo hard`', 'deny', '反引号替换携带 --hard'],
  ['git re`set --hard', 'deny', 'PowerShell 反引号转义'],
  ["git reset --$'\\x68'ard", 'deny', 'ANSI-C 转义拼回 --hard'],
  ['sudo git reset --$(echo hard)', 'deny', '前缀命令 + 展开'],
  ['echo $HOME && git reset --$(echo hard)', 'deny', '另一段展开不豁免本段红线'],
  // D7 复核：ask 面命中只保持 ask，展开不升级为 deny（同段/他段同判）。
  ['rm -rf $DIR', 'ask', 'ask 原文 + 同段展开'],
  ['rm -r$Xf build', 'ask', '展开拼接 -rf 仍交用户确认'],
  ['git checkout $BRANCH', 'ask', 'git checkout + 同段展开'],
  ['git clean -$Xf', 'ask', 'git clean + 同段展开'],
  ['git checkout main && echo $HOME', 'ask', 'ask 原文 + 他段展开'],
  ['rm -rf build && echo $HOME', 'ask', 'rm -rf + 他段展开'],
  ['git status && echo $HOME', 'allow', '他段展开 + 普通命令不误拦'],
  // 无门禁关联的展开保持放行（不得把普通命令一刀切）。
  ['echo $HOME', 'allow', '普通变量展开不误拦'],
  ['echo $A $B', 'allow', '多变量展开不误拦'],
  ['cp $SRC $DST', 'allow', '普通命令 + 展开不误拦'],
  ['git status $F', 'allow', 'git 普通子命令 + 展开不误拦'],
  ['git log --format=$F', 'allow', 'git log + 展开不误拦'],
  ['git -c user.name=Bot status', 'allow', '普通 -c 配置不误拦'],
  ["git -c 'core.pager=alias.foo' status", 'allow', '非别名键的 alias. 字样不误拦'],
  ['npm run build $X', 'allow', '构建命令 + 展开不误拦'],
  // D7 复核 2：引号拆分与解释器包裹不得藏匿 deny/ask 命令。
  ['git "reset" --hard', 'deny', '双引号拆分子命令'],
  ["g''it reset --hard", 'deny', '空引号对拆分命令名'],
  ["g''''it reset --hard", 'deny', '多组空引号对拆分命令名'],
  ['git "reset" "--hard"', 'deny', '两个词均被引号拆分'],
  ['bash -c "git reset --hard"', 'deny', 'bash -c 包裹红线'],
  ["sh -c 'git reset --hard'", 'deny', 'sh -c 包裹红线'],
  ['bash -lc "git reset --hard"', 'deny', 'bash -lc 包裹红线'],
  ['bash -l -c "git reset --hard"', 'deny', 'bash -l -c 包裹红线'],
  ['zsh -c "git reset --hard"', 'deny', 'zsh 包裹红线'],
  ["dash -c 'git reset --hard'", 'deny', 'dash 包裹红线'],
  ['ksh -c "git reset --hard"', 'deny', 'ksh 包裹红线'],
  ["bash -c \"git 'reset' --hard\"", 'deny', 'payload 内再引号拆分'],
  ['git "checkout" main', 'ask', '引号拆分 ask 命令'],
  ['bash -c "git checkout main"', 'ask', 'bash 包裹 ask 仍 ask'],
  ["sh -c 'rm -rf build'", 'ask', 'sh 包裹 rm -rf 仍 ask'],
  ['bash -c "git status"', 'allow', '包裹普通命令不误拦'],
  ['bash --version', 'allow', '解释器旗标不误判'],
  // D8b 残口：shell 命令提及解锁标记 .agents/tmp/write-gate-until 一律 deny（写/读/删同判）。
  ['echo 30 > .agents/tmp/write-gate-until', 'deny', '重定向写出标记'],
  ['echo 30 > .agents\\tmp\\write-gate-until', 'deny', '反斜杠相对路径'],
  ['echo 30 > C:\\proj\\.agents\\tmp\\write-gate-until', 'deny', '反斜杠绝对路径'],
  ['printf 30 > /home/u/proj/.agents/tmp/write-gate-until', 'deny', '正斜杠绝对路径'],
  ['echo 30 > .agents/TMP/WRITE-GATE-UNTIL', 'deny', '大小写变体'],
  ["touch .agents/tmp/write-gate-'until'", 'deny', '引号拆分标记名'],
  ['tee .agents/tmp/write-gate-until', 'deny', 'tee 写出标记'],
  ['cp /tmp/x .agents/tmp/write-gate-until', 'deny', 'cp 写出标记'],
  ['mv /tmp/x .agents/tmp/write-gate-until', 'deny', 'mv 写出标记'],
  ['touch .agents/tmp/write-gate-until', 'deny', 'touch 写出标记'],
  ["node -e \"require('fs').writeFileSync('.agents/tmp/write-gate-until', '30')\"", 'deny', 'node 脚本字符串含标记'],
  ['cat .agents/tmp/write-gate-until', 'deny', '读取标记同判 deny'],
  ['echo 30 > .agents/tmp/other-marker', 'allow', '相邻路径不误拦'],
  ['ls .agents/tmp', 'allow', '目录列举不误拦'],
  ['echo write-gate', 'allow', '标记名前缀不误拦'],
  // 2026-11-27 逃逸整改：shell 各层转义只改文本不改 argv——反斜杠（POSIX）、反引号（PowerShell）、
  // 脱字符（cmd.exe）去壳后都是同一命令，不得因多一个转义符就落入 allow。
  ['g\\it reset --hard', 'deny', '反斜杠拆分命令名'],
  ['git res\\et --hard', 'deny', '反斜杠拆分子命令'],
  ['git reset --har\\d', 'deny', '反斜杠拆分旗标'],
  ['git push origin --forc\\e', 'deny', '反斜杠拆分强推旗标'],
  ['rm -r\\f build', 'ask', '反斜杠拆分 rm -rf'],
  ['git re`se`t --hard', 'deny', '反引号拆分命令名'],
  ['cmd /c "git re^set --hard"', 'deny', 'cmd 脱字符拆分命令名'],
  // ${IFS}/$IFS（大小写不敏感）是 bash 词分隔符：不得把前后词粘成单个骨架绕过展开门。
  ['git${IFS}reset${IFS}--hard', 'deny', 'IFS 分隔子命令与旗标'],
  ['git${IFS}checkout${IFS}main', 'ask', 'IFS 分隔 ask 命令'],
  ['rm${IFS}-rf${IFS}build', 'ask', 'IFS 分隔 rm -rf'],
  // 解释器 payload 是独立命令文本：清单之外的代码层守卫（绕钩旗标 / hooksPath）也必须逐 payload 过。
  ['bash -c "git commit --no-verify -m x"', 'deny', 'payload 长旗标绕钩'],
  ['sh -c "git commit -n -m x"', 'deny', 'payload 短旗标绕钩'],
  ['bash -c "git -c core.hooksPath=.evilhooks status"', 'deny', 'payload hooksPath 覆盖'],
  ['git -c core.hoo\\ksPath=.evilhooks status', 'deny', '反斜杠拆分 hooksPath 键名'],
  // PowerShell -EncodedCommand：编码载荷文本层不可见，代码级 fail-closed。
  ['powershell -NoProfile -EncodedCommand ZgBvAG8A', 'deny', '-EncodedCommand 编码载荷'],
  // git 全局选项不改变子命令语义：剥掉后与清单原文对齐。
  ['git --no-pager reset --hard', 'deny', '全局选项前缀仍 deny'],
  ['git -C . reset --hard', 'deny', '-C 前缀仍 deny'],
  ['git --no-pager checkout main', 'ask', '全局选项前缀 checkout 仍 ask'],
  ['git --no-pager branch -D feat', 'ask', '全局选项前缀删分支仍 ask'],
  // 清单匹配大小写不敏感：SQL 大写拼法不得放行。
  ['mysql -e "DROP DATABASE prod"', 'deny', '大写 DROP DATABASE 仍 deny'],
  // 对照组：新增视图不得误拦普通命令。
  ['node -v', 'allow', '普通命令仍 allow'],
  ['echo hi', 'allow', '普通命令仍 allow'],
  ['ls -la', 'allow', '普通命令仍 allow'],
  // 对照组例外：本测试项目无 .githooks，commit 走门卫在岗探针 fail-loud（既有行为，非清单门）。
  ['git commit -m "normal message"', 'deny', 'commit 走探针腿，非门禁误拦']
];

for (const [command, expected, why] of CASES) {
  test(`pre-shell-check: ${why} — ${command}`, () => {
    assert.equal(decide(command), expected, `${command}（${why}）`);
  });
}

// PowerShell 是 CodeBuddy 实测次通道：反引号在 PowerShell 里是转义符，同一 payload 必须同判。
test('pre-shell-check: PowerShell 通道同样拦展开红线', () => {
  assert.equal(decide('git re`set --hard', 'PowerShell'), 'deny');
  assert.equal(decide('git re`se`t --hard', 'PowerShell'), 'deny');
  assert.equal(decide('git reset --hard', 'PowerShell'), 'deny');
  assert.equal(decide('echo $HOME', 'PowerShell'), 'allow');
});

// 探针在临时项目必然 deny git push，故用 reason 区分是强推腿还是探针腿——证明 --forc\e 按 argv 判中。
test('pre-shell-check: 反斜杠拆分的强推旗标按强推腿 deny', () => {
  const out = invoke('git push origin --forc\\e');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /强制推送/);
});

// 对照组：新转义视图不得把普通提交消息判成清单红线。临时项目无 .githooks，commit 必然落探针腿，
// 故按 reason 区分——命中探针（钩子未挂载）才算对照通过，命中红线/绕钩即视图误拦。
test('pre-shell-check: 普通提交消息不被新转义视图误拦', () => {
  const out = invoke('git commit -m "normal message"');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /钩子未挂载/);
  assert.doesNotMatch(out.permissionDecisionReason, /项目红线/);
});

// D8b 要求 deny reason 明说「读取同判」——只读标记也拦，理由必须写清，避免被当成误拦绕过。
test('pre-shell-check: 读标记的 deny reason 说明读写删同判', () => {
  const out = invoke('cat .agents/tmp/write-gate-until');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /读/);
});

// 引号视图是 fail-closed（echo "git reset --hard" 也拦），但提交消息 heredoc 的 prose 保持既有豁免：
// 判定落在探针腿（非红线腿）即证明引号视图没把消息正文当执行。
test('pre-shell-check: 提交消息 heredoc 的红线字样不被引号视图误拦', () => {
  const out = invoke("git commit -m \"$(cat <<'EOF'\ngit reset --hard\nEOF\n)\"");
  assert.ok(out && out.permissionDecision === 'deny', '探针应对该提交给出判定');
  assert.doesNotMatch(out.permissionDecisionReason, /项目红线/);
});
