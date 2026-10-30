# IPV-MENX — Menções e contexto (@)

Paridade observável do sistema de menções e contexto do composer (equiv. comportamental do `@` do oráculo). Cobertura canônica: CTX-01..CTX-04, PRJ-01 (recuperação), PRV-01, AGT-02.

Origens: `O#` (URL 2026-10-30), `C#` (catálogo), `A#` (arquivos OpenAgent).

### IPV-MENX-01 — Menu de @ no campo de entrada
- **QUANDO** o usuário digitar o caractere de menção (próprio: `@`) no campo de entrada ENTÃO DEVE abrir lista filtrável de categorias de contexto com descrição de efeito por item.
- **Teclado/A11y:** setas navegam, Enter/Tab completa, Escape fecha; lista anunciável.
- **Estados/erros:** nenhum resultado → mensagem vazia com instrução.
- **Origem:** O11 ("Type @ in the chat input to attach specific context").
- **Cobertura:** PARCIAL por CTX-01 (`apps/editor/src/context/panel-context-slot.ts` — anexação; menu de @ completo: pendente).
- **Identidade:** —.

### IPV-MENX-02 — Arquivos e pastas
- **QUANDO** o usuário escolher categoria de arquivo/pasta ENTÃO DEVE listar arquivos do workspace filtráveis, permitir navegar dentro de pastas com o separador de caminho e anexar cada fonte com chip visível.
- **Teclado/A11y:** navegação tipo autocomplete; Enter anexa.
- **Estados/erros:** arquivo inexistente após refetch → chip marcado como inválido, com ação de remover.
- **Origem:** O11 ("Files & Folders … type / after selecting a folder to navigate deeper"); C# CTX-01.
- **Cobertura:** COBERTA por CTX-01 (lista de fontes); navegação `/` profunda: pendente.
- **Identidade:** —.

### IPV-MENX-03 — Símbolos e busca codebase
- **QUANDO** o usuário escolher símbolo/recuperação ENTÃO o sistema DEVE sugerir símbolos e trechos relevantes do índice local (lexical+semântico) e anexar o comando escolhido como fonte.
- **Teclado/A11y:** autocomplete com ranking; descrição anuncável.
- **Estados/erros:** índice ausente → instrução de indexar (CTX-02); item excluído (CTX-03) nunca aparece.
- **Origem:** C# CTX-02/CTX-03; O11 (Agent encontra arquivos por busca própria).
- **Cobertura:** PARCIAL por CTX-02 (busca em implementação; autocomplete de menção deste tipo: pendente).
- **Identidade:** —.

### IPV-MENX-04 — Terminals como contexto
- **QUANDO** o usuário anexar terminal ENTÃO DEVE listar terminais ativos e anexar a saída selecionada como contexto, com aviso do tamanho/truncamento (CTX-01).
- **Teclado/A11y:** cada terminal item selecionável.
- **Origem:** O11 ("@Terminals to include terminal output as context").
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** —.

### IPV-MENX-05 — Conversas anteriores como contexto
- **QUANDO** o usuário anexar conversa anterior ((categoria própria, análoga ao item de conversas do oráculo, com token próprio)) ENTÃO DEVE listar conversas do workspace e permitir anexar, para o agente ler trechos necessários.
- **Teclado/A11y:** mesma interação de lista.
- **Origem:** O11/O2 ("@Chats to reference context from a previous conversation … use @Chats to reference previous work").
- **Cobertura:** PARCIAL por SES-05/CTX-01 (busca existe; anexação de conversa: pendente).
- **Identidade:** IPO-08 (palavra-chave e rótulo próprios).

### IPV-MENX-06 — Diffs de Git
- **QUANDO** o usuário anexar contexto de Git ENTÃO DEVE oferecer estado não-commitado e comparação com a base/branch, anexando o diff escolhido.
- **Teclado/A11y:** dois itens corretos e distinguíveis por texto.
- **Origem:** O11 ("@Commit (Diff of Working State) … @Branch (Diff with Main)").
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** IPO-09 (nomes das categorias próprios).

### IPV-MENX-07 — Browser
- **QUANDO** o usuário anexar browser ENTÃO DEVE anexar estado/captura da sessão de navegador autorizada (AUT-01) como contexto.
- **Teclado/A11y:** o item é visto como chip com síntese textual.
- **Origem:** O11 ("@Browser to attach context from the built-in browser").
- **Cobertura:** PENDENTE (browser em AUT-01, sem @ desse tipo).
- **Identidade:** —.

### IPV-MENX-08 — Múltiplas menções
- **QUANDO** o usuário digitar o caractere repetidamente ENTÃO cada item anexado deve emitir chip próprio, com lista consolidada visível antes do envio (CTX-01) e teto aplicado.
- **Teclado/A11y:** chips removíveis por teclado; contagem anunciável.
- **Origem:** O11 ("Type @ multiple times to attach several files … Each one gets added").
- **Cobertura:** COBERTA por CTX-01 (chips de fontes; múltiplos @ teclado: pendente).
- **Identidade:** —.

### IPV-MENX-09 — Fontes em teto/truncamento
- **QUANDO** o total de contexto se aproximar do teto ENTÃO o sistema DEVE avisar truncamento com indicação de quanto será enviado antes do envio (CTX-01/API-03).
- **Teclado/A11y:** aviso textual claro; membros truncados listados.
- **Origem:** C# CTX-01, API-03.
- **Cobertura:** COBERTA por CTX-01 (`context-send-preview-view.ts`).
- **Identidade:** —.

### IPV-MENX-10 — Envio externo apenas explícito
- **QUANDO** existir contexto montado ENTÃO o envio a API externa só DEVE ocorrer por ação explícita do usuário; nada automático, e nenhum caminho excluído (CTX-03) é enviado.
- **Teclado/A11y:** — (comportamento).
- **Origem:** C# PRV-01, CTX-03.
- **Cobertura:** COBERTA por PRV-01/CTX-03.
- **Identidade:** —.

### IPV-MENX-11 — Regras aplicáveis na sessão
- **QUANDO** a sessão iniciar ENTÃO DEVE carregar regras de usuário e de projeto aplicáveis e exibir origem de cada uma no painel de contexto.
- **Teclado/A11y:** lista de regras navegável; origem textual.
- **Origem:** C# CUS-01; O1 ("rules apply in all modes").
- **Cobertura:** COBERTA por CUS-01.
- **Identidade:** —.

### IPV-MENX-12 — Comando/skill/plugin local
- **QUANDO** o usuário invocar comando/skill/plugin local no composer ENTÃO DEVE aplicar a instrução declarada e exibir origem.
- **Teclado/A11y:** acionamento por teclado; origem anunciável.
- **Origem:** C# CUS-02.
- **Cobertura:** COBERTA por CUS-02.
- **Identidade:** —.

### IPV-MENX-13 — Hook que nega
- **QUANDO** um hook local negar ação ENTÃO registrar ação impedida com justificativa exibida e nenhuma ação executada no fluxo.
- **Teclado/A11y:** mensagem anunciável; sem capturar o teclado além do diálogo próprio.
- **Origem:** C# CUS-03.
- **Cobertura:** COBERTA por CUS-03.
- **Identidade:** —.

### IPV-MENX-14 — Ignore file
- **QUANDO** caminho estiver em regra de exclusão ENTÃO o caminho é omitido da indexação, do contexto automático e da busca do agente (CTX-03); regra prévia de limpeza (CTX-04/ERR-04).
- **Teclado/A11y:** —.
- **Origem:** C# CTX-03/CTX-04/ERR-04; `docs/feature-matrix.md` ("Ignore file — Pendente").
- **Cobertura:** COBERTA por CTX-03/CTX-04/ERR-04.
- **Identidade:** —.

### IPV-MENX-15 — Anexar seleção no campo
- **QUANDO** o usuário escolher adicionar a seleção atual ENTÃO o item vem com rótulo de arquivo:linha, identificável textualmente.
- **Teclado/A11y:** rótulo anunciável.
- **Origem:** O11 (usa seleção); `docs/interface-parity.md` "contexto do arquivo".
- **Cobertura:** PARCIAL por CTX-01 (fonte seleção: `panel-context-slot.ts`; rótulo posição: pendente).
- **Identidade:** —.

### IPV-MENX-16 — Contexto automático
- **QUANDO** o agente buscar contexto automaticamente ENTÃO o resultado DEVE refletir o índice incremental (CTX-02) e jamais incluir caminho excluído (CTX-03), com resultado visível no painel de contexto.
- **Teclado/A11y:** dados de recuperação automática listados no painel de contexto quando anexados.
- **Origem:** C# CTX-02/CTX-03.
- **Cobertura:** COBERTA por CTX-02/CTX-03.
- **Identidade:** —.

### IPV-MENX-17 — Remoção de contexto antes do envio
- **QUANDO** o usuário remover item do contexto antes do envio ENTÃO o chip DEVE desaparecer e a contagem de tokens deve ser recalculada antes da confirmação.
- **Teclado/A11y:** remoção por teclado; estado anunciado.
- **Origem:** O11 (contexto adicionado; interação de chips é decisão própria).
- **Cobertura:** COBERTA (parcial) por CTX-01 (contagem de chips: `context-send-preview-view.ts`).
- **Identidade:** —.

### IPV-MENX-18 — Menções operáveis por teclado e A11
- **QUANDO** qualquer item do menu de menções existir ENTÃO não DEVE haver funcionalidade nunca exclusivamente via mouse; leitor de tela anuncia o resultado de cada ação.
- **Teclado/A11y:** mantido por princípio de `docs/interface-parity.md` ("também verificadas estrutura, densidade, estados vazios, teclado, foco, acessibilidade").
- **Origem:** `docs/interface-parity.md`; O13 (princípios da base).
- **Cobertura:** PENDENTE (anúncio de chips a11y: `context-send-preview-view.ts` (upgrade futuro)).
- **Identidade:** —.
