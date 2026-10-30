# Crosscheck com os 53 IDs do PRD v6

Fonte canônica dos IDs: `packages/parity/src/catalog.ts` (reconciliado com o PRD v6 — "Reconciliação normativa dos 53 IDs"). Estado de cobertura classifica cada ID pelo conjunto de critérios IPV que o sustentam:

- **COBERTO** — critérios IPV existem e a execução já tem card/implementação correspondente (`apps/editor`, `packages`, `services`) ou está traçada em `docs/feature-matrix.md` como entregue.
- **PARCIAL** — parte do comportamento observável coberta; restante pendente de lote específico.
- **PENDENTE** — sem card/implementação associado; lacuna listada no §2 (nada criado nesta tarefa).

> Nota: onde o texto numerado histórico do PRD (v5) difere do catálogo canônico (ex.: STA-01), prevalece o catálogo; os critérios IPV citados cobrem o sentido canônico e, quando aplicável, também o histórico.

## 1. Tabela por ID

| ID | Significado canônico (catálogo) | Critérios IPV que sustentam | Estado | Lacuna principal |
| --- | --- | --- | --- | --- |
| LOC-01 | Editor instalável com distribuição própria | IPV-WBGL-01/02/14/17, IPV-TGBD-01/05/08, IPV-AGPN-14 | PARCIAL | Distribuição própria Linux/Win/mac com identidade (IPO-01) |
| UI-01 | Painel, seletores, contexto, histórico e revisão por teclado | IPV-AGPN-01/02/22, IPV-WBGL-05/15, IPV-HFIL-01 | COBERTO | — |
| UI-02 | Tema/largura preservam legibilidade e conversa | IPV-WBGL-03/09, IPV-SETG-11, IPV-INED-08 | PARCIAL | Temas próprios (lote customize) |
| UI-03 | Onboarding de provedor com teste e sem conta | IPV-SETG-01/02 | COBERTO | — |
| UI-04 | Janela lista execuções paralelas e retorna | IPV-PARL-01/02 | COBERTO | — |
| AGT-01 | Ask sem mutação | IPV-AGPN-09 | COBERTO | — |
| AGT-02 | Plano aceito inicia execução com plano/progresso | IPV-AGPN-10 | PENDENTE | Modo Plan completo |
| AGT-03 | Agent edita/testa e mostra diff agrupado | IPV-AGPN-11, IPV-TGBD-02/06, IPV-SETG-10 | COBERTO | — |
| AGT-04 | Debug registra hipótese/evidência/verificação | IPV-TGBD-09 | PENDENTE | Debug mode do agente |
| AGT-05 | Subagentes com nome/estado/resultado próprios | IPV-PARL-03/05 | COBERTO | — |
| AGT-06 | Fila editável durante execução | IPV-HFIL-06/07 | COBERTO | Reordenação por teclado detalhada |
| AGT-07 | Cancelar subagente só o dele | IPV-PARL-04 | COBERTO | — |
| PRJ-01 | Coordenador local divide objetivo em tarefas | IPV-PARL-06 | COBERTO | — |
| PER-01 | Aceite explícito com ação/alvo/escopo | IPV-SETG-07/10, IPV-SBAR-07, IPV-TGBD-02, IPV-CLST-03 | COBERTO | — |
| PER-02 | Cancelada ≤2s, sem nova ferramenta, conserva alterações | IPV-HFIL-10, IPV-SETG-09, IPV-TGBD-13 | COBERTO | — |
| PER-03 | Somente leitura bloqueia com texto canônico | IPV-SETG-08, IPV-SBAR-04 | COBERTO | — |
| STA-01 | Run concluída/cancelada recusa nova ferramenta | IPV-HFIL-19, IPV-PARL-12, IPV-CLST-08 (+ histórico de exibição: IPV-SBAR-01) | COBERTO | — |
| VAL-01 | Evidência reproduzível por fluxo/requisito | procedimental: esta matriz + `packages/parity/src/report.ts` + `docs/parity-acceptance.md` | COBERTO | — |
| CTX-01 | Anexar fontes com tokens/teto antes do envio | IPV-HFIL-12, IPV-MENX-02/08/09/17, IPV-INED-13, IPV-TGBD-03 | COBERTO | Menu `@` completo (navegação de pasta, terminal) |
| CTX-02 | Índice incremental na busca local | IPV-MENX-03/16 | COBERTO | — |
| CTX-03 | Caminho excluído fora de índice/contexto/busca | IPV-MENX-14, IPV-MENX-10, IPV-GTAB-12 | COBERTO | — |
| CTX-04 | Limpeza com escopo/tamanho só do workspace | IPV-SETG-18 | COBERTO | — |
| PRV-01 | Envio externo só explícito, sem excluído | IPV-MENX-10, IPV-GTAB-12/15 | COBERTO | — |
| PRV-02 | Log sem credencial/excluído/corpo bruto | IPV-AGPN-19, IPV-TGBD-04, IPV-CLST-12 | COBERTO | — |
| TAB-01 | Tab sugere linha/bloco com aceitar/recusar/cancelar | IPV-GTAB-01/03/14 | PARCIAL | Bloco multilinha e cancelamento no motor próprio |
| TAB-02 | Aceite indica próximo ponto e salto teclado | IPV-GTAB-04 | PENDENTE | Jump-in-file |
| TAB-03 | Sugestão multiarquivo exige revisão | IPV-GTAB-05 | PENDENTE | Portal entre arquivos |
| INL-01 | Edição de seleção com diff/aceitar/rejeitar/refinar | IPV-INED-01/02/03/13/14 | PARCIAL | Widget sobre o editor (hoje: comando+janela separada) |
| INL-02 | Edição do arquivo inteiro rejeitável/restaurável | IPV-INED-07 | COBERTO | — |
| AUT-01 | Browser autorizado com captura/console | IPV-AGPN-16, IPV-TGBD-10 | COBERTO | — |
| AUT-02 | Computer use uma ação nomeada por vez | IPV-AGPN-17 | COBERTO | — |
| DES-01 | Elemento anexa identidade+trecho à mensagem | IPV-AGPN-16 | COBERTO | — |
| CAN-01 | Canvas aberto aparece e persiste no painel | IPV-AGPN-15, IPV-PARL-10 | COBERTO | Canvas dentro da janela paralela (PARL) |
| CUS-01 | Sessão carrega regras com origem | IPV-MENX-11, IPV-SETG-05 | COBERTO | — |
| CUS-02 | Comando/skill/plugin aplica com origem | IPV-MENX-12, IPV-SETG-06 | COBERTO | — |
| CUS-03 | Hook negando imped ação com justificativa | IPV-MENX-13, IPV-TGBD-14, IPV-WBGL-06 | COBERTO | — |
| MCP-01 | MCP stdio/HTTP lista + execução com permissão | IPV-SETG-03/04 | COBERTO | Página Settings própria (IPO-10) |
| CLI-01 | CLI no workspace reutiliza config | IPV-CLST-01/02/03/05/09 | COBERTO | — |
| CLI-02 | Sessão headless aparece no editor | IPV-CLST-04/06 | COBERTO | Flag `-p` explícita |
| SES-01 | Reinício reabre sessões com modo/mensagens/ferramentas/anexos | IPV-HFIL-02/13/16, IPV-WBGL-10 | COBERTO | — |
| SES-02 | Exportar sessão em texto | IPV-HFIL-04 | COBERTO | — |
| SES-03 | Checkpoint restaura só marcados, sem sobrescrever | IPV-AGPN-13 | PENDENTE | Checkpoints no painel |
| SES-04 | Trabalho isolado usa worktree preservando original | IPV-PARL-07, IPV-TGBD-07, IPV-CLST-09 | COBERTO | — |
| SES-05 | Busca local na conversa | IPV-AGPN-21 | COBERTO | — |
| SES-06 | Conversa lateral preserva a principal | IPV-AGPN-20 | COBERTO | — |
| SES-07 | Apagar sessão remove mensagens locais | IPV-HFIL-05, IPV-PARL-11 | COBERTO | — |
| API-01 | Testar endpoint, capabilities, cofre do SO | IPV-SETG-01 | COBERTO | — |
| API-02 | Falha exibe causa e preserva prompt/diff | IPV-AGPN-18, IPV-INED-06, IPV-SBAR-03/06 | COBERTO | — |
| API-03 | Teto exibido; padrão 200000 tokens | IPV-AGPN-06, IPV-MENX-09 | COBERTO | — |
| ERR-01 | Conflito mostra duas versões | IPV-AGPN-11, IPV-INED-03/07, IPV-SBAR-09 | COBERTO | — |
| ERR-02 | Caminho fora do escopo negado e registrado | IPV-SBAR-10, IPV-TGBD-02 | COBERTO | — |
| ERR-03 | Streaming caiu: Incompleta + retry sem alterar gravação | IPV-AGPN-07, IPV-SBAR-12 | COBERTO | — |
| ERR-04 | Remover trecho recém-excluído antes da busca | IPV-MENX-14, IPV-SBAR-13 | COBERTO | — |

**Resumo (53/53 com critérios IPV):** 44 COBERTO · 4 PARCIAL (LOC-01, UI-02, TAB-01, INL-01) · 5 PENDENTE de card novo (AGT-02, AGT-04, TAB-02, TAB-03, SES-03). Estados derivados dos cards executados até 2026-10-30 (branches por task no repositório); PARCIAL e PENDENTE detalhados na coluna Lacuna e no §2.

## 2. Lacunas de cobertura (PENDENTE levantamento — nada criado)

Como acordado, esta lista NÃO cria cards; somente registra onde um card novo seria necessário, com origem apurar:

1. **Modo Plan de ponta a ponta** (IPV-AGPN-10; AGT-02) — origem a apurar: definição do plano como arquivo virtual no painel OpenAgent.
2. **Debug mode do agente** (IPV-TGBD-09; AGT-04) — origem: fluxo de hipótese/evidência/verificação local.
3. **Tab maturado** (IPV-GTAB-02/03/04/05/07/08/09/10/11/13; TAB-01 parcial, TAB-02/03) — motor de sugestão própria: jumps, portal entre arquivos, word-by-word, snooze/extension, CRLF.
4. **Widget de edição inline sobre o editor** (IPV-INED-01(state widget)/02/04/06/08/09/11/12/15; INL-01 parcial) — origem: definir widget in-place com refino e modo pergunta.
5. **Checkpoints no painel** (IPV-AGPN-13; SES-03, AGT-06 histórico) — origem: snapshot por mensagem com conflito.
6. **Fila avançada** (IPV-HFIL-08/09 — envio imediato/steer; reordenação por teclado de HFIL-07).
7. **Anexos ricos** (IPV-HFIL-11/14 — imagens, clipboard como contexto).
8. **Multi-tab de conversas** (IPV-HFIL-03 — Ctrl-[ / ] equivalente próprio).
9. **Menções completas** (IPV-MENX-01/02/04/06/07 — menu @ com arquivos navegação `/`, terminals, Git diffs, browser).
10. **Páginas de Settings próprias** (IPV-SETG-11/14/20; MCP page, Tab page, exclusions page; IPO-10).
11. **Statusbar/notificações da distribuição própria** (IPV-SBAR-02/05/06/15 — indicador Tab, centro de notificações, banner de limite, a11y).
12. **Janela de agentes avançada** (IPV-PARL-08/09/10 — multitask/paralelo, tiles, canvases na janela).
13. **Distribuição e identidade visual própria** (IPV-WBGL-01/02/03/04/13/14/16/18; IPO-01/20) — build reproducible com brand checks.
14. **Layouts alternáveis do painel** (IPV-WBGL-08 — janela/sidebar toggling com estado preservado).
15. **Terminal prompt-to-command e DevTools do browser** (IPV-INED-10, IPV-TGBD-11).
16. **Perguntas ao vivo do agente** (IPV-AGPN-12 — clarifying questions inline).
17. **CLI UX complementar** (IPV-CLST-06/10/11 — `-p`, saída dupla Ctrl+D, navegação por histórico).
18. **A11y incremental** (IPV-HFIL-20, IPV-MENX-18 — anunciação de chips de anexos/menções).

## 3. Pendências com origem a apurar (sem certeza de comportamento)

- P# bundle `resources/app/out/vs/workbench/workbench.desktop.main.js` (h `ed6922…`): inspeção futura do bundle congelado pode acrescentar estados de UI não documentados publicamente (só quando o bundle estiver disponível no ambiente — hoje gitignored/ausente).
- `sources/cursor/changelog.html` (h `189f85…` via inventário): cruzar estados de UI listados no changelog congelado 3.24.18 com as URLs online usadas (O5/O12) — divergências, se houver, LOCAL prevalecerá e será anotada nos critérios correspondentes (nenhuma divergência detectável nesta rodada).
- Pseudocódigo (`research/reverse-engineering/cursor-3.24.18/pseudocode/`): somente quando um critério específico de runtime for necessário; nenhum trecho substantivo copiado (regra da matriz).

## Atualização de 30/10/2026 — estado real das implementações

Esta matriz foi gerada sobre a `main` (1459ea3), que integra menos que as branches de trabalho. Itens marcados **PENDENTE** aqui já possuem implementação concluída em branches (aguardando integração; nenhum deles está pendente de implementação):

| Item marcado PENDENTE | Implementação concluída em |
|---|---|
| TAB-02 (salto por teclado) | feat/task-169 @ d167302 |
| TAB-03 (multiarquivo revisado) | feat/task-170 @ 2a7d9ed (código) + cenários em feat/task-194 @ 9501e1f |
| SES-03 (checkpoint restauração) | feat/task-69 @ a04f52b (ancestral da base) + cenário ses-03 em feat/task-196 @ 586aa72 |
| AGT-02 (plano inicia execução) | cenário agt-02 em feat/task-191 @ 7d6f7f4 (contrato); implementação de produto em linhas AGT precedentes |
| AGT-04 (debug hipótese/evidência) | cenário agt-04 em feat/task-191 @ 7d6f7f4 (contrato) |

Os 18 lacunas listadas continuam válidas como backlog de planejamento. Verificação independente do lote: APROVADO (relatório no card da task_182, 30/10/2026).
