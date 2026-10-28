'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

test('agent sends a tool result back to the model before answering', async () => {
  const originalLoad = Module._load;
  const fakeVscode = {
    RelativePattern: class { constructor(folder, pattern) { this.folder = folder; this.pattern = pattern; } },
    workspace: { findFiles: async () => [{ fsPath: '/project/src/app.js' }] }
  };
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  let runAgent;
  try { ({ runAgent } = require('../extension/agent')); }
  finally { Module._load = originalLoad; }
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const message = requests.length === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] }
      : { role: 'assistant', content: 'Encontrei src/app.js.' };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
  try {
    const answer = await runAgent({ folder: { uri: { scheme: 'file', fsPath: '/project' } }, baseUrl: 'http://localhost:11434/v1', model: 'test', prompt: 'Liste os arquivos.' });
    assert.equal(answer, 'Encontrei src/app.js.');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].messages.at(-1).role, 'tool');
    assert.match(requests[1].messages.at(-1).content, /src[/\\]app\.js/);
  } finally { global.fetch = originalFetch; }
});
