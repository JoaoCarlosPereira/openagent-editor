'use strict';

const { URL } = require('node:url');

function completionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A URL do provedor deve usar HTTP ou HTTPS.');
  if (url.username || url.password) throw new Error('Não coloque credenciais na URL; use OpenAgent: Set API Key.');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url;
}

async function complete({ baseUrl, model, apiKey, messages, signal }) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(completionsUrl(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, stream: false }),
    signal
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Provedor respondeu HTTP ${response.status}: ${detail}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('O provedor não retornou texto em choices[0].message.content.');
  return content;
}

function extractCodeBlock(text) {
  const match = text.match(/```[^\n]*\n([\s\S]*?)\n?```/);
  return match ? match[1].replace(/\n$/, '') : null;
}

module.exports = { completionsUrl, complete, extractCodeBlock };
