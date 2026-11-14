// 一次性测试目录的统一入口：创建时登记，进程退出时删掉**本进程亲自创建**的目录。
// 背景：kit 的测试过去直接 fs.mkdtempSync 到 %TEMP%，进程退出不删——机器上因此堆出
//       5000+ 个一次性目录（flow-kit-* / fk-* / 各类业务前缀）。
// 口径：只删本进程登记过的明确路径（不做通配清扫），删除失败静默——清理不该让测试变红。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = new Set();
let registered = false;

function cleanup() {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响测试结论 */
    }
  }
  created.clear();
}

export function makeTmp(prefix = 'flow-kit-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.add(dir);
  if (!registered) {
    registered = true;
    process.on('exit', cleanup);
  }
  return dir;
}
