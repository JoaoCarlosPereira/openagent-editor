# IPV-INED — Inline edit (edição no editor)

Paridade observável do widget de edição inline sobre o editor (equiv. comportamental do Ctrl+K do oráculo). Cobertura canônica: INL-01, INL-02, UI-02, ERR-01, AGT-01.

Origens: `O#` (URL 2026-10-30), `P#` (inventário), `C#` (catálogo), `A#` (arquivos OpenAgent).

### IPV-INED-01 — Invocação sobre o editor
- **QUANDO** o usuário selecionar código (ou nada) e acionar o comando de edição inline (equiv. observável: Ctrl+K) ENTÃO DEVE abrir widget sobre o editor, no local da seleção ou do cursor, com campo de instrução.
- **Teclado/A11y:** campo recebe foco; widget anunciável como região; Escape fecha sem alteração.
- **Estados/erros:** widget já aberto → novo comando foca o existente.
- **Origem:** O10 ("Select code … press Cmd/Ctrl+K … type instructions"); `docs/interface-parity.md` "Inline Edit".
- **Cobertura:** COBERTA por INL-01 (comando + diff atuais; widget sobre o editor: pendente — `docs/interface-parity.md` difere "comando e diff em janela separada").
- **Identidade:** IPO-04 (nome/rótulo do comando próprio).

### IPV-INED-02 — Aplicar e permitir refino
- **QUANDO** o usuário confirmar a instrução ENTÃO o editor DEVE aplicar a sugestão no lugar com prévia diff (aceitar/rejeitar) e permitir novo envio de instrução para refinar sobre o resultado anterior.
- **Teclado/A11y:** Enter aplica próxima instrução; aceite/rejeição por atalho e por botão.
- **Estados/erros:** instrução vazia → recusa sem fechamento; arquivo mudado entre geração e aplicação → ERR-01.
- **Origem:** O10 ("To refine, add follow-up instructions and press Return again"); C# INL-01.
- **Cobertura:** PARCIAL por INL-01 (refino sequencial embutido: pendente).
- **Identidade:** —.

### IPV-INED-03 — Diff imutável sem perda de texto original
- **QUANDO** a prévia diff for exibida ENTÃO DEVE estar visível com versões antes/depois lado a lado ou empilhadas, sem perder o texto original até aceite; rejeição restaura exatamente o original.
- **Teclado/A11y:** navegação entre hunks por teclado; leitura anunciável de contexto.
- **Estados/erros:** cancelamento com diff aberto → descarte total confirmado.
- **Origem:** C# INL-01, ERR-01 («mostrar ambas versões»).
- **Cobertura:** COBERTA por INL-01/ERR-01.
- **Identidade:** —.

### IPV-INED-04 — Quick question (modo pergunta)
- **QUANDO** o usuário alternar o widget para modo pergunta (equiv. observável: Alt+Return confirmar em modo pergunta) ENTÃO DEVE responder com explicação sobre a seleção, sem aplicar mudança, oferecendo ação de "aplicar a mudança sugerida" para trocar a edição.
- **Teclado/A11y:** alternância e confirmação por teclado.
- **Estados/erros:** "do it" decide aplicar → segue comportamento de IPV-INED-02.
- **Origem:** O10 ("Switch to question mode … type 'do it'").
- **Cobertura:** PENDENTE (modo pergunta do widget: sem card).
- **Identidade:** —.

### IPV-INED-05 — Seleção enviada ao agente
- **QUANDO** o usuário pedir envio da seleção para o agente (equiv. observável: Ctrl+L) ENTÃO o painel do agente DEVE abrir com a seleção como contexto anexo.
- **Teclado/A11y:** atalho remapeável; resultante no painel focado.
- **Origem:** O10 ("press Cmd/Ctrl+L … opens Agent with your selected code as context").
- **Cobertura:** PARCIAL por CTX-01 (anexar seleção; atalho específico do painel: pendente).
- **Identidade:** —.

### IPV-INED-06 — Geração visível inline
- **QUANDO** a geração ocorrer ENTÃO o widget DEVE exibir estado de geração (indicador) e permitir cancelar sem alterar o arquivo.
- **Teclado/A11y:** cancelamento por teclado; estado textual.
- **Estados/erros:** cancelar → arquivo intacto; erro de rede → causa exibida com texto preservado (API-02).
- **Origem:** C# API-02; O5 (banners de erro do composer no releases de 3.24 do oráculo)); `docs/interface-parity.md` "estados de geração".
- **Cobertura:** COBERTA por API-02 (estado de geração no widget: pendente).
- **Identidade:** —.

### IPV-INED-07 — Edição de arquivo inteiro com prévia
- **QUANDO** o usuário pedir edição no arquivo inteiro ENTÃO o sistema DEVE exibir prévia integral com possibilidade de rejeitar e restaurar o conteúdo anterior ao pedido.
- **Teclado/A11y:** navegação de diff por teclado; rejeição tudo por teclado.
- **Estados/erros:** conflito entre geração/aplicação → ERR-01.
- **Origem:** C# INL-02.
- **Cobertura:** COBERTA por INL-02.
- **Identidade:** —.

### IPV-INED-08 — Controles legíveis em temas e larguras
- **QUANDO** o widget estiver aberto em tema claro/escuro e sob larguras distintas do editor ENTÃO os controles DEVEM permanecer legíveis, e a conversa/diff preservados na troca de tema.
- **Teclado/A11y:** contraste; foco nunca perdido na troca.
- **Origem:** C# UI-02.
- **Cobertura:** COBERTA por UI-02.
- **Identidade:** —.

### IPV-INED-09 — Editor intacto durante aplicação
- **QUANDO** a aplicação ocorrer ENTÃO o editor DEVE manter a posição do cursor próxima do trecho editado, sem perdê-lo em scroll irrelevante, e permitir desfazer a aplicação (comando undo nativo).
- **Teclado/A11y:** foco sem sair do editor; Ctrl+Z nativo aplica-se.
- **Origem:** `docs/interface-parity.md` ("diff e checkpoints", "criar widget sobre o editor"); projeção do princípio de editor de Code OSS (O13).
- **Cobertura:** PENDENTE (undo nativo da aplicação: sem card).
- **Identidade:** —.

### IPV-INED-10 — Comando em linguagem natural no terminal
- **QUANDO** o invocador no terminal pedir edição de comando via prompt ENTÃO (equiv. observável do Ctrl+K no terminal do oráculo) DEVE converter linguagem natural em comando com prévia antes de executar (nenhuma execução sem confirmação — depende do modo/permissões de PER-01).
- **Teclado/A11y:** área de entrada no terminal com foco; prévia anunciável.
- **Estados/erros:** comando negado pelo modo somente-leitura → mensagem canônica PER-03.
- **Origem:** https://cursor.com/features (acesso 2026-10-30: "Use Ctrl K in the terminal to write terminal commands in plain english"); C# PER-01/PER-03.
- **Cobertura:** PENDENTE (terminal prompt-to-command: sem card).
- **Identidade:** —.

### IPV-INED-11 — Multi-arquivo: emissão para o agente
- **QUANDO** a edição pedida exigir mudança em mais de um arquivo ENTÃO o widget DEVE oferecer promover a execução ao agente (transição observável) e recolher a instrução sem perder contexto do arquivo atual.
- **Teclado/A11y:** botão/menu com atalho; foco movido ao painel.
- **Estados/erros:** instrução abandonada → recolhida no painel de conversa (instrução preservada na conversa).
- **Origem:** O10 ("For multi-file edits … opens Agent with your selected code as context").
- **Cobertura:** PENDENTE (transição widget→agent: sem card).
- **Identidade:** —.

### IPV-INED-12 — Botões de revisão no widget
- **QUANDO** o diff estiver visível ENTÃO as ações de aceitar/rejeitar/refinar DEVEM partir do widget, alcançáveis por teclado em qualquer ordem, e as cores/ícones exibidos são próprios.
- **Teclado/A11y:** atalhos equivalentes observáveis (accept/reject all) presentes no bloco do painel.
- **Origem:** O9 (accept/reject all no chat); alcance no widget: derivado do mesmo princípio; IPO-05.
- **Cobertura:** PENDENTE (controles no widget: sem card).
- **Identidade:** IPO-05.

### IPV-INED-13 — Indicação de contexto do arquivo atual
- **QUANDO** o widget abrir ENTÃO o contexto mínimo visível DEVE incluir arquivo e posição (arquivo:linha) na prévia, clareando o que será enviado ao modelo.
- **Teclado/A11y:** rótulos textuais; não dependente de cor.
- **Origem:** `docs/interface-parity.md` (arquivo ativo/seleção no contexto); C# CTX-01/PRV-01.
- **Cobertura:** COBERTA (parcial) por CTX-01 (painel) — widget: pendente.
- **Identidade:** —.

### IPV-INED-14 — Compatibilidade com seleção parcial e inserção no cursor
- **QUANDO** não houver seleção ENTÃO o widget DEVE operar como inserção no cursor (gerar novo código no ponto), com diff e cancelamento iguais aos da edição da seleção.
- **Teclado/A11y:** mesmo conjunto de atalhos dos dois casos.
- **Origem:** C# INL-01 ("inserção no cursor"); O10.
- **Cobertura:** PARCIAL por INL-01 (inserção no cursor: pendente).
- **Identidade:** —.

### IPV-INED-15 — Sem captura de foco com o widget aberto
- **QUANDO** a interface abrir o widget ENTÃO o editor NÃO DEVE ficar preso ao widget: Tab circula entre widget e editor, e Escape restaura o foco original.
- **Teclado/A11y:** não-trap; foco recuperado.
- **Origem:** princípio de a11y do workbench (O13); `docs/interface-parity.md` ("teclado, foco, acessibilidade").
- **Cobertura:** PENDENTE (widget ainda não existente; requisito entrará no card do widget).
- **Identidade:** —.
