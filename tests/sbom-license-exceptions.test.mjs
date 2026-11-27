// tests/sbom-license-exceptions.test.mjs
// 许可证豁免键（<pkg>@<version>）必须能匹配 scoped 包（@scope/pkg@1.0.0）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { judgeLicense } from '../templates/engine/.agents/scripts/sbom-license.mjs';

function policyWith(exceptions) {
  return {
    allow: ['MIT'],
    deny: ['AGPL-3.0'],
    exceptions,
    unknownAction: 'deny',
    failOn: 'deny',
  };
}

test('版本化豁免匹配 scoped 包', () => {
  const policy = policyWith({ '@scope/pkg@1.0.0': 'ticket 123' });
  assert.equal(
    judgeLicense({ name: '@scope/pkg', version: '1.0.0', license: 'AGPL-3.0' }, policy),
    'allow',
  );
});

test('版本化豁免不匹配 scoped 包的其他版本', () => {
  const policy = policyWith({ '@scope/pkg@1.0.0': 'ticket 123' });
  assert.equal(
    judgeLicense({ name: '@scope/pkg', version: '2.0.0', license: 'AGPL-3.0' }, policy),
    'deny',
  );
});

test('裸包名豁免仍匹配任意版本的 scoped 包', () => {
  const policy = policyWith({ '@scope/pkg': 'ticket 123' });
  assert.equal(
    judgeLicense({ name: '@scope/pkg', version: '9.9.9', license: 'AGPL-3.0' }, policy),
    'allow',
  );
});

test('版本化豁免仍匹配非 scoped 包', () => {
  const policy = policyWith({ 'left-pad@1.3.0': 'ticket 124' });
  assert.equal(
    judgeLicense({ name: 'left-pad', version: '1.3.0', license: 'AGPL-3.0' }, policy),
    'allow',
  );
});
