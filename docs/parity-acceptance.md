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
