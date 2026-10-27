const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'schemas', 'provenance.schema.json'), 'utf8')
);
const examplesDir = path.join(__dirname, '..', 'schemas', 'examples');

function passesPattern(pattern, value) {
  return new RegExp(pattern).test(value);
}

function validDocumentRef(value) {
  return passesPattern(schema.$defs.authorization.properties.documentRef.pattern, value);
}

function validModule(value) {
  return passesPattern(schema.properties.module.pattern, value);
}

test('schema restringe $schema ao URI draft 2020-12 esperado', () => {
  assert.equal(schema.properties.$schema.const, 'https://json-schema.org/draft/2020-12/schema');
  for (const value of [
    'javascript:alert(1)',
    'http://json-schema.org/draft-07/schema#',
    'https://example.test/schema',
    'file:///tmp/schema.json',
    'urn:example:schema'
  ]) {
    assert.equal(
      value === schema.properties.$schema.const,
      false,
      `$schema não deveria aceitar URI alternativo: ${value}`
    );
  }
});

test('schema aceita exemplos com caminhos e rejeita traversal e separadores inseguros', () => {
  for (const file of fs.readdirSync(examplesDir).filter(name => name.endsWith('.json'))) {
    const example = JSON.parse(fs.readFileSync(path.join(examplesDir, file), 'utf8'));
    assert.ok(validModule(example.module), `${file}: module deveria ser caminho válido`);
    if (example.authorization) {
      assert.ok(validDocumentRef(example.authorization.documentRef), `${file}: documentRef deveria ser válido`);
    }
  }

  for (const value of ['../outside', '..', '.', 'pkg/../outside', 'pkg/./outside', '/absolute/path', 'pkg\\outside']) {
    assert.equal(validModule(value), false, `module inválido aceito: ${value}`);
  }

  for (const value of [
    '../outside.md',
    'foo/..',
    'foo/./auth.md',
    '/absolute/auth.md',
    'https://example.test/auth.md',
    'javascript:alert(1)',
    'foo\\bar.md',
    'C:/auth.md',
    'auth.md#fragment'
  ]) {
    assert.equal(validDocumentRef(value), false, `documentRef inválido aceito: ${value}`);
  }
});
