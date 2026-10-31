# Runtime experimental

Após instalar as dependências, execute `/usr/bin/npm run editor:start` em uma
sessão gráfica. O runtime usa o controlador de workbench da task_121; a pasta
é escolhida pelo diálogo nativo e o acesso a arquivos é limitado ao workspace.

O renderer usa isolamento de contexto, sandbox e uma ponte restrita de editor.
Não use `--no-sandbox` para contornar configurações inseguras do sistema.

Este runtime ainda não é um pacote instalável, não conecta o daemon ou o host
de extensões e não implementa decorações. Ele não comprova paridade do produto.
No ambiente de desenvolvimento atual, o Electron aborta antes de abrir a janela:
o helper `chrome-sandbox` não está configurado e user namespaces são negados.
É necessário um ambiente gráfico com sandbox Chromium funcional para testar
inicialização, interação real e encerramento.

Também foram tentados `bwrap` com namespaces de usuário e montagem isolada
do helper SUID existente do Chrome: o Electron continuou abortando na sandbox.
Essas falhas ambientais não verificam a correção da janela ou do preload.
Os testes `runtime-bridge.e2e.test.ts` exercitam a ponte e os controladores em
Node, não o IPC real do Electron. A integração de extensões e decorações
depende da task_160, cujo trabalho ainda não commitado não integra esta base.

## Origem e limite da verificação

O runtime foi criado nesta tarefa sobre os controladores existentes na base
`16c2ec4`; usa Electron e `tsx` declarados no `package.json` e no lockfile.
O histórico da tarefa registra a criação dos arquivos, mas não constitui uma
auditoria independente que prove ausência de cópia. Não foi identificada nesta
implementação uma fonte de artefato do Cursor com caminho e hash verificáveis;
não há fundamento para inventar esses dados em um manifesto de proveniência.

`docs/provenance-policy.md` exige registro para módulos que usam artefatos do
Cursor como origem ou evidência. O gate atual só procura arquivos terminados
em `.provenance.json`, inclusive não rastreados; não detecta `provenance.json`
nem verifica cobertura dos módulos. Assim, sucesso com zero arquivos analisados
não comprova a origem deste runtime, nem a conformidade do repositório inteiro.

## Teste gráfico manual

Em uma sessão gráfica de usuário não privilegiado, em máquina ou VM que já
tenha sandbox Chromium funcional, execute a partir deste worktree:

```sh
cd /mnt/Dados/dsv/openagent-editor-wt/editor-runtime-b601f98e
/usr/bin/npm run editor:start
```

Use uma pasta de teste descartável com dois arquivos de texto, sem dados reais:

1. Abra a pasta e um arquivo; edite, salve e confira o conteúdo no disco.
2. Edite novamente e tente abrir o outro arquivo: cancele o descarte e confirme
   que o buffer anterior continua aberto. Repita e confirme o descarte.
3. Edite e feche a janela; cancele o descarte e confirme que a janela e o
   buffer permanecem. Repita e confirme o descarte para encerrar.
4. Altere o arquivo externamente após editá-lo no editor e confirme que salvar
   reporta conflito e preserva o conteúdo externo e o buffer local.

Registre sistema, sessão gráfica, resultado e mensagens do terminal. Se a
sandbox abortar antes da janela, registre a falha e interrompa: não desative
a sandbox nem altere configurações do sistema para contornar o erro.

O fechamento normal aguarda a fila de edições do renderer e recusa o fechamento
se uma edição falhar; falha ou travamento do renderer não confirma fechamento.
Crash, encerramento forçado ou desligamento do sistema não são cobertos.

O salvamento prepara e sincroniza um arquivo temporário no mesmo diretório,
revalida identidade e conteúdo, e então substitui o destino por rename. Isso
evita arquivo parcialmente escrito, mas não oferece compare-and-swap: outra
aplicação ainda pode gravar entre a última verificação e o rename. A troca pode
alterar inode, hard links, ACLs e atributos estendidos; permissões básicas são
preservadas. A durabilidade após falha de energia não é garantida, pois o
diretório não é sincronizado. Não use este runtime para dados insubstituíveis.
