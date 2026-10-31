# IPV-PARL — Janela de agentes em paralelo (Agents Window)

Paridade observável da janela dedicada de agentes em paralelo (equiv. comportamental do "Agents Window" do oráculo). Cobertura canônica: UI-04, AGT-05, AGT-07, PRJ-01, SES-04.

Origens: `O#` (URL 2026-10-30), `C#` (catálogo), `A#` (arquivos OpenAgent).

### IPV-PARL-01 — Janela lista execuções paralelas
- **QUANDO** o usuário abrir a janela de agentes ENTÃO DEVE listar execuções locais em paralelo com nome/estado próprio de cada (andamento, concluída, cancelada, incompleta).
- **Teclado/A11y:** lista navegável; estado anunciável.
- **Estados/erros:** sem execuções → estado vazio com instrução de criar.
- **Origem:** C# UI-04; O12 (Agents Window: própria página de release notes).
- **Cobertura:** COBERTA por UI-04 + `apps/editor/src/agents/agents-window.ts`.
- **Identidade:** IPO-11 (ícone/nome próprio).

### IPV-PARL-02 — Retorno ao mesmo workspace
- **QUANDO** o usuário escolher voltar ao editor a partir da janela ENTÃO DEVE retornar ao mesmo workspace/execução em foco, com estado preservado.
- **Teclado/A11y:** comando próprio com atalho; foco retomado no painel.
- **Origem:** C# UI-04 ("comando de voltar ao editor no mesmo workspace").
- **Cobertura:** COBERTA por UI-04.
- **Identidade:** —.

### IPV-PARL-03 — Subagentes com nome/estado/resultado próprios
- **QUANDO** o agente distribuir trabalho a subagentes locais ENTÃO a janela DEVE exibir cada subagente com nome, estado e resultado próprios (linhas separadas por item), sem misturá-los num único fluxo.
- **Teclado/A11y:** cada linha expandível por teclado.
- **Origem:** C# AGT-05; O3 (subagents; custom agents em `.cursor/agents/` do oráculo — equivalente próprio com localização própria).
- **Cobertura:** COBERTA por AGT-05.
- **Identidade:** —.

### IPV-PARL-04 — Cancelar subagente isoladamente
- **QUANDO** o usuário cancelar um subagente ENTÃO somente esse subagente DEVE ser interrompido e os demais preservados.
- **Teclado/A11y:** cancelar por teclado; confirmação não obrigatória.
- **Estados/erros:** execução já terminando → marca Cancelada quando concluir.
- **Origem:** C# AGT-07.
- **Cobertura:** COBERTA por AGT-07.
- **Identidade:** —.

### IPV-PARL-05 — Unificação de resultados
- **QUANDO** subagentes concluírem ENTÃO os resultados DEVEM ser reunidos no contexto do agente principal, com indicação visível na janela de qual resultado foi recolhido.
- **Teclado/A11y:** linha de retorno navegável; atalho para a conversa principal.
- **Origem:** C# AGT-05; `docs/feature-matrix.md` (subagents — docs Agent).
- **Cobertura:** COBERTA por AGT-05.
- **Identidade:** —.

### IPV-PARL-06 — Projeto/coordenador local
- **QUANDO** o usuário criar projeto com objetivo ENTÃO a janela/painel DEVE abrir coordenador local que divide em tarefas de agentes na mesma máquina e mostra cada resultado para aceitar/rejeitar.
- **Teclado/A11y:** aceitar/rejeitar por teclado item a item.
- **Origem:** C# PRJ-01.
- **Cobertura:** COBERTA por PRJ-01.
- **Identidade:** IPO-11.

### IPV-PARL-07 — Trabalho isolado por worktree
- **QUANDO** o trabalho isolado for criado ENTÃO deve usar worktree local, preservar arquivos do workspace original até a aplicação escolhida.
- **Teclado/A11y:** cartão mostrar o worktree em uso (caminho/branch).
- **Origem:** C# SES-04; O6 (`--worktree` na CLI — mesmo mecanismo exibido).
- **Cobertura:** COBERTA por SES-04.
- **Identidade:** —.

### IPV-PARL-08 — Multitask: enfileirar versus paralelo
- **QUANDO** o usuário pedir múltiplas tarefas ENTÃO a janela/painel DEVE oferecer escolha definida entre enfileirar (AGT-06) e executar em paralelo (subagentes), com o modo escolhido visível por execução.
- **Teclado/A11y:** escolha por teclado; sem perda de foco.
- **Estados/erros:** modo paralelo indisponível sem worktree/infra local → aviso e opção de fila.
- **Origem:** O12 (multitask/parallel docs do oráculo — "run agent to parallelize your requests instead of adding them to the queue").
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** —.

### IPV-PARL-09 — Layout em tiles
- **QUANDO** existir mais de uma execução paralela ENTÃO a janela DEVE oferecer apresentação em tiles/panes para acompanhamento e comparação sem trocar de tab.
- **Teclado/A11y:** navegação entre panes por teclado; navegação clara.
- **Origem:** O12 (tiled layout no Agents Window do oráculo).
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** IPO-11.

### IPV-PARL-10 — Canvases na janela
- **QUANDO** execução paralela abrir canvas ENTÃO a janela DEVE oferecer visualização do canvas da execução sem sair da lista (equivalente comportamental aos canvases do oráculo transposto ao ambiente local)..
- **Teclado/A11y:** abrir/fechar canvas por teclado.
- **Origem:** O12 (canvases do changelog; contexto CAN-01).
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** —.

### IPV-PARL-11 — Remoção de execuções terminadas
- **QUANDO** o usuário apagar execução terminada ENTÃO a linha DEVE sair; espaço local da execução (sessão) é tratado conforme SES-07.
- **Teclado/A11y:** confirmação padrão.
- **Origem:** C# SES-07; janela lista as sessões (`session-discovery.ts`).
- **Cobertura:** COBERTA por SES-07.
- **Identidade:** —.

### IPV-PARL-12 — Recusa de nova ferramenta depois de terminação
- **QUANDO** execução listar Concluída/Cancelada ENTÃO NÃO DEVE iniciar nova ferramenta; nova mensagem criará novo turno (STA-01).
- **Teclado/A11y:** estado visível antes da mensagem.
- **Origem:** C# STA-01.
- **Cobertura:** COBERTA por STA-01.
- **Identidade:** —.
