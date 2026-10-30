# IPV-HFIL — Histórico, fila e anexos

Paridade observável do histórico de conversas, fila de mensagens durante execução e anexos (imagens/arquivos). Cobertura canônica: UI-01, AGT-06, SES-01..SES-07, PRV-01, API-01.

Formato idêntico às demais partes. Origens: `O#` (URL acessada 2026-10-30), `P#` (artifactPath do inventário), `C#` (catálogo), `A#` (arquivo OpenAgent).

## Histórico de conversas

### IPV-HFIL-01 — Lista de conversas por workspace
- **QUANDO** o painel abrir ENTÃO DEVE listar conversas anteriores do workspace atual com último item visível, título/trecho da solicitação e data.
- **Teclado/A11y:** lista navegável; Enter abre conversa.
- **Estados/erros:** workspace sem conversas → estado vazio com chamada de nova conversa.
- **Origem:** `docs/interface-parity.md` (painel com histórico); C# SES-01.
- **Cobertura:** COBERTA por SES-01 + `apps/editor/src/agent/agent-history.ts`.
- **Identidade:** —.

### IPV-HFIL-02 — Retomar conversa completa após reinício
- **QUANDO** o editor reiniciar ENTÃO DEVE reabrir sessões do workspace com modo, mensagens, ferramentas e anexos existentes.
- **Teclado/A11y:** seleção e abertura por teclado.
- **Estados/erros:** sessão corrompida → mensagem de erro de load com opção de apagar a sessão; demais sessões intactas.
- **Origem:** C# SES-01.
- **Cobertura:** COBERTA por SES-01.
- **Identidade:** —.

### IPV-HFIL-03 — Navegação entre chats abertos
- **QUANDO** houver mais de uma conversa aberta ENTÃO o painel DEVE dar navegação entre elas (equivalentes observáveis no oráculo: Ctrl+[ e Ctrl+]), com controles próprios nomeados, além de fechar conversa (Ctrl+W).
- **Teclado/A11y:** atalhos remapeáveis; ordem visual das tabs anunciável.
- **Estados/erros:** fechamento de conversa com geração ativa → confirmação.
- **Origem:** O9 (Cmd [ — previous chat etc.).
- **Cobertura:** PENDENTE (multitab de conversas: sem card; laca em crosscheck).
- **Identidade:** —.

### IPV-HFIL-04 — Exportar sessão
- **QUANDO** o usuário pedir exportação ENTÃO o sistema DEVE gravar arquivo de texto legível com as mensagens daquela sessão, incluindo ações de ferramentas de forma textual.
- **Teclado/A11y:** comando por paleta e menu; escolha de destino por diálogo padrão.
- **Estados/erros:** sessão vazia → exportação recusada com instrução.
- **Origem:** C# SES-02; `apps/editor/src/agents/session-export-delete*`.
- **Cobertura:** COBERTA por SES-02.
- **Identidade:** —.

### IPV-HFIL-05 — Apagar sessão
- **QUANDO** o usuário apagar sessão ENTÃO o sistema DEVE remover as mensagens locais daquela sessão para sempre após confirmação.
- **Teclado/A11y:** confirmação por diálogo; Enter confirma, Escape cancela.
- **Estados/erros:** sessão em execução → apagar bloqueada até término/cancelamento.
- **Origem:** C# SES-07.
- **Cobertura:** COBERTA por SES-07.
- **Identidade:** —.

## Fila durante execução

### IPV-HFIL-06 — Enfileirar mensagem durante execução
- **QUANDO** o usuário enviar mensagem enquanto a execução está em curso ENTÃO (comportamento padrão) a mensagem DEVE entrar na fila, exibida em ordem abaixo da execução ativa.
- **Teclado/A11y:** Enter enfilera (padrão); atalho alternativo para envio imediato.
- **Estados/erros:** sem execução ativa → envio direto, sem fila.
- **Origem:** O2/O9 ("Press Enter to queue your message"; Return "Queue message (default)"); C# AGT-06.
- **Cobertura:** COBERTA por AGT-06 + `apps/editor/src/agent/run-queue-panel.ts`.
- **Identidade:** —.

### IPV-HFIL-07 — Reordenar e remover da fila
- **QUANDO** existirem itens na fila ENTÃO o painel DEVE permitir reordenar (arrastar e/ou teclado) e remover ITEM que ainda não começou (apenas os futuros).
- **Teclado/A11y:** reordenação com Alt+setas (equivalente dado pela doc: "Drag to reorder" — o mecanismo teclado é decisão própria).
- **Estados/erros:** remover item já iniciado → indisponível; execução em curso não permite desfazer ferramenta em curso, apenas cancelamento (PER-02).
- **Origem:** O2/O3 (drag to reorder; fila roda sequencialmente); C# AGT-06.
- **Cobertura:** COBERTA por AGT-06 (remoção: `run-queue-panel*`; reordenação: PENDENTE parte específica).
- **Identidade:** —.

### IPV-HFIL-08 — Envio imediato que interrompe
- **QUANDO** o usuário acionar envio imediato (equivalente observável: Ctrl/Cmd+Enter) ENTÃO a mensagem DEVE ser processada sem esperar o fim da execução, anexada à mais recente mensagem do usuário.
- **Teclado/A11y:** atalho presentado no campo (placeholder/hint).
- **Estados/erros:** execução em geração crítica (ferramenta pendente de permissão) → imediato só executa depois do ponto seguro atual.
- **Origem:** O2 ("Immediate messaging … appended to the most recent user message … processed right away").
- **Cobertura:** PENDENTE (sem card; lacuna em crosscheck: envio imediato/steer).
- **Identidade:** —.

### IPV-HFIL-09 — Steer por Tab na fila
- **QUANDO** o usuário pressionar Tab com texto no campo durante execução ENTÃO a mensagem DEVE ser enfileirada para após o turno (variante observável); com o efeito escolhido indicado explicitamente ao usuário.
- **Teclado/A11y:** alternância explicitada com teclado.
- **Origem:** O2 ("Press Tab to queue the message for after the turn instead").
- **Cobertura:** PENDENTE (sem card; laca de detalhe de composer contra ram de fila).
- **Identidade:** —.

### IPV-HFIL-10 — Cancelar execução assíncrona
- **QUANDO** o usuário cancelar execução ENTÃO em até 2 segundos o painel DEVE marcar "Cancelada", não iniciar nova ferramenta e conservar as mudanças já aplicadas.
- **Teclado/A11y:** botão/atalho de cancelar sempre alcançável durante execução.
- **Estados/erros:** cancelamento do worker → nada novo dispara; as mensagens da fila permanecem para execução.
- **Origem:** C# PER-02.
- **Cobertura:** COBERTA por PER-02.
- **Identidade:** —.

## Anexos

### IPV-HFIL-11 — Anexar imagem
- **QUANDO** o usuário anexar imagem (botão/drag-and-drop/colar) ENTÃO o painel DEVE exibir prévia do anexo antes e durante o envio, com ação clara de remoção.
- **Teclado/A11y:** caminho por teclado via botão; prévia anunciável.
- **Estados/erros:** formato não compatível → recusada com motivo; imagem rompe teto de tokens → aviso do CTX-01.
- **Origem:** https://cursor.com/docs/agent/overview (imagens .png/.jpg/.gif/.webp/.svg incluídas no contexto, prévias inline; acesso 2026-10-30).
- **Cobertura:** PENDENTE (anexos fora do CTX-01: ícone de anexo/imagens sem card).
- **Identidade:** —.

### IPV-HFIL-12 — Anexar arquivo/pasta por fonte explícita
- **QUANDO** o usuário anexar seleção, arquivo ou pasta ENTÃO o sistema DEVE listar cada fonte anexada e mostrar tokens/teto antes do envio, avisando truncação.
- **Teclado/A11y:** seletor de arquivo por teclado; chips de anexo removíveis por teclado.
- **Origem:** C# CTX-01.
- **Cobertura:** COBERTA por CTX-01 + `apps/editor/src/context/`.
- **Identidade:** —.

### IPV-HFIL-13 — Anexos persistem na sessão
- **QUANDO** a sessão for retomada ENTÃO os anexos coincidem com o contexto listado devem reaparecer na conversa conforme gravados.
- **Teclado/A11y:** mesma apresentação de chips.
- **Origem:** C# SES-01 (anexos explicitados).
- **Cobertura:** COBERTA por SES-01.
- **Identidade:** —.

### IPV-HFIL-14 — Colagem do clipboard
- **QUANDO** colar código ou log do clipboard no campo ENTÃO o painel DEVE oferecer anexar o conteúdo completo ou texto no input (comportamento observável no oráculo: colar adiciona como contexto; Ctrl+Shift+V cola texto no campo).
- **Teclado/A11y:** ações colar/adicionar por atalho.
- **Origem:** O9 (Cmd V "Add clipboard as context"; Cmd Shift V "Add clipboard to input box").
- **Cobertura:** PENDENTE (clipboard-to-context: sem card).
- **Identidade:** —.

### IPV-HFIL-15 — Seleção para o chat
- **QUANDO** código estiver selecionado no editor ENTÃO devem existir ações próprias no painel/editor para adicionar a seleção como contexto da conversa (equivalente observável: Ctrl+Shift+L) ou abrir nova conversa com a seleção.
- **Teclado/A11y:** atalhos remapeáveis; descrição anunciável.
- **Origem:** O9 (Cmd Shift L "Add selection to Chat"; Cmd L/K add to new chat).
- **Cobertura:** PARCIAL por CTX-01 (fonte seleção: `panel-context-slot.ts`; atalhos específicos pendentes).
- **Identidade:** —.

### IPV-HFIL-16 — Dados persistem em atualização
- **QUANDO** o editor atualizar ENTÃO conversas, sessões e configurações DEVEM permanecer conservadas, pois o histórico é gravado localmente por workspace.
- **Teclado/A11y:** sem interação do usuário para preservar.
- **Origem:** C# SES-01, DES-01.
- **Cobertura:** COBERTA (dados locais) por SES-01/DES-01; teste de atualização: `docs/parity-acceptance.md`.
- **Identidade:** —.

### IPV-HFIL-17 — Resultado do envio reconhecível
- **QUANDO** a mensagem é enviada ENTÃO o painel DEVE mostrar o resultado (recusa/imediata/enfileirada) reconhecível, além do custo de tokens do turno.
- **Teclado/A11y:** estado anunciável.
- **Estados/erros:** conflito com modo somente-leitura/estados terminais (STA-01/PER-03) → recusa com mensagem canônica.
- **Origem:** C# STA-01, API-03.
- **Cobertura:** COBERTA por STA-01/API-03.
- **Identidade:** —.

### IPV-HFIL-18 — Search-first: conversas anteriores respondidas
- **QUANDO** o usuário procura tema em conversas passadas ENTÃO a busca local (IPV-AGPN-21) DEVE permitir referenciar a conversa encontrada como contexto da atual ((como item de conversas, análogo ao @Chats do oráculo — ver IPV-MENX-05).
- **Teclado/A11y:** resultado → ação "referenciar" por teclado.
- **Origem:** O2 ("search past conversations … @Chats").
- **Cobertura:** PENDENTE (pesquisa existe; acessar conversa por referência é lacuna).
- **Identidade:** —.

### IPV-HFIL-19 — Estados de terminação visíveis
- **QUANDO** a execução termina ENTÃO o painel DEVE distinguir Concluída/Cancelada/Incompleta (textuais + indicadores não-cromáticos) e, cor/ícones próprios (IPO-03), recusar nova ferramenta após terminação até mensagem nova.
- **Teclado/A11y:** estado textual sempre presente.
- **Origem:** C# STA-01, ERR-03.
- **Cobertura:** COBERTA por STA-01 (tema/ícones: IPO-03).
- **Identidade:** IPO-03.

### IPV-HFIL-20 — Anexos acessíveis e alternados
- **QUANDO** exatamente um anexo for removido/adicionado durante composição ENTÃO a lista é anunciável (leitor de tela anuncia removido/adicionado) e nunca distinguível só por cor.
- **Teclado/A11y:** região viva (aria-live) ou equivalente próprio; remoção por teclado.
- **Origem:** point de decisão de projeto: adotado como diretiva própria; ver exemplo `apps/editor/src/context/context-send-preview-view.ts`; princípio de `docs/interface-parity.md` ("estados vazios, teclado, foco, acessibilidade").
- **Cobertura:** PENDENTE (a11y de anúncio dos chips de anexos: sem card).
- **Identidade:** —.
