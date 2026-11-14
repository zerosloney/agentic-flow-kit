// flow-kit devcontainer：开发容器（R3-8 沙箱面）的声明检查与可构建性验证。
// 子命令：
//   check（缺省）——校验 .devcontainer/devcontainer.json + Dockerfile：镜像白名单、版本钉死、栈匹配。
//   build      ——用 docker 真构建一次镜像（"容器可构建"的证据）；docker 不在 PATH → 退出 2。
// 退出码沿用全局契约：0 通过、1 违规/构建失败、2 用法或环境失守（docker 缺失）。
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import { readManifest } from '../install/manifest.mjs';
import { checkDevcontainer, DEVCONTAINER_DOCKERFILE_REL, DEVCONTAINER_JSON_REL } from '../install/devcontainer.mjs';
import { resolveTarget } from './install.mjs';

function dockerAvailable() {
  const r = spawnSync('docker', ['--version'], { encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0;
}

export function devcontainerCommand({ args, t }) {
  const target = resolveTarget(args);
  const sub = String(args._[1] || 'check');
  const asJson = flag(args, 'json');
  const manifest = readManifest(target);

  if (sub === 'check') {
    const state = checkDevcontainer({ target, stack: manifest?.stack || null });
    if (asJson) {
      console.log(JSON.stringify({
        ok: state.ok,
        missing: state.missing,
        image: state.image,
        kitVersion: state.kitVersion,
        problems: state.problems,
        jsonRel: DEVCONTAINER_JSON_REL,
        dockerfileRel: DEVCONTAINER_DOCKERFILE_REL,
      }, null, 2));
      return state.ok ? 0 : 1;
    }
    if (state.missing) {
      console.log(t('devcontainer.missing', { path: DEVCONTAINER_JSON_REL }));
      return 1;
    }
    if (state.ok) {
      console.log(t('devcontainer.checkOk', { image: state.image, version: state.kitVersion }));
      return 0;
    }
    console.error(t('devcontainer.checkFailed', { problems: state.problems.join('; ') }));
    return 1;
  }

  if (sub === 'build') {
    const state = checkDevcontainer({ target, stack: manifest?.stack || null });
    if (!state.ok) {
      if (asJson) {
        console.log(JSON.stringify({ ok: false, stage: 'check', problems: state.problems }, null, 2));
      } else {
        console.error(t('devcontainer.checkFailed', { problems: state.problems.join('; ') }));
      }
      return 1;
    }
    if (!dockerAvailable()) {
      const message = t('devcontainer.dockerMissing');
      if (asJson) console.log(JSON.stringify({ ok: false, stage: 'build', reason: 'docker-missing', message }, null, 2));
      else console.error(message);
      return 2;
    }
    const tag = `flow-kit-devcontainer:${manifest?.stack || 'project'}`;
    const r = spawnSync('docker', ['build', '-f', DEVCONTAINER_DOCKERFILE_REL, '-t', tag, '.'], {
      cwd: target,
      stdio: asJson ? 'pipe' : 'inherit',
      encoding: 'utf8',
      windowsHide: true,
    });
    const ok = !r.error && r.status === 0;
    if (asJson) {
      console.log(JSON.stringify({
        ok,
        stage: 'build',
        image: tag,
        status: r.status,
        output: ok ? null : `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(-20).join('\n'),
      }, null, 2));
    } else if (ok) {
      console.log(t('devcontainer.buildOk', { image: tag }));
    } else {
      console.error(t('devcontainer.buildFailed', { image: tag }));
    }
    return ok ? 0 : 1;
  }

  const err = new Error(`unknown devcontainer subcommand: ${sub}（可用：check / build）`);
  err.code = 'BAD_COMMAND';
  throw err;
}
