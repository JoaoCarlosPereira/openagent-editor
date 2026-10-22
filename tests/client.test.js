'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { completionsUrl, requestChat, complete, extractCodeBlock } = require('../extension/client');
const { editorContext, contextMessage } = require('../extension/context');
const { inside } = require('../extension/paths');

test('builds a chat completions URL and rejects unsafe schemes or embedded credentials', () => {
  assert.equal(completionsUrl('http://localhost:11434/v1/').href, 'http://localhost:11434/v1/chat/completions');
  assert.throws(() => completionsUrl('file:///tmp/api'), /HTTP/);
  assert.throws(() => completionsUrl('https://key@example.org/v1'), /credenciais/);
});

test('sends OpenAI compatible request and reads assistant text', async () => {
  const original = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'olá' } }] }) };
  };
  try {
    assert.equal(await complete({ baseUrl: 'https://example.org/v1', model: 'test', apiKey: 'secret', messages: [{ role: 'user', content: 'oi' }] }), 'olá');
    assert.equal(request.url, 'https://example.org/v1/chat/completions');
    assert.equal(request.options.headers.authorization, 'Bearer secret');
    assert.equal(JSON.parse(request.options.body).model, 'test');
  } finally { global.fetch = original; }
});

test('extracts one replacement block without surrounding prose', () => {
  assert.equal(extractCodeBlock('texto\n```js\nconst x = 1;\n```\nfim'), 'const x = 1;');
  assert.equal(extractCodeBlock('sem bloco'), null);
});

test('passes tool schemas to the model and preserves tool calls', async () => {
  const original = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] } }] }) };
  };
  try {
    const response = await requestChat({ baseUrl: 'http://localhost:11434/v1', model: 'test', messages: [], tools: [{ type: 'function', function: { name: 'list_files' } }] });
    assert.equal(body.tool_choice, 'auto');
    assert.equal(response.tool_calls[0].function.name, 'list_files');
  } finally { global.fetch = original; }
});

test('workspace boundary rejects sibling paths', () => {
  assert.equal(inside('/project', '/project/src/file.js'), true);
  assert.equal(inside('/project', '/project-other/file.js'), false);
  assert.equal(inside('/project', '/tmp/file.js'), false);
});

test('context uses selection, limit, and marks truncation', () => {
  const editor = {
    selection: { isEmpty: false },
    document: {
      uri: { toString: () => 'file:///tmp/a.js', fsPath: '/tmp/a.js' },
      languageId: 'javascript', version: 2,
      getText: range => range ? 'selected code' : 'whole file'
    }
  };
  const context = editorContext(editor, 8);
  assert.equal(context.text, 'selected');
  assert.equal(context.truncated, true);
  assert.match(contextMessage(context), /contexto truncado/);
  assert.match(contextMessage(context), /seleção/);
});
