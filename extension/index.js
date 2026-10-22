'use strict';

const vscode = require('vscode');
const crypto = require('node:crypto');
const { complete, extractCodeBlock } = require('./client');
const { editorContext, contextMessage } = require('./context');
const { html } = require('./html');
const { registerInline } = require('./inline');
const { runAgent } = require('./agent');

const KEY_NAME = 'openagent.apiKey';
const SYSTEM = 'Você é um assistente de programação. Responda com precisão. Não alegue ter executado código ou testes. Quando fornecer uma edição, inclua o código completo da substituição em um único bloco Markdown.';

class ChatView {
  constructor(context) {
    this.context = context;
    this.history = [];
    this.pending = new Map();
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html(crypto.randomBytes(16).toString('hex'));
    view.webview.onDidReceiveMessage(async message => {
      try {
        if (message?.type === 'ask') await this.ask(message.text, false, message.mode);
        if (message?.type === 'preview') await this.preview(message.id);
      } catch (error) {
        vscode.window.showErrorMessage(`OpenAgent: ${error.message || error}`);
      }
    });
  }

  post(message) { this.view?.webview.postMessage(message); }

  async openWithPrompt(prompt, submit = false, mode = 'ask') {
    await vscode.commands.executeCommand('workbench.view.extension.openagent');
    this.post({ type: 'mode', value: mode });
    if (submit) {
      this.post({ type: 'submitted', text: prompt });
      await this.ask(prompt, true, mode);
    }
    else this.post({ type: 'prompt', text: prompt });
  }

  async ask(rawPrompt, editing = false, mode = 'ask') {
    const prompt = String(rawPrompt || '').trim();
    if (!prompt) return;
    const config = vscode.workspace.getConfiguration('openagent');
    const context = editorContext(vscode.window.activeTextEditor, config.get('maxContextCharacters', 12000));
    const user = prompt + contextMessage(context);
    if (mode === 'agent') {
      try {
        const folder = (context && vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(context.uri))) || vscode.workspace.workspaceFolders?.[0];
        if (!folder) throw new Error('Abra uma pasta de trabalho para usar o agente.');
        const answer = await runAgent({
          folder,
          baseUrl: config.get('baseUrl'),
          model: config.get('model'),
          apiKey: await this.context.secrets.get(KEY_NAME),
          prompt,
          context: contextMessage(context),
          onProgress: text => this.post({ type: 'progress', text })
        });
        this.post({ type: 'answer', text: answer });
      } catch (error) {
        this.post({ type: 'error', text: error.message || String(error) });
      }
      return;
    }
    const messages = [
      { role: 'system', content: SYSTEM },
      ...this.history.slice(-8),
      { role: 'user', content: user }
    ];
    try {
      const answer = await complete({
        baseUrl: config.get('baseUrl'),
        model: config.get('model'),
        apiKey: await this.context.secrets.get(KEY_NAME),
        messages
      });
      this.history.push({ role: 'user', content: user }, { role: 'assistant', content: answer });
      const code = extractCodeBlock(answer);
      let id;
      if (code !== null && context?.selected && !context.truncated) {
        id = crypto.randomUUID();
        this.pending.set(id, { context, code });
      }
      this.post({ type: 'answer', text: answer, canApply: !!id, id });
      if (editing && id) await this.preview(id);
      else if (editing && !id) vscode.window.showWarningMessage('A resposta não contém um bloco de código aplicável à seleção.');
    } catch (error) {
      this.post({ type: 'error', text: error.message || String(error) });
      vscode.window.showErrorMessage(`OpenAgent: ${error.message || error}`);
    }
  }

  async preview(id) {
    const item = this.pending.get(id);
    if (!item) return;
    const { context, code } = item;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(context.uri));
    if (document.version !== context.version) {
      this.pending.delete(id);
      vscode.window.showWarningMessage('O arquivo mudou desde a resposta. Gere uma nova edição.');
      return;
    }
    const before = document.getText();
    const start = document.offsetAt(context.selection.start);
    const end = document.offsetAt(context.selection.end);
    const after = before.slice(0, start) + code + before.slice(end);
    const proposed = await vscode.workspace.openTextDocument({ content: after, language: document.languageId });
    await vscode.commands.executeCommand('vscode.diff', document.uri, proposed.uri, `OpenAgent: prévia de ${document.fileName}`);
    const choice = await vscode.window.showInformationMessage('Aplicar esta edição?', { modal: true }, 'Aplicar');
    if (choice !== 'Aplicar') return;
    if (document.version !== context.version) {
      vscode.window.showWarningMessage('O arquivo mudou durante a prévia. Gere uma nova edição.');
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, context.selection, code);
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error('Não foi possível aplicar a edição.');
    this.pending.delete(id);
  }
}

function activate(context) {
  const chat = new ChatView(context);
  context.subscriptions.push(registerInline(context));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('openagent.chat', chat));
  context.subscriptions.push(vscode.commands.registerCommand('openagent.setApiKey', async () => {
    const key = await vscode.window.showInputBox({ prompt: 'Chave de API do provedor (deixe vazio para remover)', password: true, ignoreFocusOut: true });
    if (key === undefined) return;
    if (key) await context.secrets.store(KEY_NAME, key);
    else await context.secrets.delete(KEY_NAME);
    vscode.window.showInformationMessage(key ? 'Chave de API armazenada no SecretStorage.' : 'Chave de API removida.');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('openagent.ask', () => chat.openWithPrompt('Explique este código.')));
  context.subscriptions.push(vscode.commands.registerCommand('openagent.agent', () => chat.openWithPrompt('', false, 'agent')));
  context.subscriptions.push(vscode.commands.registerCommand('openagent.editSelection', async () => {
    const instruction = await vscode.window.showInputBox({ prompt: 'Como deseja editar a seleção?', ignoreFocusOut: true });
    if (!instruction) return;
    await chat.openWithPrompt(`Substitua a seleção conforme esta instrução: ${instruction}. Retorne o código completo da substituição em um único bloco Markdown.`, true);
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
