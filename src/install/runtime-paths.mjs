import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, '..', '..');
// 运行时源与引擎模板同源：包安装后即可执行；实现文件随包分发，统一经运行时入口调起。
export const RUNTIME_ROOT = path.join(KIT_ROOT, 'templates', 'engine', '.agents');
export const RUNTIME_SCRIPTS = path.join(RUNTIME_ROOT, 'scripts');
export const RUNTIME_HOOKS = path.join(RUNTIME_ROOT, 'hooks');
