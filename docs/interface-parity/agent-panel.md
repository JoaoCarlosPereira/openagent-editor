# IPV-AGPN — Painel do agente / composer / seletores

Paridade observável do painel principal de conversa com o agente (composer) do Cursor 3.24.18, com identidade OpenAgent própria. Cobertura canônica: UI-01, UI-03, AGT-01..AGT-04, PRV-01, PRV-02, API-01..API-03, ERR-01..ERR-03, CAN-01, AUT-01..AUT-02.

Formato por critério: **QUANDO** … **ENTÃO** … **DEVE**; campos Teclado/A11y, Estados/erros, Origem, Cobertura, Identidade. Origens: `O#` = URL consultada em 2026-10-30 (ver README §2.4); `P#` = caminho do artefato registrado em `research/provenance/cursor-3.24.18.inventory.json` (bundle gitignored/ausente neste checkout — consulte o hash); `C#` = critério canônico em `packages/parity/src/catalog.ts`; `A#` = arquivo do OpenAgent (cobertura).

## Composição do painel

### IPV-AGPN-01 — Painel acessível a partir de atalho global
- **QUANDO** o usuário pressionar o atalho de painel do agente (equivalente observável: Ctrl+I / Ctrl+L, remapeável) ENTÃO o editor DEVE abrir ou alternar o painel do agente no lado da janela, com foco no campo de entrada.
- **Teclado/A11y:** o painel é focável como região; campo de entrada recebe foco; rótulo de região anunciável por leitor de tela (ex.: "painel do agente").
- **Estados/erros:** painel já aberto → apenas alterna foco/fechamento; janela estreita sobreposta → painel em largura mínima legível (IPV-WBGL-09).
- **Origem:** O8/O9 (Ctrl+I, Ctrl+L, Ctrl+K "Toggle Sidepanel"); P# `sources/cursor/docs.md` (h sha256 registrado no inventário de proveniência).
- **Cobertura:** COBERTA por UI-01 (painel próprio em `apps/editor/src/agent/agent-panel.ts`, `agent-panel-keyboard.ts`).
- **Identidade:** IPO-01.

### IPV-AGPN-02 — Composição mínima do painel
- **QUANDO** o painel abrir ENTÃO DEVE exibir: lista de conversa, campo de entrada do composer, seletor de modo, seletor de modelo, indicador de contexto e área de revisão de alterações da execução.
- **Teclado/A11y:** todos os controles navegáveis por Tab em ordem lógica (conversa → revisão → seletores → entrada).
- **Estados/erros:** sem sessão → estado vazio com chamada de criação de conversa (IPV-AGPN-04).
- **Origem:** C# UI-01 (catálogo "Painel e controles acessíveis"); `docs/interface-parity.md` seção "Painel Agent".
- **Cobertura:** COBERTA por UI-01 (`apps/editor/src/agent/agent-panel-view.ts`, `agent-panel-selectors.ts`).
- **Identidade:** —.

### IPV-AGPN-03 — Seletor de modo Ask/Plan/Agent
- **QUANDO** o usuário abrir o seletor de modo ENTÃO DEVE listar os modos Ask, Plan e Agent com descrição curta do efeito de cada um (Ask: somente leitura; Plan: cria plano antes de escrever; Agent: edita, executa comandos) e aplicar o modo escolhido à sessão.
- **Teclado/A11y:** seletor abre por teclado (equivalente observável: Ctrl+. ou Shift+Tab para rotacionar); setas + Enter selecionam; Escape fecha mantendo modo atual.
- **Estados/erros:** modo atual marcado como selecionado; troca de modo durante execução → item passa a seguir a regra de IPV-AGPN-10.
- **Origem:** O1 (modos e efeitos: "Ask … Read-only exploration … no automatic changes"); C# AGT-04, AGT-01/02/03.
- **Cobertura:** COBERTA por AGT-04 + `apps/editor/src/agent/agent-panel-selectors.ts` (Ask/Agent; Plan e Debug: pendente).
- **Identidade:** —.

### IPV-AGPN-04 — Nova conversa
- **QUANDO** o usuário pedir nova conversa (botão/atalho; equivalentes observáveis Ctrl+N ou Ctrl+R) ENTÃO o sistema DEVE iniciar conversa em branco preservando o modo/modelo escolhidos e mantendo a conversa anterior acessível no histórico.
- **Teclado/A11y:** atalho registrado e remapeável; confirmação não exigida se não houver geração em curso.
- **Estados/erros:** geração em andamento → nova conversa desabilitada/diálogo de confirmação; a atual fica preservada.
- **Origem:** O9 (Cmd N / Cmd R "New chat"); C# SES-01/SES-05 (persistência).
- **Cobertura:** COBERTA por UI-01 (`agent-panel-view.ts`).
- **Identidade:** —.

### IPV-AGPN-05 — Indicador de modelo e troca
- **QUANDO** houver sessão ativa ENTÃO o painel DEVE exibir o modelo atual e permitir escolha de outro; ao trocar, o sistema DEVE preservar o texto digitado e a conversa.
- **Teclado/A11y:** seletor abre por teclado; equivalentes observáveis listados (Ctrl+/, Ctrl+Alt+/); opções navegáveis por setas.
- **Estados/erros:** modelo indisponível → escolha marcada com causa (API-02); provedor não configurado → abre página de provedor (IPV-SETG-01).
- **Origem:** O9 ("Loop between AI models", model toggle); C# SES-05, API-02.
- **Cobertura:** COBERTA (parcial) por UI-01/SES-05; listagem com capabilities → IPV-SETG-01.
- **Identidade:** —.

### IPV-AGPN-06 — Indicador de contexto/teto no composer
- **QUANDO** o usuário compuser uma mensagem ENTÃO o painel DEVE exibir contagem de tokens usados/teto antes do envio; teto padrão 200.000 tokens quando nenhum outro valor gravado.
- **Teclado/A11y:** indicador texto legível; não exclusivo por cor.
- **Estados/erros:** acima do teto → aviso antes do envio (API-03).
- **Origem:** O2 (barra "Context: 0/200k (0%)" visível na doc); C# API-03, CTX-01.
- **Cobertura:** PARCIAL por API-03 + `apps/editor/src/context/context-send-preview-view.ts` (fontes sim; tokenizador: pendente).
- **Identidade:** —.

## Fluxo de conversa

### IPV-AGPN-07 — Envio com estado de geração visível
- **QUANDO** uma mensagem é enviada ENTÃO o painel DEVE exibir estado de geração (indicador de progresso/atividade), encadeando mensagens do usuário e da execução em ordem, e aceitar cancelamento enquanto gera.
- **Teclado/A11y:** atalho de cancelamento (equivalente observável: Ctrl+Shift+Backspace); foco permanece no campo para digitação da próxima mensagem.
- **Estados/erros:** geração cancelada → item marcado "Cancelada" e permitida nova mensagem (PER-02); streaming caiu → "Incompleta" com retry (ERR-03).
- **Origem:** O9 (Ctrl+Shift+Backspace cancel); C# PER-02, ERR-03.
- **Cobertura:** COBERTA por `apps/editor/src/agent/run-cancel-panel*` + ERR-03 (card task em `services/harness-daemon`).
- **Identidade:** —.

### IPV-AGPN-08 — Mensagem vazia recusada
- **QUANDO** o envio for acionado sem texto e sem anexo ENTÃO o sistema DEVE recusar o envio e exibir instrução própria ("Escreva uma mensagem ou anexe um contexto.").
- **Teclado/A11y:** foco retorna ao campo; instrução anunciável.
- **Origem:** C# VAL-01.
- **Cobertura:** COBERTA por VAL-01.
- **Identidade:** texto fixado pelo catálogo canônico (não é marca do oráculo); —.

### IPV-AGPN-09 — Modo Ask sem mutação
- **QUANDO** o modo Ask estiver ativo e o usuário enviar instrução ENTÃO o agente DEVE responder usando leitura e busca, sem gravar arquivo nem executar comando, exibindo as fontes lidas.
- **Teclado/A11y:** lista de fontes navegável e anunciável.
- **Estados/erros:** tentativa de mutação indisponível no modo (nada é oferecido em UI).
- **Origem:** O1 ("Read-only exploration, no automatic changes"); C# AGT-01.
- **Cobertura:** COBERTA por AGT-01.
- **Identidade:** —.

### IPV-AGPN-10 — Plano revisável antes de construir
- **QUANDO** o usuário pedir tarefa no modo Plan ENTÃO o agente DEVE produzir plano revisável (arquivo virtual no painel, editável), com ação clara de construir após aceite e opção de salvar o plano no workspace.
- **Teclado/A11y:** abrir/plano, editar, aceitar tudo por teclado; foco retornado ao campo após ação.
- **Estados/erros:** plano rejeitado → instrução refinável antes de novo plano; salvar no workspace → exibe caminho de destino.
- **Origem:** O4/O1 (plano como virtual file, "Save to workspace" para pasta de planos do projeto); C# AGT-02.
- **Cobertura:** PENDENTE (lote de modos: Plan parcial em `docs/feature-matrix.md` "Ask e Agent básicos; Plan e Debug pendentes"; card a definir).
- **Identidade:** —.

### IPV-AGPN-11 — Agente edita, testa e mostra diff agrupado
- **QUANDO** o modo Agent concluir trabalho em arquivos ENTÃO o painel DEVE mostrar diff agrupado por arquivo com aceitar/rejeitar por arquivo e por hunk, e resultado de cada ferramenta (execução de teste incluída).
- **Teclado/A11y:** revisão navegável por teclado entre arquivos/hunks; botões de aceite/rejeição alcançáveis (equivalente observável: Ctrl+Enter aceita todos, Ctrl+Shift+Backspace rejeita todos).
- **Estados/erros:** arquivo modificado externamente entre geração e aplicação → bloqueio com duas versões (ERR-01).
- **Origem:** O9 (accept/reject all); `docs/interface-parity.md` "revisão de alterações"; C# AGT-03, ERR-01.
- **Cobertura:** COBERTA por AGT-03 + `apps/editor/src/review/`.
- **Identidade:** —.

### IPV-AGPN-12 — Perguntas ao vivo durante execução
- **QUANDO** o agente fizer pergunta de esclarecimento durante execução ENTÃO o painel DEVE exibir a pergunta com espaço de resposta e continuar trabalho em andamento; a resposta entra na conversa na chegada.
- **Teclado/A11y:** campo de resposta recebe foco automático opcional (configurável); resposta por Enter.
- **Estados/erros:** resposta omitida → execução continua até próximo ponto de decisão.
- **Origem:** O2 ("Ask clarifying questions … answer is incorporated as soon as it arrives").
- **Cobertura:** PENDENTE (interação de clarifying question: sem card; listar em crosscheck).
- **Identidade:** —.

### IPV-AGPN-13 — Checkpoints por conversa
- **QUANDO** o agente fizer alterações significativas ENTÃO o sistema DEVE exibir pontos de restauração por conversa: ao acionar restauração sob uma mensagem, DEVE reverter arquivos afetados àquele ponto sem remover mensagens.
- **Teclado/A11y:** ação acionável por teclado no item da conversa; confirmação explícita.
- **Estados/erros:** conflito com edições manuais posteriores → prévia de conflito sem sobrescrever (SES-03).
- **Origem:** O3 (hover "Restore Checkpoint", revert de arquivos, conversa intacta); C# AGT-06, SES-03.
- **Cobertura:** PENDENTE (checkpoints não implementados no painel; `docs/feature-matrix.md` "Pendente").
- **Identidade:** —.

## Identidade própria no painel

### IPV-AGPN-14 — Identidade visual própria nas telas
- **QUANDO** qualquer tela do painel exibir detalhes de identidade ENTÃO DEVE usar nome, logotipo, ícones e paleta OpenAgent, e nunca assets da marca do oráculo.
- **Teclado/A11y:** contraste mínimo em tema claro/escuro (UI-02).
- **Origem:** `docs/provenance-policy.md`; `research/provenance/cursor-3.24.18.inventory.json` (`containsCursorBrandAssets: false`).
- **Cobertura:** PENDENTE (distribuição/identidade visual própria; ver IPO-01).
- **Identidade:** IPO-01.

### IPV-AGPN-15 — Canvas persistente no painel
- **QUANDO** o agente abrir um canvas durante execução ENTÃO o painel DEVE exibir o conteúdo do canvas e mantê-lo visível após fim da resposta.
- **Teclado/A11y:** canvas aberto focável e navegável por teclado.
- **Estados/erros:** canvas fechado durante resposta → reaparece ao prompt da próxima mensagem; conteúdo disponível no histórico.
- **Origem:** https://cursor.com/changelog/cloud-agent-canvases-and-environments (acesso 2026-10-30: "Canvases from cloud agents" — comportamento de exibição dentro do chat transposto a workbench local); C# CAN-01.
- **Cobertura:** COBERTA por CAN-01.
- **Identidade:** —.

### IPV-AGPN-16 — Browser autorizado com captura e console
- **QUANDO** o agente receber permissão de navegador ENTÃO o painel DEVE exibir capturas e texto de console das interações executadas; ao selecionar elemento na prévia, DEVE anexar identificação e trecho à próxima mensagem.
- **Teclado/A11y:** prévia com controles de navegação por teclado; console legível por screen reader (área textual).
- **Estados/erros:** permissão negada → estado com convite de autorizar; nenhum navegador aberto sem autorização.
- **Origem:** `docs/interface-parity.md` (browser-automation); C# AUT-01, DES-01.
- **Cobertura:** COBERTA por AUT-01/DES-01.
- **Identidade:** —.

### IPV-AGPN-17 — Computer use uma ação por vez
- **QUANDO** o usuário autorizar uso do computador ENTÃO o painel DEVE executar uma ação nomeada por vez, mostrar cada resultado e pedir autorização para a próxima.
- **Teclado/A11y:** cartão de ação com botões por teclado.
- **Estados/erros:** ação recusada → nenhuma execução, registro do motivo.
- **Origem:** `docs/feature-matrix.md` (computer-use e permissões de screenshot/click/scroll/digitação no bundle Windows); C# AUT-02.
- **Cobertura:** COBERTA por AUT-02.
- **Identidade:** —.

### IPV-AGPN-18 — Erro de provedor preserva prompt e diff
- **QUANDO** o provedor expirar/limitar/não ter capacidade ENTÃO o painel DEVE exibir causa clara e conservar texto digitado e diff já produzido, permitindo retry.
- **Teclado/A11y:** botão de retry alcançável por teclado; mensagem anunciada.
- **Estados/erros:** timeout/429/capability ausente — estados distintos com mesma exigência (API-02).
- **Origem:** C# API-02; O5 (banners de erro de credits: o ordenamento visual com outras notificações segue IPV-SBAR).
- **Cobertura:** COBERTA por API-02.
- **Identidade:** —.

### IPV-AGPN-19 — Log de execução sem segredos
- **QUANDO** o painel gravar log de ações externas ENTÃO DEVE omitir credencial, conteúdo de arquivo excluído e corpo bruto do modelo, mas registrar a ação com origem.
- **Teclado/A11y:** visualização de log com busca textual.
- **Origem:** C# PRV-02; `docs/provenance-policy.md`.
- **Cobertura:** COBERTA por PRV-02.
- **Identidade:** —.

### IPV-AGPN-20 — Conversa lateral preserva principal
- **QUANDO** o usuário abrir conversa lateral (comando próprio, equivalente com efeito observável ao `/side`/`/btw` do oráculo público) ENTÃO o painel DEVE abrir conversa independente preservando a conversa atual intacta e permitindo referência cruzada com `@Chats`/menção ao painel.
- **Teclado/A11y:** alternância por teclado entre principal e lateral; rótulos diferenciáveis.
- **Estados/erros:** fechar lateral sem envio → descartado ou salvo conforme escolha explicitada.
- **Origem:** O2 ("Type `/side` or `/btw` … uses the parent thread as hidden reference context and keeps its own transcript"); C# SES-06.
- **Cobertura:** COBERTA por SES-06 + `apps/editor/src/agent/side-conversation.ts`.
- **Identidade:** comando disparador próprio (IPO-02).

### IPV-AGPN-21 — Busca de texto na conversa
- **QUANDO** o usuário acionar busca na conversa ENTÃO o sistema DEVE listar mensagens da sessão local contendo o texto, com navegação pelo resultado.
- **Teclado/A11y:** campo de busca com atalho; resultados navegáveis.
- **Origem:** `docs/interface-parity.md` (conversation search); C# SES-05.
- **Cobertura:** COBERTA por SES-05 + `apps/editor/src/agent/conversation-search.ts`.
- **Identidade:** —.

### IPV-AGPN-22 — Revisão integrada alcançável por teclado
- **QUANDO** qualquer controle de revisão (aceitar/rejeitar/diff) existir no painel ENTÃO DEVE ser alcançável somente por teclado, com contraste e foco visíveis nos dois temas.
- **Teclado/A11y:** ordem de tabulação consistente sob largura mínima e nos dois temas (UI-02).
- **Origem:** C# UI-01, UI-02.
- **Cobertura:** COBERTA por UI-01/UI-02 + `apps/editor/src/agent/agent-panel-keyboard.ts`.
- **Identidade:** —.
