'use strict';

const vscode = require('vscode');
const { complete, extractCodeBlock } = require('./client');

function cleanCompletion(answer) {
  return (extractCodeBlock(answer) ?? answer).replace(/^\n+/, '').slice(0, 800);
}

function registerInline(context) {
  const provider = {
    async provideInlineCompletionItems(document, position, _completionContext, token) {
      const config = vscode.workspace.getConfiguration('openagent');
      if (!config.get('inlineCompletion.enabled', false) || token.isCancellationRequested) return [];
      const offset = document.offsetAt(position);
      const version = document.version;
      const source = document.getText();
      const prefix = source.slice(Math.max(0, offset - 1600), offset);
      const suffix = source.slice(offset, offset + 800);
      if (!prefix.trim()) return [];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const cancellation = token.onCancellationRequested(() => controller.abort());
      try {
        await new Promise(resolve => {
          let subscription;
          const delay = setTimeout(() => { subscription.dispose(); resolve(); }, 350);
          subscription = token.onCancellationRequested(() => { clearTimeout(delay); subscription.dispose(); resolve(); });
        });
        if (token.isCancellationRequested) return [];
        const answer = await complete({
          baseUrl: config.get('baseUrl'),
          model: config.get('model'),
          apiKey: await context.secrets.get('openagent.apiKey'),
          messages: [
            { role: 'system', content: 'Continue o código no cursor. Responda somente com o texto a inserir, sem explicação nem repetição do prefixo.' },
            { role: 'user', content: `Linguagem: ${document.languageId}\nAntes do cursor:\n${prefix}\n<cursor>\nDepois do cursor:\n${suffix}` }
          ],
          signal: controller.signal
        });
        if (token.isCancellationRequested || document.version !== version) return [];
        const text = cleanCompletion(answer);
        return text.trim() ? [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))] : [];
      } catch {
        return [];
      } finally {
        clearTimeout(timeout);
        cancellation.dispose();
      }
    }
  };
  return vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file' }], provider);
}

module.exports = { registerInline, cleanCompletion };
