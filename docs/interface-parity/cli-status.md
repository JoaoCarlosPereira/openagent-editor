# IPV-CLST — CLI e status de execução

Paridade observável da CLI local do agente e dos estados de execução compartilhados com o editor. Cobertura canônica: CLI-01, CLI-02, CAN-01 (daemon RPC), SES-01/SES-02 (sessões), STA-01.

Origens: `O#` (URL 2026-10-30), `C#` (catálogo), `A#` (arquivos OpenAgent), `#docs` (doc local `docs/`).

### IPV-CLST-01 — CLI no workspace reutiliza configuração
- **QUANDO** o usuário iniciar a CLI dentro de um workspace ENTÃO DEVE reutilizar provedor, modo, regras, MCP e sessões daquele workspace, com status de carregamento visível.
- **Teclado/A11y:** CLI textual: estados emitidos textualmente.
- **Estados/erros:** config ausente → instrução de inicializar provedor no editor.
- **Origem:** C# CLI-01; O6 (mesmo sistema de regras/MCP/modos na doc pública).
- **Cobertura:** COBERTA por CLI-01 (services/harness-daemon).
- **Identidade:** IPO-13 (nome do binário próprio).

### IPV-CLST-02 — Modos por slash/flag
- **QUANDO** o usuário quiser alternar modo na CLI ENTÃO DEVE aceitar slash command e flag própria (equiv. observável: /plan, /ask, --mode=plan), com estado atual exibido no prompt.
- **Teclado/A11y:** Shift+Tab rotaciona modos (equiv. observável).
- **Estados/erros:** flag inválida → erro com uso correto.
- **Origem:** O6 (Modes: slash commands and --mode flag; Shift+Tab).
- **Cobertura:** COBERTA por CLI-01 (modos participam do daemon).
- **Identidade:** —.

### IPV-CLST-03 — Aprovação de comandos na CLI
- **QUANDO** a CLI executar comando de terminal ENTÃO DEVE pedir aprovação (equiv. observável: y/n) antes da execução, respeitando permissões e run mode do workspace.
- **Teclado/A11y:** resposta única por teclado; recusar = n.
- **Estados/erros:** recusa → comando não executa e registra.
- **Origem:** O6 ("Before running terminal commands, CLI will ask you to approve (y) or reject (n) execution"); C# PER-01.
- **Cobertura:** COBERTA por PER-01.
- **Identidade:** —.

### IPV-CLST-04 — Sessão headless visível no editor
- **QUANDO** uma execução headless da CLI terminar ENTÃO a sessão DEVE aparecer no editor ao abrir o mesmo workspace (lista de sessões).
- **Teclado/A11y:** item na lista de sessões; abertura por teclado.
- **Origem:** C# CLI-02 (`docs/feature-matrix.md` CLI).
- **Cobertura:** COBERTA por CLI-02 (`apps/editor/src/agents/session-discovery.ts`).
- **Identidade:** —.

### IPV-CLST-05 — Retomar sessão na CLI
- **QUANDO** o usuário pedir retomar ENTÃO a CLI DEVE buscar a conversa mais recente ou por id (equiv. observável: resume/--continue/agent ls), exibindo conteúdo da sessão anterior.
- **Teclado/A11y:** textual.
- **Origem:** O6 (History: `agent resume`, `--continue`, `/resume`).
- **Cobertura:** COBERTA por CLI-01/SES-02.
- **Identidade:** —.

### IPV-CLST-06 — Modo headless (`-p`)
- **QUANDO** o usuário executar uma instrução headless ENTÃO a CLI DEVE imprimir resultado e ENCERRAR, persistindo sessão para o editor (CLI-02) e respeitando PRV-02 nos logs.
- **Teclado/A11y:** —.
- **Origem:** O6 (`-p`/`--print` non-interactive).
- **Cobertura:** PARCIAL por CLI-02 (persistência; flag `-p` específica: exigiu card próprio — lacuna listada).
- **Identidade:** —.

### IPV-CLST-07 — Compartilhamento de estado via daemon
- **QUANDO** o editor e a CLI operarem no mesmo workspace ENTÃO o daemon local DEVE compartilhar estado (session, mode, rule, MCP, permission, tools, execution) por RPC versionado, detectando incompatibilidade de versões (ver ERR-03 de protocolo na matriz: IPV-SBAR-11).
- **Teclado/A11y:** — (protocolo).
- **Origem:** C# CAN-01, CLI-01.
- **Cobertura:** COBERTA por CAN-01 (services/harness-daemon).
- **Identidade:** —.

### IPV-CLST-08 — Status de execução consistente entre superfícies
- **QUANDO** execução alternar entre editor e CLI ENTÃO o estado (Concluída/Cancelada/Incompleta, fila) DEVE ser idêntico nas duas superfícies (mesma fonte de verdade local).
- **Teclado/A11y:** —.
- **Origem:** C# STA-01/CAN-01.
- **Cobertura:** COBERTA por STA-01.
- **Identidade:** —.

### IPV-CLST-09 — Worktree flag na CLI
- **QUANDO** execução pedir worktree ENTÃO a CLI DEVE aceitar flag própria de worktree equivalente (equiv. observável: `--worktree`), refletindo no editor (SES-04).
- **Teclado/A11y:** —.
- **Origem:** O6 (`agent --workspace ... --worktree auth-fix ...`).
- **Cobertura:** COBERTA por CLI-01/SES-04.
- **Identidade:** —.

### IPV-CLST-10 — Saída limpa e controlada (Ctrl+D duplo)
- **QUANDO** o usuário pedir saída ENTÃO CLI DEVE seguir comportamento próprio de saída (equiv. observável: Ctrl+D requer duplo (double-press) sem eliminação acidental), e nunca destruir sessão em execução.
- **Teclado/A11y:** textual.
- **Origem:** O6 (Ctrl+D exit double-press).
- **Cobertura:** PARCIAL por CLI-01 (saída segura: detalhe de UX a replicar).
- **Identidade:** —.

### IPV-CLST-11 — Navegável por histórico de mensagens
- **QUANDO** o usuário quiser reutilizar mensagem anterior ENTÃO CLI DEVE permitir ciclo por texto de mensagens anteriores (equiv. observável: seta para cima).
- **Teclado/A11y:** textual.
- **Origem:** O6 (Navigation: ArrowUp cycles previous messages).
- **Cobertura:** PENDENTE (sem card de UX da CLI).
- **Identidade:** —.

### IPV-CLST-12 — CLI e logs com política de proveniência
- **QUANDO** CLI gravar logs ENTÃO deve obedecer PRV-02 (sem credencial/conteúdo excluído/corpo bruto) e registrar execução auditável como AUT-02.
- **Teclado/A11y:** —.
- **Origem:** C# PRV-02/AUT-02.
- **Cobertura:** COBERTA por PRV-02/AUT-02.
- **Identidade:** —.
