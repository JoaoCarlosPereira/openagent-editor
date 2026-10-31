# IPV-TGBD — Terminal / Git / debug

Paridade observável das superfícies de terminal integrado, Git e depuração do editor base distribuído pelo OpenAgent. Cobertura canônica: LOC-01 (terminal, Git, depuração), AGT-01/AGT-02/AGT-03, PER-02, UR PER-01/PER-03, AUT-01, AGT-04.

Origens: `O#` = URL consultada em 2026-10-30 (ver README §2.4); `#vscode` = comportamento base do Code OSS documentado publicamente; `C#` = catálogo; `A#` = arquivos OpenAgent.

## Terminal

### IPV-TGBD-01 — Terminal integrado disponível
- **QUANDO** o editor abrir ENTÃO DEVE oferecer terminal integrado com perfis alternáveis (shell próprio da distribuição), preservando os comandos nativos do editor base.
- **Teclado/A11y:** painel de terminal acionável por atalho; saída legível por leitor de tela (área textual).
- **Estados/erros:** shell indisponível → estado com instrução de configurar perfil.
- **Origem:** C# LOC-01; #vscode (terminal integrado — base do editor).
- **Cobertura:** COBERTA por LOC-01 (base do editor hospedeiro; distribuição própria: pendente).
- **Identidade:** IPO-12.

### IPV-TGBD-02 — Comandos do agente no terminal com aprovação
- **QUANDO** o agente executar comandos no terminal ENTÃO cada comando DEVE ser exibido com seus argumentos antes da execução e pedir aceitação quando exigido por run mode/permissões.
- **Teclado/A11y:** aprovação/refusão por teclado; recusa de um comando não bloqueia a próxima permissão.
- **Estados/erros:** recusa → comando não executa e é registrado; Somente leitura → mensagem canônica (PER-03).
- **Origem:** O6 (aprovação y/n antes de comandos na CLI — mesmo princípio); O5 (auto-review de deletes); C# AGT-02/PER-01.
- **Cobertura:** COBERTA por AGT-02/PER-01.
- **Identidade:** —.

### IPV-TGBD-03 — Terminal como fonte de contexto
- **QUANDO** a saída de terminal for anexada ENTÃO deve seguir CTX-01 (fonte listada, tokens, truncamento).
- **Teclado/A11y:** — (comportamento de sistema; anexo visível/chips padrão de CTX-01).
- **Origem:** O11 (`@Terminals` to include terminal output as context); C# CTX-01.
- **Cobertura:** PARCIAL por CTX-01 (anexação genérica; item terminal no menu de @: pendente — IPV-MENX-04).
- **Identidade:** —.

### IPV-TGBD-04 — Execução sem segredo em log
- **QUANDO** um comando executar ENTÃO o log NÃO DEVE incluir credenciais embutidas nem corpo bruto de resposta do modelo (PRV-02).
- **Teclado/A11y:** — (registro interno; visualização de log segue IPV-SBAR).
- **Origem:** C# PRV-02.
- **Cobertura:** COBERTA por PRV-02.
- **Identidade:** —.

## Git

### IPV-TGBD-05 — Integração de Git visível
- **QUANDO** um workspace com repositório abrir ENTÃO o editor DEVE exibir status de Git (alterações, branch) e permitir operações básicas por UI própria, preservando o comportamento do editor base.
- **Teclado/A11y:** views navegáveis; commit/diff por teclado.
- **Estados/erros:** fusão/conflito → estados visuais com ação.
- **Origem:** C# LOC-01; #vscode (Source Control do editor base).
- **Cobertura:** COBERTA por LOC-01 (base hospedeiro).
- **Identidade:** IPO-12.

### IPV-TGBD-06 — Diffs de conversa agrupados no Git
- **QUANDO** a execução alterar arquivos ENTÃO as alterações DEVEM aparecer no Source Control/diff, agrupadas por execução, para revisão integrada.
- **Teclado/A11y:** navegação arquivo a arquivo no diff.
- **Origem:** C# AGT-03 (diff agrupado); `docs/interface-parity.md` ("revisão agrupada por conversa").
- **Cobertura:** PARCIAL por AGT-03 (revisão no painel; agrupamento na view de Git: pendente).
- **Identidade:** —.

### IPV-TGBD-07 — Worktree listado
- **QUANDO** execução isolada em worktree existir ENTÃO o editor DEVE mostrar worktree/branch da execução nas views de Git com estado.
- **Teclado/A11y:** views de Git navegáveis por teclado (IPV-TGBD-05).
- **Origem:** C# SES-04; O6 (`--worktree` flag na CLI).
- **Cobertura:** COBERTA por SES-04 (view específica no Git: pendente).
- **Identidade:** —.

## Depuração

### IPV-TGBD-08 — Debugging disponível
- **QUANDO** o editor abrir projeto com configurações de debug ENTÃO DEVE oferecer depuração (breakpoints, run/debug), preservando a base do editor.
- **Teclado/A11y:** views e ações por teclado.
- **Origem:** C# LOC-01; #vscode (debug adapter do editor base).
- **Cobertura:** COBERTA por LOC-01 (base hospedeiro).
- **Identidade:** IPO-12.

### IPV-TGBD-09 — Debug mode do agente: hipótese/evidência/verificação
- **QUANDO** o usuário escolher Debug ENTÃO o agente DEVE registrar hipótese, evidência de execução e resultado de verificação antes de marcar tarefa como concluída; o painel DEVE exibir essas etapas.
- **Teclado/A11y:** etapas navegáveis por teclado; marcação antes de concluída.
- **Estados/erros:** sem evidência → tarefa não pode ser marcada como concluída.
- **Origem:** C# AGT-04; https://prod.cursor.com/for/debugging (Debug Mode — acesso 2026-10-30); `docs/feature-matrix.md` (Debug Mode pendente localmente).
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** IPO-19 (nome próprio do modo).

### IPV-TGBD-10 — Browser: console legível
- **QUANDO** a execução de browser produzir console ENTÃO o console DEVE ser área textual legível, com conteúdo copiável por teclado, executado no worker local autorizado.
- **Teclado/A11y:** área textual focável; copy por teclado.
- **Origem:** C# AUT-01.
- **Cobertura:** COBERTA por AUT-01.
- **Identidade:** —.

### IPV-TGBD-11 — DevTools do navegador integrado funcional
- **QUANDO** o navegador integrado do agente executar ENTÃO as ferramentas de inspeção (DOM/console) DEVE abrir de forma própria da distribuição, e o tema aplicado deve respeitar temas claros/escuros.
- **Teclado/A11y:** controles por teclado.
- **Estados/erros:** DevTools indisponível → estado explícito (sem falha silenciosa).
- **Origem:** O5 (3.24 fix: built-in Browser DevTools loads again).
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** —.

### IPV-TGBD-12 — Terminal com muita saída
- **QUANDO** um processo imprimir grande volume de logs ENTÃO a exibição DEVE manter desempenho com o editor base, e o leitor de tela navegar por atalho do editor base.
- **Teclado/A11y:** navegação por teclado do terminal (linha por linha).
- **Origem:** #vscode (terminal e a11y do editor base); `docs/interface-parity.md` ("estados vazios, teclado, foco, acessibilidade").
- **Cobertura:** PARCIAL — base hospedeiro herda; validação no produto: pendente.
- **Identidade:** —.

### IPV-TGBD-13 — Execução de terminal em sandbox
- **QUANDO** worker de execução disponível ENTÃO a execução de terminal DEVE seguir PER-02 (isolamento) e informar modo degradado antes do consentimento.
- **Teclado/A11y:** aviso textual anunciável antes do consentimento.
- **Origem:** C# PER-02.
- **Cobertura:** COBERTA por PER-02.
- **Identidade:** —.

### IPV-TGBD-14 — Hooks de instrumentação local
- **QUANDO** hooks locais forem configurados ENTÃO eventos locais podem anexar instrumentação e identificação ao fluxo de ferramentas; nenhum evento remoto é exigido nesta matriz (só hooks locais).
- **Teclado/A11y:** hooks listados na UI local de Settings.
- **Origem:** O5 (hooks: `postToolUse*` etc. com identificação de parent tool call — comportamento local do oráculo); C# CUS-03.
- **Cobertura:** COBERTA por CUS-03.
- **Identidade:** —.
