'use strict';

function activate(context, api) {
  const output = api.window.createOutputChannel('OpenAgent Representative');
  output.appendLine('activated on API ' + api.version);

  context.subscriptions.push(
    api.commands.registerCommand('openagent.representative.brand', async (fileUri) => {
      const doc = await api.workspace.openTextDocument(fileUri);
      await api.workspace.applyTextEdits(fileUri, doc.version, [
        { start: 0, end: 0, text: 'OpenAgent: ' },
      ]);
      await api.workspace.setDecorations(
        fileUri,
        { id: 'openagent-brand', backgroundColor: '#64d8cb', outlineColor: '#ffffff' },
        [{ start: 0, end: 10 }],
      );
      output.appendLine('branded ' + fileUri);
      return { branded: true, apiVersion: api.version };
    }),
    api.commands.registerCommand('openagent.representative.status', async () => {
      await api.window.showInformationMessage('OpenAgent representative extension active');
      return { active: true, apiVersion: api.version, extensionId: context.extensionId };
    }),
    api.languages.registerHoverProvider('*', {
      provideHover() {
        return { contents: ['OpenAgent'] };
      },
    }),
    output,
  );

  return { activated: true, apiVersion: api.version };
}

function deactivate() {}

module.exports = { activate, deactivate };
