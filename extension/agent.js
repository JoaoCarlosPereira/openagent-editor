'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');
const { requestChat } = require('./client');
const { inside } = require('./paths');

const TOOLS = [
  { type: 'function', function: { name: 'list_files', description: 'Lista arquivos do workspace para localizar código.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Lê um arquivo do workspace por caminho relativo.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'search_text', description: 'Busca texto literal nos arquivos do workspace.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'replace_in_file', description: 'Propõe substituir uma ocorrência exata em um arquivo. Mostra diff e pede aprovação antes de aplicar.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'], additionalProperties: false } } },
  { type: 'function', function: { name: 'run_command', description: 'Executa comando de terminal no workspace após aprovação explícita e retorna saída limitada.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } } }
];

class LocalTools {
  constructor(folder) { this.folder = folder; }

  async uri(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) throw new Error('Caminho relativo inválido.');
    const root = await fs.realpath(this.folder.uri.fsPath);
    const resolved = await fs.realpath(path.resolve(root, relativePath));
    if (!inside(root, resolved)) throw new Error('O arquivo está fora do workspace.');
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('O caminho não aponta para um arquivo.');
    if (stat.size > 1024 * 1024) throw new Error('Arquivo maior que 1 MiB; reduza o escopo.');
    return vscode.Uri.file(resolved);
  }

  async list_files() {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder, '**/*'), '**/{.git,node_modules,dist,build}/**', 101);
    return JSON.stringify({ files: files.slice(0, 100).map(uri => path.relative(this.folder.uri.fsPath, uri.fsPath)), truncated: files.length > 100 });
  }

  async read_file(args) {
    const uri = await this.uri(args.path);
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.includes(0)) throw new Error('Arquivo binário não suportado.');
    return Buffer.from(bytes).toString('utf8').slice(0, 20000);
  }

  async search_text(args) {
    const query = String(args.query || '').slice(0, 100);
    if (!query) throw new Error('Consulta vazia.');
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.folder, '**/*'), '**/{.git,node_modules,dist,build}/**', 501);
    const hits = [];
    for (const uri of files.slice(0, 500)) {
      if (hits.length >= 30) break;
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 512 * 1024) continue;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.includes(0)) continue;
      const lines = Buffer.from(bytes).toString('utf8').split('\n');
      for (let i = 0; i < lines.length && hits.length < 30; i++) {
        if (lines[i].toLowerCase().includes(query.toLowerCase())) hits.push({ path: path.relative(this.folder.uri.fsPath, uri.fsPath), line: i + 1, text: lines[i].slice(0, 200) });
      }
    }
    return JSON.stringify({ hits, filesScanned: Math.min(files.length, 500), fileListTruncated: files.length > 500, resultsTruncated: hits.length >= 30 });
  }

  async replace_in_file(args) {
    const uri = await this.uri(args.path);
    const oldText = String(args.old_text || '');
    const newText = String(args.new_text ?? '');
    if (!oldText) throw new Error('old_text não pode ser vazio.');
    const document = await vscode.workspace.openTextDocument(uri);
    const source = document.getText();
    const first = source.indexOf(oldText);
    if (first < 0) throw new Error('Trecho original não encontrado.');
    if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error('Trecho original aparece mais de uma vez; especifique mais contexto.');
    const version = document.version;
    const proposed = await vscode.workspace.openTextDocument({ content: source.slice(0, first) + newText + source.slice(first + oldText.length), language: document.languageId });
    await vscode.commands.executeCommand('vscode.diff', uri, proposed.uri, `OpenAgent: ${args.path}`);
    const choice = await vscode.window.showInformationMessage(`Aplicar alteração em ${args.path}?`, { modal: true }, 'Aplicar');
    if (choice !== 'Aplicar') return JSON.stringify({ applied: false, reason: 'Usuário recusou a edição.' });
    if (document.version !== version) throw new Error('Arquivo mudou durante a prévia.');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(first), document.positionAt(first + oldText.length)), newText);
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('Falha ao aplicar edição.');
    return JSON.stringify({ applied: true, path: args.path });
  }

  async run_command(args) {
    const command = String(args.command || '').trim();
    if (!command || command.length > 500) throw new Error('Comando vazio ou muito longo.');
    const choice = await vscode.window.showInformationMessage(`Executar no workspace?\n${command}`, { modal: true }, 'Executar');
    if (choice !== 'Executar') return JSON.stringify({ executed: false, reason: 'Usuário recusou o comando.' });
    return new Promise(resolve => {
      const child = spawn(command, { cwd: this.folder.uri.fsPath, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; let timedOut = false;
      const append = (value, chunk) => (value + chunk.toString()).slice(-16000);
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
      const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
      child.on('error', error => { clearTimeout(timeout); resolve(JSON.stringify({ executed: true, error: error.message })); });
      child.on('close', code => { clearTimeout(timeout); resolve(JSON.stringify({ executed: true, exitCode: code, timedOut, stdout, stderr })); });
    });
  }

  async call(name, args) {
    if (!TOOLS.some(tool => tool.function.name === name)) throw new Error('Ferramenta desconhecida.');
    return this[name](args);
  }
}

async function runAgent({ folder, baseUrl, model, apiKey, prompt, context, onProgress }) {
  if (folder.uri.scheme !== 'file') throw new Error('O agente local requer um workspace no sistema de arquivos desta máquina.');
  const tools = new LocalTools(folder);
  const messages = [
    { role: 'system', content: 'Você é um agente de programação local. Investigue o workspace com as ferramentas, faça alterações pequenas e teste quando fizer sentido. Edições e comandos pedem aprovação na interface. Não invente resultados de ferramentas. Responda em português.' },
    { role: 'user', content: prompt + (context || '') }
  ];
  for (let step = 0; step < 12; step++) {
    const message = await requestChat({ baseUrl, model, apiKey, messages, tools: TOOLS });
    messages.push(message);
    if (!message.tool_calls?.length) return typeof message.content === 'string' ? message.content : 'O provedor encerrou sem resposta textual.';
    for (const call of message.tool_calls) {
      const name = call.function?.name;
      onProgress?.(`Ferramenta: ${name || 'desconhecida'}`);
      let result;
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        result = await tools.call(name, args);
      } catch (error) { result = JSON.stringify({ error: error.message || String(error) }); }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }
  return 'O agente atingiu o limite de 12 etapas. Continue a conversa para prosseguir.';
}

module.exports = { runAgent };
