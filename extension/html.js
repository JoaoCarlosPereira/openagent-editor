'use strict';

function html(nonce) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font:var(--vscode-font-weight) var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-foreground);margin:0;display:flex;flex-direction:column;height:100vh}
header{padding:12px 14px;border-bottom:1px solid var(--vscode-panel-border)}h1{font-size:15px;margin:0 0 5px}.hint{opacity:.7;font-size:12px}
#messages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}.message{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border-radius:8px;background:var(--vscode-editorWidget-background)}.user{border-left:3px solid var(--vscode-focusBorder)}.assistant{border-left:3px solid #64d8cb}.error{border-left:3px solid var(--vscode-errorForeground)}.meta{font-size:11px;opacity:.7;margin-bottom:5px}
form{padding:10px;border-top:1px solid var(--vscode-panel-border)}textarea{box-sizing:border-box;width:100%;min-height:76px;resize:vertical;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:8px;font:inherit}button{border:0;background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:7px 11px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}.small{font-size:11px}
</style></head><body><header><h1>OpenAgent</h1><div class="hint">A seleção ou o arquivo ativo é enviado ao perguntar.</div></header>
<main id="messages" aria-live="polite"></main>
<form id="form"><textarea id="prompt" placeholder="Pergunte sobre o código…" aria-label="Mensagem"></textarea><div class="actions"><button id="send" type="submit">Enviar</button></div></form>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const messages=document.getElementById('messages');const form=document.getElementById('form');const prompt=document.getElementById('prompt');const send=document.getElementById('send');
function add(role,text,id){const box=document.createElement('div');box.className='message '+role;const meta=document.createElement('div');meta.className='meta';meta.textContent=role==='user'?'Você':role==='error'?'Erro':'OpenAgent';const body=document.createElement('div');body.textContent=text;box.append(meta,body);if(id){const b=document.createElement('button');b.className='small';b.textContent='Prévia da edição';b.addEventListener('click',()=>vscode.postMessage({type:'preview',id}));box.append(b)}messages.append(box);messages.scrollTop=messages.scrollHeight}
form.addEventListener('submit',event=>{event.preventDefault();const text=prompt.value.trim();if(!text||send.disabled)return;add('user',text);vscode.postMessage({type:'ask',text});prompt.value='';send.disabled=true});
prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();form.requestSubmit()}});
window.addEventListener('message',event=>{const data=event.data;if(data.type==='answer'){add('assistant',data.text,data.id);send.disabled=false}else if(data.type==='error'){add('error',data.text);send.disabled=false}else if(data.type==='submitted'){add('user',data.text);send.disabled=true}else if(data.type==='prompt'){prompt.value=data.text;prompt.focus()}});
</script></body></html>`;
}

module.exports = { html };
