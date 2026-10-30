# IPV-SBAR — Statusbar, notificações e erros

Paridade observável da barra de status, centro de notificações e superfícies de erro do editor. Cobertura canônica: STA-01, API-02, ERR-01..ERR-04, PER-02/PER-03.

Origens: `O#` (URL 2026-10-30), `C#` (catálogo), `A#` (arquivos OpenAgent), `#vscode` (comportamento base Code OSS documentado publicamente — https://code.visualstudio.com, O13).

## Barra de status

### IPV-SBAR-01 — Itens canônicos de status
- **QUANDO** o editor exibir a barra inferior ENTÃO DEVE apresentar: status de conexão com modelo, tokens consumidos da sessão, fila de tarefas, ferramentas ativas e indicadores de erro.
- **Teclado/A11y:** itens de status acionáveis por teclado; textos de rótulo legíveis (não só cor/ícone).
- **Estados/erros:** item sem dado válido → "—" (sem simulação de valor).
- **Origem:** C# STA-01.
- **Cobertura:** COBERTA por STA-01.
- **Identidade:** IPO-07 (ícones/rótulos próprios).

### IPV-SBAR-02 — Indicador de sugestões/Tab
- **QUANDO** o motor de sugestões estiver disponível ENTÃO a barra DEVE exibir indicador com menu de on/off global, por linguagem e snooze (ver IPV-GTAB-06).
- **Teclado/A11y:** menu acionável.
- **Origem:** O7 (status indicator bottom-right).
- **Cobertura:** PENDENTE (indicador específico; sem card).
- **Identidade:** IPO-07.

### IPV-SBAR-03 — Conexão de modelo com estado de falha
- **QUANDO** a conexão com o provedor falhar ENTÃO o item de status DEVE mudar para estado de erro com causa acessível ao clique/teclado, preservando o resto da barra útil.
- **Teclado/A11y:** ação abre painel de erro com retry.
- **Origem:** C# API-02/STA-01.
- **Cobertura:** COBERTA por API-02/STA-01.
- **Identidade:** —.

### IPV-SBAR-04 — Modo de execução visível
- **QUANDO** modo de execução/Somente leitura ativo ENTÃO DEVE haver indicador permanente com atalho para a página de permissões (PER-03).
- **Teclado/A11y:** indicador anunciável.
- **Origem:** C# PER-03.
- **Cobertura:** COBERTA por PER-03.
- **Identidade:** —.

## Notificações

### IPV-SBAR-05 — Centro de notificações
- **QUANDO** ocorrer evento digno de notificação (conclusão, erro, pedido de permissão) ENTÃO o editor DEVE notificar na área própria (toast/centro) com nível (info/aviso/erro), ação e descarte próprio.
- **Teclado/A11y:** notificações empilhadas, navegáveis por teclado, com descarte; anúncio por região apropriada.
- **Estados/erros:** notificação crítica → não desaparece pelo tempo; exige ação.
- **Origem:** #vscode (notification center do editor base — comportamento herdado e mobilizado na distribuição própria); `docs/interface-parity.md` (estrutura do workbench).
- **Cobertura:** PENDENTE (base do workbench hospedeiro até a distribuição própria; lote do workbench).
- **Identidade:** IPO-07.

### IPV-SBAR-06 — Banner de limite/uso no composer
- **QUANDO** houver aviso de limite/uso ENTÃO o banner DEVE aparecer no composer sem esconder a entrada e sem se empilhar sob um erro de limite (comportamento público do oráculo 3.24: o banner não se empilha sob erro).
- **Teclado/A11y:** banner cancelável por teclado; texto completo.
- **Origem:** O5 ("usage-limit banner no longer stacks under a usage-limit error in the composer").
- **Cobertura:** PARCIAL por API-02 (estado de limite; banner no composer: pendente).
- **Identidade:** —.

### IPV-SBAR-07 — Permissão como notificação crítica
- **QUANDO** ferramenta pedir permissão ENTÃO o cartão de permissão DEVE aparecer como interrupção de primeira ordem com aceitar/recusar e não apenas toast transiente.
- **Teclado/A11y:** aceitar/recusar por teclado; Escape = recusar.
- **Origem:** C# PER-01.
- **Cobertura:** COBERTA por PER-01 (`permission-dialog.ts`).
- **Identidade:** —.

### IPV-SBAR-08 — Progresso visível sem bloquear
- **QUANDO** progresso de operação de dados (indexação, teste de conexão) ocorrer ENTÃO DEVE exibir progresso com estado final e possibilidade de acompanhamento sem bloquear a janela.
- **Teclado/A11y:** progresso anunciável ao início e fim.
- **Origem:** #vscode (progress API padrão do editor base); CTX-04 (limpeza com escopo).
- **Cobertura:** PARCIAL por CTX-04 (ação de limpar; progressos gerais herdados do editor base).
- **Identidade:** —.

## Erros

### IPV-SBAR-09 — Erros registrados localmente e exportáveis
- **QUANDO** um erro ocorrer ENTÃO o sistema DEVE registrá-lo localmente com causa e permitir exportação de arquivo.
- **Teclado/A11y:** ação de exportação por teclado; caminho ajustado.
- **Origem:** C# ERR-01 (registro local + exportação).
- **Cobertura:** COBERTA por ERR-01.
- **Identidade:** —.

### IPV-SBAR-10 — Isolamento de falhas de ferramentas
- **QUANDO** uma ferramenta falhar ENTÃO a falha DEVE ficar contida no escopo declarado da ferramenta; o editor segue operável; o painel exibe a falha com estado instantâneo sem corromper a sessão.
- **Teclado/A11y:** estado explicativo textual.
- **Origem:** C# ERR-02.
- **Cobertura:** COBERTA por ERR-02.
- **Identidade:** —.

### IPV-SBAR-11 — Incompatibilidade de protocolo
- **QUANDO** haver incompatibilidade de versão do protocolo ENTÃO a interface DEVE reportar e impedir ações mutáveis no estado incompatível (estado de safe mode).
- **Teclado/A11y:** mensagem na barra e no centro de notificação.
- **Origem:** C# ERR-03.
- **Cobertura:** COBERTA por ERR-03.
- **Identidade:** —.

### IPV-SBAR-12 — Streaming interrompido
- **QUANDO** a conexão cai durante streaming ENTÃO o painel DEVE marcar Incompleta e exibir retry sem alterar gravação existente (em conjunto com IPV-AGPN-07)).
- **Teclado/A11y:** Retry por teclado.
- **Origem:** C# ERR-03.
- **Cobertura:** COBERTA por ERR-03.
- **Identidade:** —.

### IPV-SBAR-13 — Backup consistente com recovery visível
- **QUANDO** o sistema de dados entrar em recovery ENTÃO a interface DEVE informar o estado e recompor de forma consistente event log e CAS; a operação é transparente ao usuário e registra interrupções internas.
- **Teclado/A11y:** —.
- **Origem:** C# ERR-04.
- **Cobertura:** COBERTA por ERR-04.
- **Identidade:** —.

### IPV-SBAR-14 — Mensagens canônicas sem brand
- **QUANDO** qualquer mensagem de erro/serviço exibir texto próprio ENTÃO esses textos DEVEM ser próprios (PT-BR local), mantendo os textos canônicos do catálogo verificáveis (ex.: "Bloqueado pelo modo de execução.", "Caminho fora do escopo.") sem inclusão de marca estrangeira.
- **Teclado/A11y:** leitura anunciável; não depende de cor.
- **Origem:** C# PER-03/ERR-02 (textos canonizados); `docs/provenance-policy.md`.
- **Cobertura:** COBERTA por PER-03/ERR-02.
- **Identidade:** —.

### IPV-SBAR-15 — A11y global de notificações
- **QUANDO** notificações existirem ENTÃO não devem causar captura inesperada de foco; leitor de tela anuncia por prioridade; informações nunca só por cor.
- **Teclado/A11y:** região viva/notificação anunciável; ações por teclado.
- **Origem:** princípio de `docs/interface-parity.md` ("foco, acessibilidade"); #vscode padrão.
- **Cobertura:** PENDENTE (lote de workbench).
- **Identidade:** —.
