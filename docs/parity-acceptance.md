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

## Cenários diferenciais de regras, MCP e CLI (task_195)

O conjunto foi estendido (`packages/parity/src/scenarios.ts`) com os seis cenários diferenciais de regras (customização), MCP e CLI, cobrindo CUS-01, CUS-02, CUS-03, MCP-01, CLI-01 e CLI-02 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| CUS-01 | `cus-01-user-project-rules.ts` | sessão iniciada em `projeto-alfa` carrega as regras do usuário (12, `~/.openagent/rules.md`) e do projeto (8, `.openagent/rules.md`) e mostra a origem de cada uma (20 regras, `every-rule-has-origin: true`; ordem sessão < usuário < projeto < origem) |
| CUS-02 | `cus-02-command-skill-plugin-origin.ts` | comando local `/revisar-arquivo` invocado aplica a instrução declarada ("listar os riscos antes do diff") e mostra a origem (`user-command`, caminho do arquivo do comando; ordem invocação < instrução < origem) |
| CUS-03 | `cus-03-hook-denies-action.ts` | hook `pre-tool-use` nega `run-command`; a ação não é executada (`executed: false`, `HOOK_DENIED`) e a justificativa do hook é mostrada ("Hook local negou: comandos de rede desativados neste repositório."; ordem negação < impedimento < justificativa) |
| MCP-01 | `mcp-01-mcp-tools-permission.ts` | servidor MCP `banco-local` configurado com stdio e HTTP; 4 ferramentas listadas; permissão pedida para `consultar-cliente` (`mcp-call`) **antes** da execução; resultado mostrado ("1 cliente encontrado"; ordem config < listagem < permissão < execução < resultado) |
| CLI-01 | `cli-01-reuse-workspace-config.ts` | CLI iniciada em `projeto-alfa` reutiliza provedor (`local`), modo (`agent`), regras (20), MCP (1 servidor) e sessões (3) do editor daquele workspace; cada item com `same-as-editor: true` |
| CLI-02 | `cli-02-headless-session-in-editor.ts` | execução headless encerrada (`exit: 0`, sessão `sess-headless-001`) aparece no editor ao abrir o mesmo workspace (`same: true`, sessão visível; ordem fim < abertura < visibilidade) |

- Os seis cenários são **efeitos idênticos** nas duas superfícies; `runAllEditorScenarios()` dirige agora os 39 cenários e a cobertura canônica sobe de 33/33 para **39/39** (`EDITOR_REQUIREMENT_IDS` inclui CUS-01..03, MCP-01 e CLI-01..02). Os testes de cobertura do conjunto (`33 → 39`) e o relatório foram atualizados em `agent-scenarios.test.ts`, `per-state-scenarios.test.ts`, `ctx-privacy-scenarios.test.ts` e `differential-scenarios.test.ts`.
- Teste de integração co-localizado: `packages/parity/test/integration/cus-mcp-cli-scenarios.test.ts` (12 casos: efeitos e ordem por requisito — carregamento de regras e origem em CUS-01, instrução antes da origem em CUS-02, impedimento antes da justificativa em CUS-03, permissão antes da execução em MCP-01, cada reuso do workspace em CLI-01, visibilidade da sessão headless em CLI-02 —, nomes de efeito declarados, versões congeladas, determinismo, não-mutação das entradas, cobertura dos 39 requisitos com a única divergência declarada do LOC-01 e relatório).
- **Limites honestos de UAT**: como nas tasks anteriores, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos de customização (regras de usuário/projeto com origem e comando com instrução/origem), negação por hook (impedimento com justificativa), MCP (listagem, permissão prévia à execução e resultado) e CLI (reuso da configuração do workspace e sessão headless visível no editor). Eles **não provam** execução real do carregador de customização do daemon, do gate de hooks na policy, de um servidor MCP real por stdio/HTTP nem da CLI contra storage real: o aceite manual UAT desses seis requisitos (CUS-01..03, MCP-01, CLI-01..02) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Em particular, o aceite real de CUS-01/CUS-02 depende dos cards de implementação da customização (carregamento de regras com origem e loader de comandos/skills/plugins — tasks 78–83 do backlog), o de CUS-03 do motor de hooks (task 78 do backlog) e o de MCP-01 da execução de ferramentas MCP sob policy (tasks 75–76 do backlog) — este cenário modela esses requisitos pelo contrato das tabelas de efeitos puros (dry-drive) e **não substitui** o aceite contra as implementações. Os valores dos efeitos (contagens de regras, caminhos, limites de ferramentas MCP, identificadores de sessão) são fixtures sintéticos representativos, não capturas de execução real.

## Cenários diferenciais de regras, MCP e CLI (task_195) — execução do gate `build`

- `npm run check` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (`--max-warnings 0`); `npm run build` exit 0 (workspace completo).
- Suítes com **0 falhas**: `npm test` 15/15; `npm run test:unit` 428/428; `npm run test:integration` 295/295 (inclui os 12 casos novos de `cus-mcp-cli-scenarios.test.ts`); `npm run test:e2e` 48/48. Total 786 testes, 0 falhas, 0 excluídos silenciosamente.
- `npm run parity:report` exit 0: status APROVADO, 53/53 requisitos presentes no catálogo canônico.

## Cenários diferenciais de sessões (task_196)

O conjunto foi estendido (`packages/parity/src/scenarios.ts`) com os sete cenários diferenciais de sessões, cobrindo SES-01, SES-02, SES-03, SES-04, SES-05, SES-06 e SES-07 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| SES-01 | `ses-01-reopen-sessions-on-restart.ts` | editor reiniciado no workspace `projeto-alfa`; 2 sessões reabertas; por sessão (`sess-alfa-001`) modo `agent`, 6 mensagens, 3 invocações de ferramenta e 2 anexos com `allStillExists: true` (ordem reinício < reabertura < conteúdo por sessão) |
| SES-02 | `ses-02-export-session-text.ts` | exportação da sessão `sess-alfa-001` grava arquivo `sess-alfa-001.txt` em formato texto com as 6 mensagens (`allMessagesIncluded: true`) e confirmação visível (ordem pedido < gravação < confirmação) |
| SES-03 | `ses-03-checkpoint-restore-conflict.ts` | checkpoint `ckpt-runa-0004` (runa-0004, 3 arquivos marcados) reverte só os arquivos da execução (`src/servico.ts`, `src/regras.ts`, `onlyRunChanges: true`) e reporta conflito em `src/indice.ts` (`ALTERADO_APOS_A_EXECUCAO`) sem sobrescrever, com ambas as versões visíveis (ordem seleção < reversão < conflito) |
| SES-04 | `ses-04-worktree-isolation.ts` | trabalho isolado cria worktree local `worktrees/iso-001` a partir de `main`; workspace original `projeto-alfa` preservado (`localChanges: 0`, aplicação só na escolha do usuário) |
| SES-05 | `ses-05-conversation-search.ts` | busca por "anexo" na conversa da sessão local `sess-alfa-001` lista 3 mensagens (`msg-001`, `msg-004`, `msg-010`) com `source: "sessao-local"` (ordem busca < listagem) |
| SES-06 | `ses-06-side-conversation-preserves-main.ts` | conversa lateral `sess-alfa-002` aberta a partir da principal em `msg-006`; mensagens da principal preservadas sem alteração e visíveis ao voltar (ordem abertura < preservação < retorno) |
| SES-07 | `ses-07-session-delete.ts` | apagar a sessão `sess-alfa-002` remove as 4 mensagens locais dela (`remaining: 0`) sem afetar as demais sessões do workspace (`sess-alfa-001` com as 6 mensagens) |

- Os sete cenários são **efeitos idênticos** nas duas superfícies; `runAllEditorScenarios()` dirige agora os 46 cenários e a cobertura canônica sobe de 39/39 para **46/46** (`EDITOR_REQUIREMENT_IDS` inclui SES-01..07). Os testes de cobertura do conjunto (`39 → 46`) e o relatório foram atualizados em `agent-scenarios.test.ts`, `per-state-scenarios.test.ts`, `ctx-privacy-scenarios.test.ts`, `cus-mcp-cli-scenarios.test.ts` e `differential-scenarios.test.ts`.
- Teste de integração co-localizado: `packages/parity/test/integration/ses-scenarios.test.ts` (13 casos: efeitos e ordem por requisito — reinício antes da reabertura em SES-01, gravação antes da confirmação em SES-02, reversão antes do conflito em SES-03, criação do worktree antes da preservação em SES-04, busca antes da listagem em SES-05, abertura antes da preservação em SES-06, remoção antes da integridade das demais sessões em SES-07 —, nomes de efeito declarados, versões congeladas, determinismo, não-mutação das entradas, cobertura dos 46 requisitos com a única divergência declarada do LOC-01 e relatório).
- **Limites honestos de UAT**: como nas tasks anteriores, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos de sessões (reabertura por workspace, exportação em texto, restauração de checkpoint com conflito, isolamento por worktree, busca na conversa, conversa lateral e apagamento), mas **não provam** persistência real em SQLite/WAL, exportação real em disco, restauração real de CAS, worktree real do Git, busca real em FTS5 nem paridade com o Cursor de referência. Em particular, o aceite real de SES-05 depende da implementação de busca de sessão (packages/storage), o de SES-06 dos fluxos internos de sessão do daemon e o de SES-07 da remoção de dados no storage — este cenário modela esses requisitos pelo contrato das tabelas de efeitos puros (dry-drive) e **não substitui** o aceite contra as implementações. O aceite manual UAT desses sete requisitos (SES-01..07) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Os valores dos efeitos (contagens de mensagens, identificadores de sessão, caminhos de checkpoint) são fixtures sintéticos representativos, não capturas de execução real.

## Cenários diferenciais de sessões (task_196) — execução do gate `build`

- `npm run check` exit 0; `npm run typecheck` exit 0 (0 erros TS); `npm run lint` exit 0 (`--max-warnings 0`); `npm run build` exit 0 (workspace completo).
- Suítes com **0 falhas**: `npm test` 15/15; `npm run test:unit` 441/441 (colecionador `packages/*/test/**/*.test.ts` inclui as suítes de integração do parity — por isso também conta os 13 casos novos de `ses-scenarios.test.ts`); `npm run test:integration` 308/308 (inclui os 13 casos novos de `ses-scenarios.test.ts`); `npm run test:e2e` 48/48. Total 812 testes, 0 falhas, 0 excluídos silenciosamente.
- `npm run parity:report` exit 0: status APROVADO, 53/53 requisitos presentes no catálogo canônico.
- Sensor de mutação: 2 mutantes mortos em scratch `/tmp/opencode/t196-sensor` (symlink `node_modules`, sem `git stash`): `count: 3 → count: 2` em `ses-05-conversation-search.ts` (1 caso falhou) e `overwritten: false → true` em `ses-03-checkpoint-restore-conflict.ts` (1 caso falhou); baseline e pós-restauração 13/13 no scratch, worktree não alterado.

## Cenários diferenciais de provedor e casos de borda (task_197)

O conjunto foi estendido (`packages/parity/src/scenarios.ts`) com os sete cenários diferenciais de provedor (conexão/capacidades/cofre, falha preservando prompt e diff, teto de contexto) e casos de borda (conflito de arquivo, caminho fora do escopo, streaming incompleto, trecho recém-excluído no índice), cobrindo API-01, API-02, API-03, ERR-01, ERR-02, ERR-03 e ERR-04 com dry-drive bilateral (superfícies `cursor` da versão congelada 3.24.18 e `openagent` da versão corrente `0.3.0`, plataforma `linux`, provedor `cliproxy-v8.0.45` e modelo `modelo-local` nos cenários com provedor):

| Requisito | Cenário (`packages/parity/scenarios/`) | Passos observados |
| --- | --- | --- |
| API-01 | `api-01-provider-test-vault.ts` | credenciais informadas (`http://localhost:8455/v1`, `modelo-local`); conexão testada (`ok: true`); capacidades detectadas e listadas (`chat`, `edit`, `apply`); credencial guardada no cofre do sistema (`secretRef: api-01-chave-do-provedor`, `plaintextSaved: false`; ordem credenciais < teste < capacidades < cofre) |
| API-02 | `api-02-provider-failure-preserves-diff.ts` | diff prévio gravado em `src/servico.ts` (+12/−4); falha do provedor recebida (`quota_exceeded`) e causa exibida com texto; texto digitado conservado (`preserved: true`) e diff prévio preservado sem alteração (ordem diff < falha < causa < conservação) |
| API-03 | `api-03-context-ceiling-default.ts` | envio sem teto gravado exibe o teto padrão de **200000** tokens (`source: "padrao"`); envio com teto gravado (100000) exibe o valor gravado (`source: "gravado"`; ordem envio < teto < envio com teto < teto gravado) |
| ERR-01 | `err-01-file-changed-conflict-versions.ts` | patch para `src/servico.ts` (8 mudanças, `baseHash: a1b2c3`); arquivo mudado externamente em disco (`diskHash: d4e5f6`); aplicação direta bloqueada (`blocked: true`, `overwritten: false`); as duas versões (gerada e atual) exibidas com `bothVisible: true` (ordem patch < mudança < bloqueio < duas versões) |
| ERR-02 | `err-02-path-out-of-scope.ts` | ferramenta `write-file` pede `../fora-do-workspace/segredos.txt`; operação negada com código `OUT_OF_SCOPE` sem executar (`executed: false`); mensagem registrada e exibida: "Caminho fora do escopo." (ordem pedido < negação < registro) |
| ERR-03 | `err-03-incomplete-stream-retry.ts` | streaming da runa-0009 recebe 3 parciais; conexão cai; resposta marcada como **Incompleta**; gravação parcial preservada sem alteração; retry (runa-0010) emitido com `noDuplicateWrite: true` (ordem parcial < queda < Incompleta < preservação < retry) |
| ERR-04 | `err-04-index-removes-recently-excluded.ts` | índice tem 2 trechos (`src/cliente.ts#L1-40`, `src/segredos.ts#L1-25`); caminho `src/segredos.ts` passa a excluído; trecho ultrapassado removido **antes da próxima busca** (`beforeNextSearch: true`); busca seguinte não retorna o trecho excluído (`results: 0`, `excludedChunks: 0`) |

- Os sete cenários são **efeitos idênticos** nas duas superfícies; `runAllEditorScenarios()` dirige agora os 53 cenários e a cobertura canônica sobe de 46/46 para **53/53** (`EDITOR_REQUIREMENT_IDS` inclui API-01..03 e ERR-01..04) — o catálogo completo da Aceitação Única. Os testes de cobertura do conjunto (`46 → 53`) e o relatório foram atualizados em `agent-scenarios.test.ts`, `per-state-scenarios.test.ts`, `ctx-privacy-scenarios.test.ts`, `cus-mcp-cli-scenarios.test.ts`, `differential-scenarios.test.ts` e `ses-scenarios.test.ts`.
- Teste de integração co-localizado: `packages/parity/test/integration/api-err-scenarios.test.ts` (13 casos: efeitos e ordem por requisito — teste e capacidades antes do cofre em API-01, causa antes da conservação em API-02, padrão 200000 antes do valor gravado em API-03, bloqueio antes das duas versões em ERR-01, negação antes do registro em ERR-02, marcação e preservação antes do retry em ERR-03, remoção antes da busca limpa em ERR-04 —, nomes de efeito declarados, versões congeladas, determinismo, não-mutação das entradas, cobertura dos 53 requisitos com a única divergência declarada do LOC-01 e relatório).
- **Limites honestos de UAT**: como nas tasks anteriores, os cenários são dry-drive sintético — demonstram o **contrato bilateral** dos passos de provedor (teste de conexão com capacidades e cofre, falha com causa preservando prompt e diff, teto de contexto padrão) e de casos de borda (conflito de versões, escopo de caminhos, streaming incompleto com retry, remoção de trecho recém-excluído), mas **não provam** chamada real a um provedor via CLIProxyAPI sidecar, gravação real no cofre do SO (Keychain/Credential Manager/Secret Service), aplicação real de patch em disco, policy real de caminhos, streaming real do gateway nem indexador real em SQLite/FTS5. Em particular, o aceite real de API-01/API-02/API-03 depende dos cards de implementação do model gateway e do cofre, o de ERR-01 do adaptador de arquivos com comparação de hash, o de ERR-02 da policy de caminhos, o de ERR-03 do gateway com streaming idempotente e o de ERR-04 do indexador incremental — este conjunto modela esses requisitos pelo contrato das tabelas de efeitos puros (dry-drive) e **não substitui** o aceite contra as implementações. O aceite manual UAT desses sete requisitos (API-01..03, ERR-01..04) fica nas tasks de UAT (task_198+), com SO, versão e provedor/fixture registrados nas alocações. Os valores dos efeitos (endpoints, capacidades, hashes, códigos de erro, contagens de parciais, teto de tokens) são fixtures sintéticos representativos, não capturas de execução real.

## Cenários diferenciais de provedor e casos de borda (task_197) — execução do gate `build`

- `npm run check` exit 0; `npm run typecheck` exit 0 (0 erros TS); `npm run lint` exit 0 (`--max-warnings 0`); `npm run build` exit 0 (workspace completo).
- Suítes com **0 falhas**: `npm test` 15/15; `npm run test:unit` 454/454 (inclui os 13 casos novos de `api-err-scenarios.test.ts` via colecionador `packages/*/test/**/*.test.ts`); `npm run test:integration` 321/321 (inclui os 13 casos novos de `api-err-scenarios.test.ts`); `npm run test:e2e` 48/48. Total 838 testes, 0 falhas, 0 excluídos silenciosamente.
- `npm run parity:report` exit 0: status APROVADO, 53/53 requisitos presentes no catálogo canônico.
- Sensor de mutação: 2 mutantes mortos em scratch `/tmp/opencode/t197-sensor` (symlink `node_modules`, sem `git stash`): `tokens: 200000 → 200001` em `api-03-context-ceiling-default.ts` (1 caso falhou) e `"Caminho fora do escopo." → "Caminho fora do escopo"` em `err-02-path-out-of-scope.ts` (1 caso falhou); baseline e pós-restauração 13/13 no scratch, worktree não alterado.

## Preparação do aceite manual 53/53 — Linux (task_198)

**Status: preparação concluída; aceite humano pendente.** O card task_198 é de aceite manual: a execução dos 53 cenários por uma pessoa, em produto instalado de pacote limpo com GUI real, não pode ser substituída por automação — este ambiente é Linux headless e o empacotamento e o runtime de IPC real vivem em branches ainda não integradas à base da paridade (`a59a8df`). O que foi entregue aqui é a **preparação completa** do aceite, com tudo que pode ser comprovado por máquina nesta máquina.

### Artefatos de preparação

- `packages/parity/report/uat-checklist.md` — checklist UAT 1:1 com o catálogo canônico (`packages/parity/src/catalog.ts`): para cada um dos 53 IDs, critério canônico, passos observáveis na ordem do cenário diferencial e evidência esperada (efeitos declarados por passo nos dois lados do dry-drive), mais coluna em branco `Resultado/evidência (pessoa)`.
- `packages/parity/report/uat-checklist.json` — mesmo estado em formato machine-readable (`_fontes`, contagem, 53 entradas com `scenarioId`, `scenarioPath`, `steps`, `expectedEffects`).
- Gerador: `scripts/uat-checklist.mjs` (executar `node --import tsx scripts/uat-checklist.mjs`). A geração falha se o catálogo ou a cobertura dos cenários não estiverem 53/53.
- Fontes dos passos: cenários diferenciais dry-drive `packages/parity/scenarios/` (53 arquivos, task_188–task_197). Como registrado no doc da task_190: cenário sintético **não** prova paridade real por si só — é o roteiro do lado humano.
- Sensor do script novo: 1 mutante em scratch `/tmp/opencode/mutant-198` (guarda `53 → 54`): mutante sai com `exit 1` e mensagem "matriz canônica incompleta"; original com os mesmos dados sai `0`. Mutante morto em `/tmp` (sem mutação no worktree).

### Evidência de automação real desta máquina

1. **Gate `build` na base `a59a8df` deste card (worktree `feat/task-198`):** `npm run check` exit 0; `npm run build` (npm ls + typecheck + lint) exit 0; `npm test` 15/15; `npm run test:unit` 454/454; `npm run test:integration` 321/321; `npm run test:e2e` 48/48; `npm run parity:report` exit 0 — status APROVADO, 53/53 requisitos presentes. Total: 838 testes, 0 falhas.
2. **Pacote Linux da task_183 (branch `feat/task-183`, commit `d01cd39`) é funcional:** build do pacote produziu `openagent-editor-linux-x64.tar.gz` (sha256 `cce5c556be4a5544c98281624db289870f926741f8ef4c679b9fe6af6d174a6b`: `bin/` daemon, `workers/`, `sidecars/cliproxyapi/` pin+SBOM+provenance, `editor/`, `install.sh`, `sha256sums.txt`, `package-manifest.json`); `sh install.sh --verify-only` → "checksums OK"; `sh install.sh --prefix <dir-isolado>` → "instalado em <dir>" exit 0; smoke e2e do pacote `packaging/test/smoke/package-smoke.e2e.test.mts` 4/4 (build+checksum, instalação, handshake do daemon do pacote, worker de ferramentas embutido responde, checksum corrompido falha estável).
3. **Boot real headless do runtime (branch `feat/editor-runtime-b601f98e`, commit `d111154`):** `electron --no-sandbox --disable-gpu --disable-dev-shm-usage apps/editor/runtime/main.mjs --runtime-smoke` → saída `{"runtimeSmoke":{"hasEditor":true,"isolated":true,"state":{"hasOpenDocument":true}}}` e `exit 0` — janela, preload via contextBridge, isolamento do renderer e round-trip real de IPC comprovados pelo processo Electron (não apenas a ponte em Node).

### Estado integrado observado (honesto)

- **Não integrado à base `a59a8df`:** nem `packaging/linux` (task_183), nem runtime com IPC/`--runtime-smoke` (editor-runtime), nem a dependência `electron`. As evidências 2 e 3 acima foram produzidas nas worktrees das próprias branches — válidas como prova de capacidade, **não** como pacote da linha base da paridade.
- **Limitação declarada pelo task_183:** o binário do CLIProxyAPI não vai no pacote (release offline); o pacote entrega pin-manifest/SBOM/provenance com o checksum esperado. Validar o sidecar real é passo do UAT.
- PRD (rastreabilidade) registra: "Nenhum ID do gate de 53 critérios está liberado".

### Roteiro pronto para quem executa o aceite humano (Linux, máquina limpa)

```sh
# 1. A partir da integração da feat/task-183 (e do runtime de IPC):
node packaging/linux/build-package-linux.mjs --out dist
# 2. Conferir integridade e instalar em prefixo local (máquina limpa, node >= 20):
sh dist/openagent-editor/install.sh --verify-only
sh dist/openagent-editor/install.sh --prefix "$HOME"/.local/share/OpenAgent
# 3. Abrir o editor em sessão gráfica e executar o checklist humano:
#    packages/parity/report/uat-checklist.md (53 IDs), preenchendo o
#    passo realizado, o resultado observado e a evidência (SO, versão,
#    e Cursor/provedor por fixture).
# 4. Salvar o preenchimento em packages/parity/report/uat-<so>-<data>.md
#    e referenciar no card.
```

### O que ainda exige pessoa e máquina limpa (não marcado como feito)

- Os 53 IDs do `uat-checklist.md` com coluna `Resultado/evidência` vazia — execução em GUI real, incluindo fluxo principal **e** caso de erro de cada requisito (ADR-001).
- Instalação real do pacote em máquina limpa (a execução desta máquina foi em prefixo isolado, não numa máquina limpa de aceite).
- Versões Windows e macOS (task_199 e task_200), fora do escopo deste card.

