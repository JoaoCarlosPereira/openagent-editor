# IPV-GTAB — Ghost text / Tab (autocomplete)

Paridade observável do autocomplete (equiv. comportamental do "Tab" do oráculo). Cobertura canônica: TAB-01, TAB-02, TAB-03, UI-03.

Origens: `O#` = URL consultada em 2026-10-30 (ver README §2.4); `P#` = artifactPath do inventário de proveniência; `C#` = critério canônico em `packages/parity/src/catalog.ts`; `A#` = arquivo do OpenAgent (cobertura).

### IPV-GTAB-01 — Sugestão inline enquanto digita
- **QUANDO** o motor de sugestões estiver ativo e o usuário digitar ENTÃO o editor DEVE oferecer continuação de linha ou de bloco como ghost text (texto à frente do cursor), com meio claro de aceitar/recusar/cancelar.
- **Teclado/A11y:** aceitar: Tab; recusar: Escape ou continuar digitação; o ghost é apresentado de forma não intrusiva e descritível sem cor (atributo próprio de sugestão aria, sem marca do oráculo).
- **Estados/erros:** sem sugestão → nada exibido; geração cancelada → ghost some e editor volta ao estado normal.
- **Origem:** O7 ("Suggestions appear as grayed-out text ahead of your cursor; Accept … Tab; Reject … Escape or keep typing"); C# TAB-01.
- **Cobertura:** PARCIAL por TAB-01 (sugestão inline básica existente; bloco multilinha: pendente — `docs/interface-parity.md`).
- **Identidade:** —.

### IPV-GTAB-02 — Aceitar palavra por palavra
- **QUANDO** existir sugestão ghost ENTÃO DEVE aceitar palavra a palavra com atalho (equiv. observável: Ctrl/Cmd+→), mantendo o resto da sugestão visível.
- **Teclado/A11y:** mesmo atalho em tema claro/escuro; remapeável.
- **Origem:** O7 ("Accept word-by-word: Win/Linux Ctrl + Arrow Right"); O9 (Ctrl+→ "Accept next word of suggestion").
- **Cobertura:** PENDENTE (lote de Tab maduro; sem card).
- **Identidade:** —.

### IPV-GTAB-03 — Aceitar/recusar sugestão multilinha
- **QUANDO** a sugestão tocar diversas linhas ENTÃO os controles de aceitar/recusar DEVE AO editor oferecê-los por teclado e por interface própria (junto ao bloco, com efeito observável equivalente ao do oráculo).
- **Teclado/A11y:** botões alcançáveis por teclado, sempre com texto legível.
- **Origem:** O7 ("Tab can modify multiple lines…"); C# TAB-01 (bloco multilinha).
- **Cobertura:** PARCIAL por TAB-01 (bloco multilinha: pendente).
- **Identidade:** IPO-06 (controles com rótulo/ícone próprios).

### IPV-GTAB-04 — Jump-in-file
- **QUANDO** o usuário aceitar sugestão com continuação ENTÃO o editor DEVE exibir indicação do próximo ponto de edição e permitir salto por teclado (Tab seguinte).
- **Teclado/A11y:** ao saltar, foco no próximo ponto; indicação textual (sem depender só de cor/ícone).
- **Origem:** O7 ("After you accept a Tab suggestion, press Tab again. Tab predicts your next editing location"); C# TAB-02.
- **Cobertura:** PENDENTE (sem card; `docs/feature-matrix.md` "sem saltos/edições cruzadas" e TAB-02).
- **Identidade:** —.

### IPV-GTAB-05 — Sugestão entre arquivos (portal)
- **QUANDO** a sugestão alterar outro arquivo ENTÃO DEVE exibir aviso/portal de salto entre arquivos com o caminho do outro arquivo e exigir revisão antes de aplicar (TAB-03).
- **Teclado/A11y:** portal acionável e fechável por teclado; decisão por atalho.
- **Estados/erros:** recusa → nenhum arquivo é modificado; aceitação → diff do outro arquivo aberto para revisão (agrupado no diff do painel — IPV-AGPN-11).
- **Origem:** O7 ("Tab predicts cross-file edits … a portal window appears at the bottom of the editor"); C# TAB-03.
- **Cobertura:** PENDENTE (sem card; `docs/feature-matrix.md` "sem saltos/edições cruzadas").
- **Identidade:** —.

### IPV-GTAB-06 — Indicador de status on/off na barra
- **QUANDO** o usuário quiser ver/alterar o estado das sugestões ENTÃO o editor DEVE exibir indicador na barra de status, com menu por acessibilidade: sonegar por duração (snooze), desativar global e desativar por tipo de arquivo.
- **Teclado/A11y:** menu acionável do indicador; foco nas opções.
- **Estados/erros:** snooze ativo → estado visível com tempo restante (expiração).
- **Origem:** O7 (status indicator bottom right: Snooze / Disable globally / Disable for specific extensions); C# STA-01 (status visível).
- **Cobertura:** PARCIAL por STA-01 (barra genérica) — indicador específico: pendente.
- **Identidade:** IPO-07 (ícone/rótulo próprio: "Sugestões IA" em vez de marca).

### IPV-GTAB-07 — Remap do atalho de aceitação
- **QUANDO** o usuário quiser remapear o atalho de aceitação ENTÃO o editor de atalhos (IPV-WBGL-06) DEVE exibir comando próprio remapeável para "aceitar sugestão de conclusão".
- **Teclado/A11y:** busca por texto do comando; edição por teclado.
- **Origem:** O7 ("Search for `Accept Cursor Tab Suggestions` in Keyboard Shortcuts to remap it"); C# CUS-03.
- **Cobertura:** PENDENTE (comando de aceitação em lote do motor próprio; a paleta de atalhos da base supports remap — IPV-WBGL-06).
- **Identidade:** —.

### IPV-GTAB-08 — Sinais de contexto na sugestão
- **QUANDO** houver erros de lint ou edições recentes ENTÃO o motor DEVE considerar esses sinais na sugestão (comportamento observável equivalente ao do oráculo), mostrando sugestão quando houver material suficiente e nada quando faltar contexto.
- **Teclado/A11y:** sem controles intrusivos.
- **Estados/erros:** os sinais são processados pelo motor sem exigir interação extra do usuário.
- **Origem:** O7 ("suggests code as you type, based on your recent edits, surrounding code, and linter errors").
- **Cobertura:** PENDENTE (motor próprio; sem card).
- **Identidade:** —.

### IPV-GTAB-09 — Sem reimediata após recusa
- **QUANDO** o usuário recusar uma sugestão ENTÃO a mesma sugestão não deve reaparecer imediatamente para o mesmo ponto; a próxima digitação/alteração pode pedir outra.
- **Teclado/A11y:** — (estado).
- **Origem:** comportamento observável derivado da recusa documentada (O7 — "Reject: Press Escape or keep typing"); inferência comportamental de sistema de sugestões consciente, marcada como tal.
- **Cobertura:** PENDENTE (detalhe antioscilação do motor próprio).
- **Identidade:** —.

### IPV-GTAB-10 — Desativação por linguagem persiste
- **QUANDO** o usuário desativar as sugestões para um tipo de arquivo ENTÃO a preferência DEVE persistir por sessão/workspace e ficar apenas no escopo escolhido.
- **Teclado/A11y:** gerência por Settings (IPV-SETG-14) e pelo indicador (IPV-GTAB-06).
- **Origem:** O7 (Disable for specific extensions); C# CUS-03.
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** —.

### IPV-GTAB-11 — Estado de snooze visível e reversível
- **QUANDO** o usuário sonegar sugestões por duração escolhida ENTÃO o indicador DEVE exibir estado de snooze com tempo restante e permitir reativar antes do fim.
- **Teclado/A11y:** reativação por teclado.
- **Origem:** O7 (Snooze — "Disable Tab temporarily for a chosen duration").
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** —.

### IPV-GTAB-12 — Sem sugestão de conteúdo excluído
- **QUANDO** o arquivo estiver dentro de regra de exclusão (CTX-03) ENTÃO não deve gerar sugestão para aquele conteúdo; caminho excluído não alimenta índice nem contexto da sugestão (PRV-01/PRV-02).
- **Teclado/A11y:** — (comportamento).
- **Origem:** C# CTX-03, PRV-01, PRV-02; `docs/feature-matrix.md` (ignore file).
- **Cobertura:** COBERTA por CTX-03/PRV-01 (motor próprio em fase futura segue a mesma restrição).
- **Identidade:** —.

### IPV-GTAB-13 — Renderização com CRLF/encodings
- **QUANDO** o arquivo usar terminações/encodings distintos ENTÃO a sugestão multilinha DEVE renderizar alinhada com o texto do editor (detalhe público corrigido no oráculo 3.24 para CRLF no Windows).
- **Teclado/A11y:** — (renderização).
- **Origem:** O5 (3.24: "Multi-line Tab suggestions now display correctly in files with Windows (CRLF) line endings").
- **Cobertura:** PENDENTE (motor próprio de Tab deve incluir esse teste).
- **Identidade:** —.

### IPV-GTAB-14 — Cancelamento durante geração
- **QUANDO** a geração de sugestão estiver em curso e o usuário pedir cancelamento ENTÃO o editor DEVE cancelar a geração e limpar o ghost sem efeitos residuais.
- **Teclado/A11y:** Escape cancela.
- **Origem:** C# TAB-01 (cancelar durante geração); O7.
- **Cobertura:** PARCIAL por TAB-01 (cancelamento: pendente no motor próprio).
- **Identidade:** —.

### IPV-GTAB-15 — Envio restrito a API externa
- **QUANDO** o motor de sugestões enviar requisições ENTÃO o envio só DEVE ocorrer conforme PRV-01/PRV-02 (nunca de caminhos excluídos); a interface nunca expõe o conteúdo bruto enviado.
- **Teclado/A11y:** —.
- **Origem:** C# PRV-01/PRV-02; `docs/interface-parity.md` (motor de sugestão sempre local-privacy).
- **Cobertura:** COBERTA por PRV-01/PRV-02 (infra do motor em fase futura).
- **Identidade:** —.
