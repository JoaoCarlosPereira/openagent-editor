# Critérios de paridade local

Cada cenário deve ser executado no Cursor de referência e no OpenAgent com o mesmo repositório de teste. Registrar versão, sistema, modelo/provedor, resultado, captura ou log e divergências. Uma capacidade só fica **concluída** quando o fluxo principal e os casos de erro passam no OpenAgent.

| ID | Capacidade | Cenário de aceitação |
| --- | --- | --- |
| E01 | Editor base | Abrir pasta, editar arquivos, usar terminal, Git, debug e instalar uma extensão compatível. |
| A01 | Chat Ask | Perguntar sobre uma função selecionada; resposta usa o contexto correto e não altera arquivos. |
| A02 | Agent | Solicitar mudança em três arquivos; agente localiza arquivos, edita, executa teste autorizado e mostra resultado. |
| A03 | Aprovações | Solicitar comando ou ferramenta sensível; usuário vê argumentos e pode aprovar ou recusar antes da execução. |
| A04 | Modos | Alternar Ask, Plan e Agent; ferramentas e permissões seguem o modo escolhido. |
| A05 | Subagentes locais | Delegar duas investigações independentes; reunir os resultados no contexto do agente principal. |
| T01 | Tab | Completar linha e bloco; aceitar, recusar, cancelar durante geração e desativar por linguagem. |
| T02 | Próximo local | Após aceitar sugestão, saltar para o próximo ponto de edição sugerido. |
| T03 | Multiarquivo | Sugerir mudança relacionada em outro arquivo e permitir revisão antes de aplicar. |
| I01 | Inline Edit | Editar seleção, inserir no cursor e revisar diff sem perder o texto original. |
| I02 | Arquivo inteiro | Aplicar refatoração de arquivo completo com prévia, rejeição e instrução de refinamento. |
| C01 | Contexto | Anexar seleção, arquivo e pasta; mostrar o que será enviado e avisar quando houver truncamento. |
| C02 | Busca | Indexar workspace, recuperar símbolos/trechos relevantes e atualizar resultados após editar arquivo. |
| C03 | Exclusões | Impedir que arquivos excluídos entrem em índice, contexto automático ou busca do agente. |
| M01 | MCP | Conectar servidor stdio e HTTP, listar ferramentas, solicitar aprovação e mostrar resultado. |
| R01 | Regras | Aplicar instruções de usuário e projeto nos modos certos; mostrar regras carregadas. |
| S01 | Sessões | Salvar, retomar, exportar e apagar conversa de um workspace. |
| S02 | Checkpoints | Restaurar alterações feitas pelo agente sem reverter edições manuais posteriores. |
| B01 | Navegador | Navegar, clicar, capturar screenshot e ler console em ambiente de teste com autorização. |
| U01 | Computador | Selecionar app, capturar tela e executar ação aprovada; registrar resultado e recusa. |
| D01 | Distribuição | Instalar pacote próprio em Linux e Windows, atualizar e preservar configurações. |

Serviços em nuvem e automações remotas serão avaliados na MVP seguinte. O provedor de modelo pode diferir do Cursor; a avaliação deve medir o comportamento da ferramenta e a qualidade mínima definida para o cenário, sem exigir respostas textualmente idênticas.

## Driver de captura dual (task_189)

`packages/parity/src/dual-driver.ts` expõe `driveDualCapture`, o driver usado pelos cenários diferenciais (task_190+): ele dirige os **mesmos passos** em duas superfícies — a superfície congelada do Cursor 3.24.18 (`product: "cursor"`, versão fixa) e a superfície do OpenAgent — e gera as duas capturas do contrato v1 (`packages/parity/src/capture.ts`, task_188) para o mesmo `requirementId` do catálogo. Superfícies são tabelas de efeitos puros (`dry-drive`): dados sintéticos por passo, sem acoplamento a marca ou binários do Cursor (proveniência behavioral, ADR-002/ADR-007). Cenários de exemplo: `packages/parity/scenarios/loc-01-open-folder.ts` e `packages/parity/scenarios/ui-01-agent-panel.ts`. Entrada ou estado inválido retorna o código estável `INVALID_STATE` sem efeito colateral e sem mutar a entrada. As capturas gêmeas alimentam a comparação diferencial por efeito conforme `docs/parity-acceptance.md`; cenários sintéticos não comprovam paridade real por si só — evidência real de aceite fica nas tarefas de UAT (task_198+).

## Cenários diferenciais do editor (task_190)

O conjunto do editor (`packages/parity/src/scenarios.ts`, `EDITOR_SCENARIOS`) cobre os requisitos LOC-01, UI-01, UI-02, UI-03 e UI-04 com cenários dirigidos pelo driver dual (dry-drive bilateral, superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente do produto):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| LOC-01 | `loc-01-open-folder.ts` | abrir pasta, editar arquivo, terminal, Git, debug, instalar extensão compatível; identidade de pacote OpenAgent no lado próprio |
| UI-01 | `ui-01-agent-panel.ts` | painel do agente, seletor de modo, seletor de modelo, contexto, histórico, revisão de alterações, navegação por teclado |
| UI-02 | `ui-02-theme-panel.ts` | tema claro → escuro, largura do painel, controles legíveis e mensagens preservadas |
| UI-03 | `ui-03-onboarding.ts` | primeira abertura, configuração do provedor, teste de conexão, abrir projeto sem conta |
| UI-04 | `ui-04-agents-window.ts` | janela de agentes, execuções locais em paralelo, comando voltar ao editor no mesmo workspace |

- `runAllEditorScenarios()` dirige os cinco cenários e `compareDualSurfaces()` compara os efeitos observáveis por `(kind, name)` entre as superfícies; a única divergência de grupo declarada é `so-no-openagent: ui:package-identity` (identidade de pacote do LOC-01). `formatEditorScenarioReport()` produz um relatório textual reproduzível por requisito (passos, contagem de efeitos por lado e divergências).
- Teste de integração co-localizado: `packages/parity/test/integration/editor-scenarios.test.ts` (7 casos: efeitos por requisito, determinismo, não-mutação da entrada, cobertura dos cinco requisitos, relatório, caminho de erro `INVALID_STATE` sem efeito colateral).
- **Limites honestos de UAT**: os cenários são dry-drive sintético (dados puros de efeito) e demonstram o contrato bilateral do passo a passo do editor; **não substituem** o aceite manual em pacotes reais com Cursor de referência e UI executada — esse aceite acontece nas tasks 198+. A comparação valida paridade contratual dos efeitos, não paridade visual real. Versões registradas nas capturas: Cursor `3.24.18` (congelado) e OpenAgent `0.3.0`; plataforma dos lances: `linux` (rodadas Windows/macOS ficam para o aceite manual multiplataforma).

## Cenários diferenciais do agente local (task_191)

O conjunto do editor foi estendido (`packages/parity/src/scenarios.ts`) com os oito cenários diferenciais do agente local, cobrindo AGT-01..AGT-07 e PRJ-01 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| AGT-01 | `agt-01-ask-no-mutation.ts` | modo Ask pergunta sobre função, responde usando leitura e busca; verificação de `files-written: 0` e `commands-executed: 0` |
| AGT-02 | `agt-02-plan-execution.ts` | plano proposto no modo Plan, aceite, execução iniciada com o plano visível e progresso por etapas |
| AGT-03 | `agt-03-agent-multi-file-diff.ts` | execução no modo Agent, edição de três arquivos (`multi-file-edit`), teste autorizado com resultado, diff agrupado e resultado por ferramenta |
| AGT-04 | `agt-04-debug-hypothesis-evidence.ts` | hipótese registrada, evidência de execução, verificação e conclusão da tarefa somente após a ordem observada |
| AGT-05 | `agt-05-subagents-named.ts` | divisão em subagentes locais; cada um com nome, estado e resultado próprios (`per-agent: true`) |
| AGT-06 | `agt-06-message-queue.ts` | mensagem durante a execução entra na fila (`ordinal`), listagem ordenada, remoção permitida só de item não iniciado; item iniciado recusado com `CONFLICT` |
| AGT-07 | `agt-07-subagent-cancel.ts` | cancelamento isolado de um subagente; demais preservados com `affected: 0` e run pai mantido |
| PRJ-01 | `prj-01-local-coordinator.ts` | projeto com objetivo cria coordenador local, divisão em tarefas de agentes na mesma máquina, resultado por tarefa e decisão de aceitar/rejeitar |

- Os oito cenários são **efeitos idênticos** nas duas superfícies (nenhuma divergência declarada); `runAllEditorScenarios()` dirige agora os 13 cenários e a cobertura canônica sobe de 5/5 para **13/13** (`EDITOR_REQUIREMENT_IDS` inclui AGT-01..07 e PRJ-01).
- Teste de integração co-localizado: `packages/parity/test/integration/agent-scenarios.test.ts` (11 casos: verificação de efeitos e ordem por requisito, determinismo, não-mutação das entradas, cobertura dos 13 requisitos com a única divergência declarada do LOC-01 e relatório).
- **Limites honestos de UAT**: como na task_190, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos do agente local (o que o produto deve observar a cada passo), mas **não provam** execução real pelo daemon, UI real ou paridade com o Cursor de referência: o aceite manual UAT desses oito requisitos (AGT-01..07, PRJ-01) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Os valores dos efeitos (quantidades de arquivos, nomes de subagentes, resultados) são fixtures sintéticos representativos, não capturas de execução real.

## Cenários diferenciais de permissão e estado (task_192)

O conjunto foi estendido (`packages/parity/src/scenarios.ts`) com os cinco cenários diferenciais de permissão e estado, cobrindo PER-01, PER-02, PER-03, STA-01 e VAL-01 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| PER-01 | `per-01-permission-accept.ts` | pedido de permissão mostra ação, alvo (`src/service.ts`) e escopo (`workspace`); aceite explícito concedido **antes** da execução (ordem verificada); ferramenta executada só depois do aceite |
| PER-02 | `per-02-cancel-execution.ts` | cancelamento durante a execução marca estado `cancelled` com `within-seconds: 2`; alteração já aplicada em `src/service.ts` preservada; ferramenta nova na mesma run recusada com `CANCELLED` |
| PER-03 | `per-03-readonly-block.ts` | modo Somente leitura ativo (`readonly-mode-active`); gravação de arquivo e comando mutável recusados com `PERMISSION_DENIED` e a mensagem "Bloqueado pelo modo de execução." |
| STA-01 | `sta-01-terminal-state.ts` | execução terminal (`completed`/`cancelled`) recusa ferramenta nova com `INVALID_STATE` na mesma run; ferramenta só aceita depois de mensagem nova (`new-message-accepts-tool`) |
| VAL-01 | `val-01-empty-message.ts` | envio sem texto e sem anexo recusado com `sent: false` e a mensagem "Escreva uma mensagem ou anexe um contexto."; anexo (1) libera o envio |

- Os cinco cenários são **efeitos idênticos** nas duas superfícies; `runAllEditorScenarios()` dirige agora os 18 cenários e a cobertura canônica sobe de 13/13 para **18/18** (`EDITOR_REQUIREMENT_IDS` inclui PER-01..03, STA-01 e VAL-01). Os testes de cobertura do conjunto (`13 → 18`) e o relatório foram atualizados em `agent-scenarios.test.ts` e no novo `per-state-scenarios.test.ts`.
- Teste de integração co-localizado: `packages/parity/test/integration/per-state-scenarios.test.ts` (8 casos: efeitos e ordem por requisito — aceite antes de executar em PER-01, Cancelada antes da recusa em PER-02, recusa antes da mensagem nova em STA-01 —, determinismo, cobertura dos 18 requisitos e relatório).
- **Limites honestos de UAT**: como nas tasks anteriores, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos de permissão, cancelamento, modo Somente leitura, estado terminal e validação de entrada, mas **não provam** execução real pelo daemon/policy, medição real dos 2 segundos do PER-02 em relógio de parede, UI real recusando envio em tela ou paridade com o Cursor de referência: o aceite manual UAT desses cinco requisitos (PER-01..03, STA-01, VAL-01) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Os valores dos efeitos (targets, tempos limites, mensagens) são fixtures sintéticos representativos, não capturas de execução real.

## Cenários diferenciais de contexto e privacidade (task_193)

O conjunto foi estendido (`packages/parity/src/scenarios.ts`) com os seis cenários diferenciais de contexto e privacidade, cobrindo CTX-01, CTX-02, CTX-03, CTX-04, PRV-01 e PRV-02 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| CTX-01 | `ctx-01-attach-context-summary.ts` | anexos de seleção (`src/index.ts#L12-L18`), arquivo (`src/service.ts`), pasta (`src/lib`) e símbolo (`function: authorize`) listados um a um; resumo **antes do envio** mostra 4 fontes, 1855 tokens e teto 200000 |
| CTX-02 | `ctx-02-incremental-index.ts` | salvar arquivo indexado (`src/service.ts`) atualiza o índice em modo `incremental` com `full-rebuild: false`; busca local acha o texto novo (`matches: 1`) sem reconstituição completa |
| CTX-03 | `ctx-03-excluded-path-omitted.ts` | regra `secrets/**` ativa; caminho `secrets/env.ts` omitido da indexação (`indexed: false`), do contexto automático (`included: false`) e da busca do agente (`matches: 0`) |
| CTX-04 | `ctx-04-index-cleanup.ts` | limpeza pedida mostra escopo (`workspace`), workspace (`projeto-alfa`) e tamanho (4718592 bytes) **antes** de apagar os dados locais daquele workspace (`remaining-bytes: 0`) |
| PRV-01 | `prv-01-explicit-external-send.ts` | contexto montado localmente (`sent: false`); ação explícita de envio (`explicit: true`) precede o envio à API externa; caminho excluído nunca enviado (`sent: false`) |
| PRV-02 | `prv-02-redacted-tool-log.ts` | log padrão registra a ação da ferramenta (`file-edit` em `src/service.ts`) e omite credencial, conteúdo do arquivo excluído (`secrets/env.ts`) e corpo bruto da resposta do modelo |

- Os seis cenários são **efeitos idênticos** nas duas superfícies; `runAllEditorScenarios()` dirige agora os 24 cenários e a cobertura canônica sobe de 18/18 para **24/24** (`EDITOR_REQUIREMENT_IDS` inclui CTX-01..04 e PRV-01..02). Os testes de cobertura do conjunto (`18 → 24`) e o relatório foram atualizados em `agent-scenarios.test.ts` e `per-state-scenarios.test.ts`.
- Teste de integração co-localizado: `packages/parity/test/integration/ctx-privacy-scenarios.test.ts` (9 casos: efeitos e ordem por requisito — resumo depois dos anexos em CTX-01, salvar < atualização incremental < busca em CTX-02, escopo/tamanho antes de apagar em CTX-04, ação explícita antes do envio externo em PRV-01 —, determinismo, cobertura dos 24 requisitos e relatório).
- **Limites honestos de UAT**: como nas tasks anteriores, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos de contexto (anexos, índice incremental, exclusões, limpeza) e privacidade (envio explícito, redaction de log), mas **não provam** contagem real de tokens por tokenizador, indexação real em SQLite/CAS, remoção física real de dados em disco, log real do daemon em execução ou paridade com o Cursor de referência: o aceite manual UAT desses seis requisitos (CTX-01..04, PRV-01..02) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Os valores dos efeitos (contagens de tokens, tamanhos em bytes, consultas e alvos) são fixtures sintéticos representativos, não capturas de execução real.

## Cenários diferenciais de Tab, Inline, navegador, desenho e canvas (task_194)

O conjunto foi estendido (`packages/parity/src/scenarios.ts`) com os nove cenários diferenciais de Tab, Inline Edit, navegador/computador autorizado, desenho e canvas, cobrindo TAB-01, TAB-02, TAB-03, INL-01, INL-02, AUT-01, AUT-02, DES-01 e CAN-01 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| TAB-01 | `tab-01-suggestion-controls.ts` | digitar com Tab ativo oferece continuação de linha (`src/service.ts:12`) e de bloco (4 inserções); controles aceitar, recusar e cancelar; cancelamento durante a geração sem aplicação parcial |
| TAB-02 | `tab-02-next-point-jump.ts` | aceite de sugestão com continuação (`has-continuation: true`, 2 instâncias) indica o próximo ponto (`src/service.ts:18`) e permite o salto por teclado (Tab, cursor movido) |
| TAB-03 | `tab-03-cross-file-review.ts` | sugestão altera `src/lib/handler.ts` a partir de `src/service.ts`; caminho exibido; aplicação somente depois de revisão (ordem caminho < revisão < aplicação) |
| INL-01 | `inl-01-inline-edit-diff.ts` | Inline Edit na seleção (`src/index.ts#L12-L18`) mostra o diff no editor (+5/−3) com aceitar, rejeitar e refinar |
| INL-02 | `inl-02-whole-file-restore.ts` | edição do arquivo inteiro (`src/service.ts`) com prévia (+42/−18); rejeição restaura o conteúdo anterior ao pedido (ordem rejeição < restauração) |
| AUT-01 | `aut-01-authorized-browser.ts` | navegador autorizado por sessão abre `http://localhost:3000`, executa a interação autorizada e mostra captura (`png`) e console (3 mensagens); ordem autorização < URL < interação < captura < console |
| AUT-02 | `aut-02-computer-action-at-a-time.ts` | uso do computador autorizado executa uma ação por vez (`screenshot`, nomeado na permissão), mostra o resultado e recusa ação fora do escopo (`run-shell`, `PERMISSION_DENIED`) |
| DES-01 | `des-01-element-code-attach.ts` | modo de desenho ativo no navegador; elemento `button#submit` selecionado; identificação e trecho (`web/app.tsx#L40-L46`) anexados à mensagem seguinte antes do envio |
| CAN-01 | `can-01-canvas-persistent-panel.ts` | agente abre canvas ("Comparativo de migração"); conteúdo exibido no painel; após o fim da resposta o canvas permanece visível (ordem abertura < exibição < fim < persistência) |

- Os nove cenários são **efeitos idênticos** nas duas superfícies; `runAllEditorScenarios()` dirige agora os 33 cenários e a cobertura canônica sobe de 24/24 para **33/33** (`EDITOR_REQUIREMENT_IDS` inclui TAB-01..03, INL-01..02, AUT-01..02, DES-01 e CAN-01). Os testes de cobertura do conjunto (`24 → 33`) e o relatório foram atualizados em `agent-scenarios.test.ts`, `per-state-scenarios.test.ts` e `ctx-privacy-scenarios.test.ts`.
- Teste de integração co-localizado: `packages/parity/test/integration/differential-scenarios.test.ts` (11 casos: efeitos e ordem por requisito — controles de Tab-01 e cancelamento sem aplicação parcial, salto após indicação em TAB-02, revisão antes da aplicação em TAB-03, rejeição antes da restauração em INL-02, autorização antes da interação em AUT-01, recusa de ação fora da permissão em AUT-02, anexo antes do envio em DES-01, persistência após o fim em CAN-01 — determinismo, não-mutação das entradas e relatório).
- **Limites honestos de UAT**: como nas tasks anteriores, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos de Tab (sugestão/controles/salto/multiarquivo), Inline Edit (diff/refino/restauração), automação autorizada (URL/captura/console, uma ação por vez), desenho (anexo de elemento) e canvas (painel persistente), mas **não provam** execução real do provedor de Tab, gerador de diff inline, motor de navegador/computer-use, pipeline de anexo do modo desenho nem do painel de canvas na UI. Em particular, o aceite real de DES-01 depende do card de implementação task_181 e o de CAN-01 depende do card task_182 — este cenário modela esses requisitos pelo contrato das tabelas de efeitos puros (dry-drive) e **não substitui** o aceite contra as implementações. O aceite manual UAT desses nove requisitos (TAB-01..03, INL-01..02, AUT-01..02, DES-01, CAN-01) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Os valores dos efeitos (alvos, difs, URLs, seletores, mensagens de console) são fixtures sintéticos representativos, não capturas de execução real.
