# Preparação do aceite manual (UAT) — 53/53 requisitos

**Status: PREPARAÇÃO.** Este checklist organiza a execução do aceite manual;
não constitui aceite executado. A pessoa executora preenche, para cada ID:
passo realizado, resultado observado e evidência (SO, versão do produto,
versão do Cursor de referência, provedor/fixture).

- Fonte dos critérios: `packages/parity/src/catalog.ts` (matriz canônica do PRD v6, gate único 53/53).
- Fonte dos passos: cenários diferenciais dry-drive em `packages/parity/scenarios/` (cobertura 53/53, task_188–task_197).
- Evidência esperada: nomes dos efeitos observáveis declarados pelo cenário dry-drive por passo, nos dois lados (Cursor 3.24.18 congelado e OpenAgent). Na execução real, a pessoa deve observar o equivalente visível desses efeitos e registrar captura/log.
- Gerada em: 2026-10-30 por `node --import tsx scripts/uat-checklist.mjs`.

## Como executar o aceite (roteiro da pessoa)

1. Instalar o pacote Linux em máquina limpa conforme o roteiro de instalação (ver `docs/parity-acceptance.md`, seção "Preparação do aceite manual 53/53 — Linux (task_198)").
2. Abrir o editor e, para cada ID abaixo, executar os passos na ordem do cenário e registrar o resultado na coluna `Resultado/evidência`.
3. Procurar os efeitos esperados indicados na coluna "Evidência esperada" (diferença observável na UI, arquivo, terminal, log ou estado).
4. Salvar o preenchimento em `packages/parity/report/uat-<so>-<data>.md` e referenciar no card da tarefa.
5. Um requisito só fica aceito quando o fluxo principal **e** o caso de erro correspondente passam no produto instalado.

## LOC — Editor base

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| LOC-01 | Instalar em Linux, Windows ou macOS; abrir pasta; oferecer edição, terminal, Git, depuração e extensão compatível com a API do editor, com nome e ícone OpenAgent. | abrir-pasta<br>editar-arquivo<br>abrir-terminal<br>abrir-git<br>abrir-debug<br>instalar-extensao-compativel | abrir-pasta → workspace-opened, package-identity<br>editar-arquivo → file-edited<br>abrir-terminal → terminal-panel<br>abrir-git → git-panel<br>abrir-debug → debug-session<br>instalar-extensao-compativel → extension-installed | |

## UI — Interface

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| UI-01 | Quanto a janela principal abrir, mostrar painel do agente, seletor de modo, seletor de modelo, contexto, histórico e revisão de alterações, todos alcançáveis por teclado. | abrir-painel-do-agente<br>selecionar-modo<br>selecionar-modelo<br>anexar-contexto<br>abrir-historico<br>revisar-alteracoes<br>navegar-por-teclado | abrir-painel-do-agente → agent-panel<br>selecionar-modo → mode-selector<br>selecionar-modelo → model-selector<br>anexar-contexto → context-attachment<br>abrir-historico → history<br>revisar-alteracoes → change-review<br>navegar-por-teclado → keyboard-accessible | |
| UI-02 | Quando alternar tema claro e escuro ou a largura do painel, manter controles legíveis e preservar mensagens da conversa. | alternar-tema-claro<br>alternar-tema-escuro<br>ajustar-largura-do-painel<br>verificar-controles-legiveis<br>verificar-mensagens-preservadas | alternar-tema-claro → theme-change<br>alternar-tema-escuro → theme-change<br>ajustar-largura-do-painel → panel-width-change<br>verificar-controles-legiveis → controls-readable<br>verificar-mensagens-preservadas → conversation-preserved | |
| UI-03 | Ao abrir o editor pela primeira vez, conduzir configuração do provedor, executar teste de conexão e permitir abrir projeto sem conta da Anysphere. | abrir-editor-primeira-vez<br>conduzir-configuracao-do-provedor<br>executar-teste-de-conexao<br>abrir-projeto-sem-conta | abrir-editor-primeira-vez → onboarding-screen<br>conduzir-configuracao-do-provedor → provider-profile-saved<br>executar-teste-de-conexao → connection-test<br>abrir-projeto-sem-conta → project-opened | |
| UI-04 | Quando abrir a janela de agentes, listar execuções locais em paralelo e oferecer comando de voltar ao editor no mesmo workspace. | abrir-janela-de-agentes<br>listar-execucoes-locais-em-paralelo<br>voltar-ao-editor | abrir-janela-de-agentes → agents-window<br>listar-execucoes-locais-em-paralelo → parallel-local-runs<br>voltar-ao-editor → back-to-editor | |

## AGT — Agente

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| AGT-01 | Quanto escolher Ask, responder com leitura e busca, sem gravar arquivo nem executar comando. | escolher-modo-ask<br>perguntar-sobre-a-funcao<br>responder-usando-leitura-e-busca<br>verificar-workspace-sem-mutacao | escolher-modo-ask → mode-selected<br>perguntar-sobre-a-funcao → question-sent<br>responder-usando-leitura-e-busca → tool-usage<br>verificar-workspace-sem-mutacao → workspace-mutation | |
| AGT-02 | Quando aceitar plano no modo Plan, iniciar execução com plano e progresso visíveis. | propor-plano-no-modo-plan<br>aceitar-o-plano<br>iniciar-execucao-com-o-plano<br>mostrar-progresso-das-etapas | propor-plano-no-modo-plan → plan-proposal<br>aceitar-o-plano → plan-accepted<br>iniciar-execucao-com-o-plano → execution-started<br>mostrar-progresso-das-etapas → execution-progress | |
| AGT-03 | Ao executar tarefa no modo Agent, editar mais de um arquivo, rodar teste autorizado e mostrar diff agrupado e resultado de cada ferramenta. | executar-tarefa-no-modo-agent<br>editar-multiplos-arquivos<br>rodar-teste-autorizado<br>mostrar-diff-agrupado-e-resultados | executar-tarefa-no-modo-agent → agent-run<br>editar-multiplos-arquivos → multi-file-edit<br>rodar-teste-autorizado → test-run<br>mostrar-diff-agrupado-e-resultados → grouped-diff, tool-results | |
| AGT-04 | Quando escolher Debug, registrar hipótese, evidência de execução e resultado da verificação antes de marcar tarefa como concluída. | registrar-hipotese<br>executar-e-coletar-evidencia<br>verificar-a-hipotese<br>marcar-tarefa-como-concluida | registrar-hipotese → debug-hypothesis<br>executar-e-coletar-evidencia → execution-evidence<br>verificar-a-hipotese → verification-result<br>marcar-tarefa-como-concluida → task-completion | |
| AGT-05 | Quando dividir tarefa, mostrar cada subagente local com nome, estado e resultado próprios. | dividir-a-tarefa-em-subagentes<br>executar-cada-subagente<br>mostrar-resultado-proprio-de-cada-um | dividir-a-tarefa-em-subagentes → subagent-list<br>executar-cada-subagente → subagent-entries<br>mostrar-resultado-proprio-de-cada-um → subagent-results | |
| AGT-06 | Quando mensagem chegar durante execução, colocá-la na fila e permitir remover item que ainda não começou. | enviar-mensagem-durante-execucao<br>listar-a-fila<br>remover-item-que-nao-comecou<br>recusar-remocao-de-item-ja-iniciado | enviar-mensagem-durante-execucao → message-queued<br>listar-a-fila → queue-items<br>remover-item-que-nao-comecou → queue-item-removed<br>recusar-remocao-de-item-ja-iniciado → queue-item-removal-denied | |
| AGT-07 | Quando cancelar um subagente, interromper só esse subagente e conservar estado dos demais. | cancelar-um-subagente<br>conservar-o-estado-dos-demais | cancelar-um-subagente → subagent-cancelled<br>conservar-o-estado-dos-demais → remaining-subagents-intact | |

## PRJ — Projeto

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| PRJ-01 | Quando criar projeto com objetivo, abrir coordenador local que divide em tarefas de agentes na mesma máquina e mostrar cada resultado para aceitar ou rejeitar. | criar-projeto-com-objetivo<br>dividir-o-objetivo-em-tarefas-de-agentes<br>mostrar-cada-resultado-de-tarefa<br>aceitar-ou-rejeitar-resultado | criar-projeto-com-objetivo → project-created<br>dividir-o-objetivo-em-tarefas-de-agentes → coordinator-plan<br>mostrar-cada-resultado-de-tarefa → task-results<br>aceitar-ou-rejeitar-resultado → result-decision | |

## PER — Permissão

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| PER-01 | Quando ferramenta precisar permissão, mostrar ação, alvo e escopo; executar só depois de aceite explícito. | mostrar-acao-alvo-e-escopo<br>aceitar-explicitamente<br>executar-ferramenta | mostrar-acao-alvo-e-escopo → permission-request<br>aceitar-explicitamente → explicit-accept<br>executar-ferramenta → tool-executed | |
| PER-02 | Quando cancelar execução, marcar Cancelada em até 2 segundos, não iniciar nova ferramenta e conservar alteração aplicada. | cancelar-durante-execucao<br>conservar-alteracao-aplicada<br>recusar-ferramenta-nova | cancelar-durante-execucao → cancel-requested, cancelled-state<br>conservar-alteracao-aplicada → applied-change-preserved<br>recusar-ferramenta-nova → new-tool-denied | |
| PER-03 | Enquanto modo for Somente leitura, bloquear gravação de arquivo e comando que altere workspace; exibir 'Bloqueado pelo modo de execução.' | ativar-somente-leitura<br>gravar-arquivo<br>executar-comando-mutavel | ativar-somente-leitura → readonly-mode-active<br>gravar-arquivo → file-write-blocked<br>executar-comando-mutavel → mutating-command-blocked | |

## STA — Estado de execução

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| STA-01 | Quando execução estiver Concluída ou Cancelada, recusar nova ferramenta; aceitar só depois de mensagem nova. | execucao-terminal<br>solicitar-ferramenta-na-execucao-terminal<br>enviar-mensagem-nova | execucao-terminal → run-terminal-state<br>solicitar-ferramenta-na-execucao-terminal → new-tool-denied<br>enviar-mensagem-nova → new-message-accepts-tool | |

## VAL — Validação de entrada

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| VAL-01 | Quando enviar mensagem sem texto e sem anexo, recusar envio e exibir 'Escreva uma mensagem ou anexe um contexto.' | enviar-mensagem-vazia<br>anexar-contexto-e-enviar | enviar-mensagem-vazia → empty-message-refused<br>anexar-contexto-e-enviar → message-sent | |

## CTX — Contexto e índice

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| CTX-01 | Ao anexar seleção, arquivo, pasta ou símbolo, listar cada fonte; mostrar contagem de tokens e teto antes do envio. | anexar-seleção<br>anexar-arquivo<br>anexar-pasta<br>anexar-símbolo<br>mostrar-resumo-antes-do-envio | anexar-seleção → selection-attached<br>anexar-arquivo → file-attached<br>anexar-pasta → folder-attached<br>anexar-símbolo → symbol-attached<br>mostrar-resumo-antes-do-envio → context-summary-before-send | |
| CTX-02 | Ao salvar arquivo indexado, busca local deve passar a encontrar texto novo sem reconstrução do índice inteiro. | salvar-arquivo-indexado<br>atualizar-indice-incremental<br>buscar-texto-novo | salvar-arquivo-indexado → file-saved<br>atualizar-indice-incremental → index-updated-incrementally<br>buscar-texto-novo → search-finds-new-text | |
| CTX-03 | Enquanto caminho estiver em regra de exclusão, omiti-lo da indexação, contexto automático e busca do agente. | aplicar-regra-de-exclusão<br>omitir-da-indexação<br>omitir-do-contexto-automático<br>omitir-da-busca-do-agente | aplicar-regra-de-exclusão → exclusion-rule-active<br>omitir-da-indexação → path-omitted-from-index<br>omitir-do-contexto-automático → path-omitted-from-auto-context<br>omitir-da-busca-do-agente → path-omitted-from-agent-search | |
| CTX-04 | Quando pedir limpeza do índice, mostrar escopo e tamanho; apagar dados locais daquele workspace. | pedir-limpeza-do-índice<br>mostrar-escopo-e-tamanho<br>apagar-dados-do-workspace | pedir-limpeza-do-índice → cleanup-requested<br>mostrar-escopo-e-tamanho → cleanup-scope-and-size-shown<br>apagar-dados-do-workspace → workspace-local-data-cleared | |

## PRV — Privacidade e log

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| PRV-01 | Enviar contexto a API externa só após ação explícita de envio; não enviar caminho excluído. | montar-contexto-local<br>registrar-ação-explícita-de-envio<br>enviar-a-api-externa<br>verificar-caminho-excluído-não-enviado | montar-contexto-local → context-assembled-locally<br>registrar-ação-explícita-de-envio → explicit-send-action<br>enviar-a-api-externa → context-sent-to-external-api<br>verificar-caminho-excluído-não-enviado → excluded-path-never-sent | |
| PRV-02 | Registrar ação de ferramenta, omitir credencial, conteúdo de arquivo excluído e corpo bruto do modelo no log padrão. | executar-ferramenta<br>escrever-log-padrão<br>auditar-omissões-do-log | executar-ferramenta → tool-action-logged<br>escrever-log-padrão → log-written<br>auditar-omissões-do-log → credential-omitted, excluded-file-content-omitted, raw-model-body-omitted | |

## TAB — Autocomplete (Tab)

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| TAB-01 | Ao digitar com Tab ativo, oferecer continuação de linha ou bloco com aceitar, recusar e cancelar. | digitar-com-tab-ativo<br>oferecer-continuacao-de-linha<br>oferecer-continuacao-de-bloco<br>oferecer-aceitar-recusar-cancelar<br>cancelar-durante-geracao | digitar-com-tab-ativo → suggestion-offered<br>oferecer-continuacao-de-linha → continuation-suggested<br>oferecer-continuacao-de-bloco → continuation-suggested<br>oferecer-aceitar-recusar-cancelar → suggestion-controls<br>cancelar-durante-geracao → suggestion-cancelled | |
| TAB-02 | Ao aceitar sugestão com continuação, indicar próximo ponto e permitir salto por teclado. | aceitar-sugestao-com-continuacao<br>indicar-proximo-ponto<br>saltar-por-teclado | aceitar-sugestao-com-continuacao → suggestion-accepted<br>indicar-proximo-ponto → next-point-indicated<br>saltar-por-teclado → keyboard-jump | |
| TAB-03 | Quando sugestão alterar outro arquivo, mostrar caminho e aplicar só depois de revisão. | gerar-sugestao-que-altera-outro-arquivo<br>mostrar-caminho-do-arquivo-afetado<br>revisar-diff-do-outro-arquivo<br>aplicar-somente-apos-revisao | gerar-sugestao-que-altera-outro-arquivo → cross-file-change<br>mostrar-caminho-do-arquivo-afetado → affected-path-shown<br>revisar-diff-do-outro-arquivo → review-required<br>aplicar-somente-apos-revisao → applied-after-review | |

## INL — Edição inline

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| INL-01 | Quando pedir Inline Edit na seleção, mostrar diff no editor com aceitar, rejeitar e refinar. | pedir-inline-edit-na-selecao<br>mostrar-diff-no-editor<br>oferecer-aceitar-rejeitar-refinar | pedir-inline-edit-na-selecao → inline-edit-requested<br>mostrar-diff-no-editor → diff-shown-in-editor<br>oferecer-aceitar-rejeitar-refinar → inline-edit-controls | |
| INL-02 | Ao pedir edição de arquivo inteiro, permitir rejeitar e restaurar conteúdo anterior ao pedido. | pedir-edicao-do-arquivo-inteiro<br>mostrar-previa-do-arquivo-inteiro<br>rejeitar-edicao<br>restaurar-conteudo-anterior | pedir-edicao-do-arquivo-inteiro → whole-file-edit-requested<br>mostrar-previa-do-arquivo-inteiro → whole-file-preview-shown<br>rejeitar-edicao → edit-rejected<br>restaurar-conteudo-anterior → previous-content-restored | |

## AUT — Automação local

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| AUT-01 | Quando autorizar navegador, abrir URL, executar interação autorizada, mostrar captura e texto de console. | autorizar-navegador<br>abrir-url-indicada<br>executar-interacao-autorizada<br>mostrar-captura<br>mostrar-texto-de-console | autorizar-navegador → browser-permission-granted<br>abrir-url-indicada → url-opened<br>executar-interacao-autorizada → authorized-interaction-executed<br>mostrar-captura → screenshot-shown<br>mostrar-texto-de-console → console-shown | |
| AUT-02 | Ao autorizar uso do computador, executar ação por vez, nomeada na permissão, mostrar resultado. | autorizar-uso-do-computador<br>executar-uma-acao-por-vez<br>mostrar-resultado-da-acao<br>negar-acao-nomeada-fora-da-permissao | autorizar-uso-do-computador → computer-permission-granted<br>executar-uma-acao-por-vez → single-action-executed<br>mostrar-resultado-da-acao → action-result-shown<br>negar-acao-nomeada-fora-da-permissao → unauthorized-action-denied | |

## DES — Desenho

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| DES-01 | Quando selecionar elemento no navegador em modo desenho, anexar identificação do elemento e trecho de código à mensagem seguinte. | ativar-modo-de-desenho-no-navegador<br>selecionar-elemento-no-navegador<br>anexar-identificacao-e-trecho-a-proxima-mensagem | ativar-modo-de-desenho-no-navegador → drawing-mode-active<br>selecionar-elemento-no-navegador → element-selected<br>anexar-identificacao-e-trecho-a-proxima-mensagem → element-context-attached | |

## CAN — Canvas

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| CAN-01 | Quando agente abrir canvas, exibir conteúdo no painel e mantê-lo visível após fim da resposta. | agente-abrir-canvas<br>exibir-conteudo-no-painel<br>finalizar-resposta<br>verificar-canvas-ainda-visivel | agente-abrir-canvas → canvas-opened<br>exibir-conteudo-no-painel → canvas-displayed<br>finalizar-resposta → response-finished<br>verificar-canvas-ainda-visivel → canvas-still-visible | |

## CUS — Regras, customização e hooks

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| CUS-01 | Ao iniciar sessão, carregar regras de usuário e de projeto aplicáveis, mostrar origem de cada uma. | iniciar-sessao<br>carregar-regras-do-usuario<br>carregar-regras-do-projeto<br>mostrar-origem-de-cada-regra | iniciar-sessao → session-started<br>carregar-regras-do-usuario → rule-loaded<br>carregar-regras-do-projeto → rule-loaded<br>mostrar-origem-de-cada-regra → rules-with-origin-shown | |
| CUS-02 | Ao invocar comando, skill ou plugin local, aplicar instrução declarada e mostrar origem. | invocar-comando-local<br>aplicar-instrucao-declarada<br>mostrar-origem | invocar-comando-local → command-invoked<br>aplicar-instrucao-declarada → instruction-applied<br>mostrar-origem → origin-shown | |
| CUS-03 | Quando hook local negar ação, impedir ação e mostrar justificativa do hook. | hook-negar-acao<br>impedir-acao<br>mostrar-justificativa | hook-negar-acao → hook-denied<br>impedir-acao → action-blocked<br>mostrar-justificativa → hook-justification-shown | |

## MCP — MCP

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| MCP-01 | Ao configurar servidor MCP por stdio/HTTP, listar ferramentas, executar escolhida só com permissão, mostrar resultado ou erro. | configurar-servidor-mcp<br>listar-ferramentas<br>pedir-permissao-da-ferramenta<br>executar-ferramenta-escolhida<br>mostrar-resultado-ou-erro | configurar-servidor-mcp → mcp-server-configured<br>listar-ferramentas → mcp-tools-listed<br>pedir-permissao-da-ferramenta → permission-requested<br>executar-ferramenta-escolhida → tool-executed<br>mostrar-resultado-ou-erro → tool-result-shown | |

## CLI — CLI e daemon

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| CLI-01 | Quando iniciar CLI num workspace, reutilizar provedor, modo, regras, MCP e sessões daquele workspace. | iniciar-cli-no-workspace<br>reutilizar-provedor<br>reutilizar-modo<br>reutilizar-regras<br>reutilizar-mcp<br>reutilizar-sessoes | iniciar-cli-no-workspace → cli-started<br>reutilizar-provedor → provider-reused<br>reutilizar-modo → mode-reused<br>reutilizar-regras → rules-reused<br>reutilizar-mcp → mcp-reused<br>reutilizar-sessoes → sessions-reused | |
| CLI-02 | Quando execução headless da CLI terminar, mostrar essa sessão ao abrir mesmo workspace no editor. | concluir-execucao-headless<br>abrir-editor-no-mesmo-workspace<br>mostrar-sessao-no-editor | concluir-execucao-headless → headless-run-finished<br>abrir-editor-no-mesmo-workspace → editor-opened<br>mostrar-sessao-no-editor → session-visible-in-editor | |

## SES — Sessões

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| SES-01 | Ao reiniciar editor, reabrir sessões do workspace com modo, mensagens, ferramentas e anexos existentes. | reiniciar-editor<br>reabrir-sessoes-do-workspace<br>mostrar-modo-mensagens-ferramentas-anexos | reiniciar-editor → editor-restarted<br>reabrir-sessoes-do-workspace → session-reopened<br>mostrar-modo-mensagens-ferramentas-anexos → session-content-restored | |
| SES-02 | Ao exportar sessão, gravar arquivo de texto com mensagens daquela sessão. | exportar-sessao<br>gravar-arquivo-de-texto<br>confirmar-escrita | exportar-sessao → session-export-requested<br>gravar-arquivo-de-texto → export-file-written<br>confirmar-escrita → export-confirmed | |
| SES-03 | Ao restaurar checkpoint, reverter só arquivos marcados daquela execução; mostrar conflito e não gravar por cima. | selecionar-checkpoint<br>reverter-arquivos-marcados<br>reportar-conflito | selecionar-checkpoint → checkpoint-selected<br>reverter-arquivos-marcados → marked-files-reverted<br>reportar-conflito → restore-conflict-shown | |
| SES-04 | Quando criar trabalho isolado, usar worktree local e manter arquivos do workspace original intactos até aplicação escolhida. | criar-trabalho-isolado<br>criar-worktree-local<br>preservar-workspace-original | criar-trabalho-isolado → isolated-work-requested<br>criar-worktree-local → worktree-created<br>preservar-workspace-original → original-preserved | |
| SES-05 | Ao buscar texto na conversa, listar mensagens da sessão local que contêm texto. | buscar-texto-na-conversa<br>listar-mensagens-encontradas | buscar-texto-na-conversa → conversation-search-performed<br>listar-mensagens-encontradas → conversation-matches-listed | |
| SES-06 | Ao abrir conversa lateral, conservar mensagens da conversa principal. | abrir-conversa-lateral<br>preservar-conversa-principal<br>voltar-ao-principal | abrir-conversa-lateral → side-conversation-opened<br>preservar-conversa-principal → main-conversation-preserved<br>voltar-ao-principal → returned-to-main | |
| SES-07 | Ao apagar sessão, remover mensagens locais daquela sessão. | apagar-sessao<br>remover-mensagens-locais<br>conservar-outras-sessoes | apagar-sessao → session-delete-confirmed<br>remover-mensagens-locais → local-messages-removed<br>conservar-outras-sessoes → other-sessions-unaffected | |

## API — Provedores e API

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| API-01 | Ao informar endpoint, modelo e credencial, testar conexão, mostrar capacidades detectadas, guardar credencial no cofre do sistema. | informar-credenciais<br>testar-conexao<br>mostrar-capacidades<br>guardar-credencial-cofre | informar-credenciais → provider-credentials-informed<br>testar-conexao → connection-tested<br>mostrar-capacidades → capabilities-detected<br>guardar-credencial-cofre → credential-stored-system-vault | |
| API-02 | Se provedor expira/recusa taxa/ausenta capacidade, exibir causa, conservar texto digitado, não apagar diff já produzido. | gerar-diff-previo<br>enviar-com-falha<br>exibir-causa<br>conservar-prompt-e-diff | gerar-diff-previo → previous-diff-produced<br>enviar-com-falha → provider-failure-received<br>exibir-causa → failure-cause-displayed<br>conservar-prompt-e-diff → typed-text-preserved, previous-diff-preserved | |
| API-03 | Ao enviar mensagem, exibir teto de contexto em tokens; usar 200000 quando não gravado outro valor. | enviar-sem-teto-gravado<br>exibir-teto-padrao<br>enviar-com-teto-gravado<br>exibir-teto-gravado | enviar-sem-teto-gravado → message-submitted-without-ceiling<br>exibir-teto-padrao → context-ceiling-displayed<br>enviar-com-teto-gravado → message-submitted-with-saved-ceiling<br>exibir-teto-gravado → saved-context-ceiling-displayed | |

## ERR — Casos de borda e erro

| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |
|---|---|---|---|---|
| ERR-01 | Quando arquivo mudar entre geração e aplicação, impedir aplicação direta, mostrar duas versões. | gerar-patch<br>mudar-arquivo-fora<br>bloquear-aplicacao-direta<br>mostrar-duas-versoes | gerar-patch → patch-generated<br>mudar-arquivo-fora → file-changed-externally<br>bloquear-aplicacao-direta → direct-apply-blocked<br>mostrar-duas-versoes → both-versions-shown | |
| ERR-02 | Se ferramenta pedir caminho fora do workspace aprovado, negar operação, registrar 'Caminho fora do escopo.' | solicitar-operacao-fora<br>negar-operacao<br>registrar-mensagem | solicitar-operacao-fora → out-of-scope-requested<br>negar-operacao → operation-denied<br>registrar-mensagem → message-recorded | |
| ERR-03 | Se conexão cair durante streaming, marcar resposta como Incompleta, permitir tentar de novo sem alterar gravação existente. | streamar-parcial<br>queda-do-streaming<br>marcar-incompleta<br>tentar-de-novo | streamar-parcial → stream-partial-received<br>queda-do-streaming → stream-connection-dropped<br>marcar-incompleta → response-marked-incomplete<br>tentar-de-novo → partial-record-preserved, retry-issued | |
| ERR-04 | Se índice tiver trecho de arquivo que passou a excluído, remover antes da próxima busca. | indexar-trechos<br>marcar-caminho-excluido<br>remover-trecho-antes-da-busca<br>confirmar-busca-limpa | indexar-trechos → chunks-indexed<br>marcar-caminho-excluido → path-recently-excluded<br>remover-trecho-antes-da-busca → stale-chunk-removed<br>confirmar-busca-limpa → next-search-omits-excluded | |

## Contagem e integridade do checklist

- Requisitos do catálogo canônico: 53.
- Requisitos com cenário dry-drive com passos e efeitos declarados: 53/53.
- Requisitos com cenário faltando/vazio: 0 (geração falha se > 0).

Este arquivo é etapa de PREPARAÇÃO (task_198); nenhum ID é liberado pelo preenchimento programático — o aceite é a execução humana em pacote limpo, conforme ADR-001 e o roteiro acima.
