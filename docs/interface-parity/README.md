# Matriz de paridade de interface — referência Cursor 3.24.18

**Tarefa:** task_201 (branch `feat/paridade-interface`, base `1459ea3`)
**Data:** 2026-10-30 · **Status:** matriz de informação (docs-only, sem código)
**Oráculo:** Cursor 3.24.18 (fontes congeladas do projeto) + editor base Code OSS, comportamento observável
**Regra fundante (PRD v6):** reproduzir fluxos e resultados **observáveis**, nunca copiar código, marca, ícones ou textos do Cursor (`docs/provenance-policy.md`, PRD v6 "Paridade total com Cursor — critérios (gate único)").

## 1. Índice

| Parte | Superfície | Código | Critérios | Arquivo |
| --- | --- | --- | --- | --- |
| 1 | Painel do agente / composer / seletores | AGPN | 22 | [agent-panel.md](agent-panel.md) |
| 2 | Histórico, fila e anexos | HFIL | 20 | [historico-fila-anexos.md](historico-fila-anexos.md) |
| 3 | Inline edit | INED | 15 | [inline-edit.md](inline-edit.md) |
| 4 | Ghost text / Tab | GTAB | 15 | [ghost-text-tab.md](ghost-text-tab.md) |
| 5 | Menções e contexto (@) | MENX | 18 | [mencoes-contexto.md](mencoes-contexto.md) |
| 6 | Settings (models/MCP/rules/skills/permissions) | SETG | 20 | [settings.md](settings.md) |
| 7 | Statusbar, notificações e erros | SBAR | 15 | [statusbar-notificacoes-erros.md](statusbar-notificacoes-erros.md) |
| 8 | Janela de agentes em paralelo | PARL | 12 | [janela-agentes-paralelos.md](janela-agentes-paralelos.md) |
| 9 | Terminal / Git / debug | TGBD | 14 | [terminal-git-debug.md](terminal-git-debug.md) |
| 10 | Workbench global (temas, comandos, layouts, keybindings) | WBGL | 18 | [workbench-global.md](workbench-global.md) |
| 11 | CLI e status de execução | CLST | 12 | [cli-status.md](cli-status.md) |
| 12 | Divergências de identidade (IPO) | IPO | 20 | [divergencias-identidade.md](divergencias-identidade.md) |
| — | Crosscheck com os 53 IDs do PRD | — | 53 IDs | [crosscheck-53-ids.md](crosscheck-53-ids.md) |
| — | **Total de critérios IPV** | | **181** | |

## 2. Metodologia

### 2.1 Como cada critério é construído

Cada critério segue o padrão EARS do PRD (QABANDO/ENTÃO/DEVE) e é observável — sempre formulado como comportamento que uma pessoa vê ou dispara na interface, nunca como detalhe de implementação. Campos obrigatórios por critério:

- **ID estável:** `IPV-<CÓDIGO DE SUPERFÍCIE>-NN` (ex.: `IPV-AGPN-07`). O NN nunca é renumerado dentro de uma superfície; critérios cancelados ficam marcados como obsoletos, não removidos.
- **Comportamento:** QUANDO … ENTÃO o editor DEVE …
- **Teclado/A11y:** como alcançar o critério só com teclado; foco, ordem de tabulação, anúncio de leitor de tela (quando aplicável).
- **Estados/erros:** estados visuais (carregando, vazio, cancelado, incompleto) e mensagens de erro associadas.
- **Origem:** caminho do artefato ou seção da doc congelada, ou fonte pública consultada (ver 2.3).
- **Cobertura:** `COBERTA por <ID PRD> (card <task_NN>)` quando já existe critério canônico e card que executa; `PENDENTE` quando exige card novo (apenas listado — nenhum card é criado por esta tarefa); `PARCIAL` quando parte do comportamento está coberta.
- **Identidade:** referência `IPO-NN` quando comportar divergência obrigatória de identidade (registro em [divergencias-identidade.md](divergencias-identidade.md)); `—` quando o comportamento é neutro de marca.

### 2.2 Verificabilidade

Um critério é verificável quando existe observação reproduzível: (a) comparação direta com instalação congelada do oráculo (teste diferencial local, exigido por VAL-01), (b) execução no OpenAgent com evidência registrada (estado, evento, diff, erro, acessibilidade — PRV-02/log), ou (c) citação de documentação pública congelada/exata. Critérios sem origem observável não entram na matriz; quando há dúvida de versão, o critério recebe `PENDENTE levantamento` com a origem a apurar.

### 2.3 Cadeia de verificação do projeto e proveniência

Ordem de prioridade (da `docs/provenance-policy.md` e inventário do projeto):

1. **PRD v6 + `packages/parity/src/catalog.ts`** — matriz canônica dos 53 IDs; base essencial de cobertura.
2. **Docs de insumo do repositório** — `docs/interface-parity.md`, `docs/feature-matrix.md`, `docs/parity-acceptance.md` (levantamento 2026-10-22, instalação Linux 3.16.17 / Windows 3.24.18); insumo, não teto.
3. **Snapshot congelado** — `sources/cursor/` (doc oficial congelada 2026-10-27: `manifest.json`, `docs.md`, `changelog.html`, `docs/agent/*.md`) e `resources/app/` (bundles). **Atenção operacional:** esses diretórios são `.gitignore`-dos e estão ausentes deste checkout; as ORIGENS abaixo citam os `artifactPath` + `sha256` registrados em `research/provenance/cursor-3.24.18.inventory.json` (registro rastreável sem espelhar conteúdo proprietário). Quando a entrega de implementação precisar do conteúdo, reobter o bundle e conferir o hash.
4. **Artefatos extraídos** — `research/reverse-engineering/cursor-3.24.18/`: `pseudocode/` (Ghidra sobre `Cursor.exe` Windows, alvo; `summary.txt`: 536.750Visitadas / 536.634 exportadas / 116 falhas; `manifest.tsv`; `functions.c`). Exame feito nesta tarefa: o bundle descreve o núcleo de runtime (V8/Electron/Windows), não componentes de UI do workbench, por isso NÃO é usado como origem de critérios específicos de widgets — sustenta apenas o contexto de estratégia comportamental já registrado em `docs/feature-matrix.md`. Uso sempre **não-copiado**: nenhum trecho substantivo de pseudocódigo foi transportado para esta matriz.
5. **Pesquisa online (complementar autorizada nesta tarefa)** — doc pública do Cursor + editor base. Usada para confirmar keybindings, defaults e estados de UI documentados publicamente que o bundle não cobre. **Proveniência obrigatória por critério:** URL + data de acesso 2026-10-30 + tarço citado curto (registro na lista 2.4 por critério). **Se a fonte local congelada divergir da online, a LOCAL prevalece e a divergiência é anotada no respectivo critério** (nenhuma divergência física detectada nesta matriz: os caminhos de descritor de docs congeladas no inventário coincidem com as URLs públicas consultadas).

### 2.4 Fontes online consultadas (autorização task_201)

| # | Fonte (URL) | Acesso | Uso nesta matriz |
| --- | --- | --- | --- |
| O1 | https://cursor.com/docs/agent (modes: Ask/Plan/Custom; Shift+Tab; Ctrl+. mode menu; plan como virtual file) | 2026-10-30 | AGPN, HFIL |
| O2 | https://cursor.com/docs/agent/overview (queue Enter; Ctrl+Enter enviar imediato; side chats /side /btw; checkpoints; @Chats; Tab enfilera) | 2026-10-30 | AGPN, HFIL, MENX, SETG |
| O3 | https://cursor.com/help/ai-features/agent.md (Restore Checkpoint hover; subagentes `.cursor/agents/`; fila draggable) | 2026-10-30 | AGPN, HFIL, PARL |
| O4 | https://cursor.com/docs/agent/plan-mode (Plan→Build; revert; salvar em workspace) | 2026-10-30 | AGPN |
| O5 | https://cursor.com/docs/release-notes/ide.md (3.24: auto-review elimina deletes de risco; run modes; fixes Tab/Customize/Debug Console) | 2026-10-30 | AGPN, SETG, TGBD |
| O6 | https://cursor.com/docs/cli/using (CLI /plan /ask --mode; Shift+Tab; Ctrl+D exit duplo; resume/agent ls; aprovação y/n; `-p`; worktree flag) | 2026-10-30 | CLST |
| O7 | https://cursor.com/help/ai-features/tab.md (Tab aceitar; Escape/typar recusar; Ctrl+→ palavra; jump-in-file; portal entre arquivos; status Ψ bottom-right: snooze/global/extension) | 2026-10-30 | GTAB, SBAR |
| O8 | https://cursor.com/help/customization/keyboard-shortcuts.md (defaults VS Code + AI; Ctrl+R Ctrl+S abre editor de atalhos) | 2026-10-30 | WBGL |
| O9 | https://cursor.com/docs/reference/keyboard-shortcuts.md (tabela completa Chat/Tab/Editor: Return enfilera; Ctrl+Enter força envio; Ctrl+Shift+Backspace cancela/aceita/refine; Ctrl+N novo chat; Tab cicla mensagem; Ctrl+→ próxima palavra) | 2026-10-30 | AGPN, GTAB, HFIL |
| O10 | https://cursor.com/docs/inline-edit/overview + https://cursor.com/help/ai-features/inline-edit (Ctrl+K; aplicar; refinar; Alt+Return pergunta; Ctrl+L envia ao Agent) | 2026-10-30 | INED |
| O11 | https://cursor.com/help/customization/context.md (@ files/folders; /Terminals; @Chats; @Commit; @Branch; @Browser; múltiplos @) | 2026-10-30 | MENX |
| O12 | https://cursor.com/changelog + docs release notes Agents Window (Canvases; tiled layout; pross dos agentes) | 2026-10-30 | PARL |
| O13 | https://code.visualstudio.com/docs/getstarted/keybindings (editor base: defaults, remap) — referendada por O8 como baseline do workbench | 2026-10-30 | WBGL |

Todos os usos são comportamentais: nenhum nome, ícone, texto de marca ou código do Cursor foi copiado; atalhos listados (Tab, Ctrl+I, Shift+Tab etc.) são **nomes de teclas**, não fragmentos protegidos.

### 2.5 Coluna de cobertura — base

A coluna "Cobertura" referencia o estado executável do OpenAgent (task_201 examinou `apps/editor/src`, `packages/`, `docs/feature-matrix.md`, `docs/interface-parity.md`). Painel: `apps/editor/src/agent/` (agent-panel, agent-panel-keyboard, agent-panel-selectors, agent-history, run-queue-panel, run-cancel-panel, side-conversation, conversation-search, agent-panel-appearance); janela de agentes: `apps/editor/src/agents/`; permissões: `apps/editor/src/permissions/`; contexto: `apps/editor/src/context/`; revisão: `apps/editor/src/review/`; pacotes e provas: `packages/`, `docs/parity-acceptance.md`. Estado geral (docs/interface-parity.md, 2026-10-22): painel próprio; restante da janela conserva visual padrão do editor hospedeiro; distribuição e identidade visual própria, juntamente com a maioria das superfícies de workbench, PENDENTE de lote próprio.

## 3. Regras de identidade própria (OpenAgent)

- **Marca e nome:** nenhum nome, logotipo, ícone, imagem, slogan ou título de campo procedentes do oráculo. Identidade OpenAgent em todas as telas (LOC-01, DES-01).
- **Textos:** rótulos, mensagens de erro e EMPTY-state sempre redigidos em PT-BR para a app local (sem tradução dos textos do Cursor); quando a mensagem de um critério canônico da matriz 53 é definida na PRD (ex.: "Bloqueado pelo modo de execução.", "Escreva uma mensagem ou anexe um contexto.", "Caminho fora do escopo."), usa-se REPRODUÇÃO DO FORMATO (ensagem de estado em citação entre aspas) que não é contradicção com marca.
- **Ícones/tema:** paleta e conjunto de ícones próprios (IPO-01 a IPO-20 em [divergencias-identidade.md](divergencias-identidade.md)); nenhum asset de marca extraído do bundle (`research/provenance/cursor-3.24.18.inventory.json` registra `containsCursorBrandAssets: false`).
- **Código:** nenhuma implantação/section de bundle do oráculo; análise apenas comportamental (2.3, item 4).
- **Estrutura visual:** organização e comportamento dos elementos podem ser equivalentes (paridade); posicionamento, cena e nomenclatura interna da marca são próprios.

## 4. Glossário

- **Oráculo congelado:** Cursor 3.24.18 como referência fixa de comparação de comportamento (PRD v6 VAL-01).
- **Superfície:** área observável da UI tratada como um todo coeso (painel do agente, janela de agentes, terminal...).
- **IPV:** Id de critério de Paridade de Interface observável (esta matriz).
- **IPO:** Id de divergência de Identidade Própria Obrigatória — comportamento igual implementado com marca/nome/visual próprios.
- **EARS:** padrão de escrita de condição/ação (QUANDO/ENTÃO/DEVE), confirmando a matriz do PRD.
- **Gate único:** 53/53 critérios de `packages/parity/src/catalog.ts` necessários para versão aceita (a ordem de construção não libera versão).
- **Run mode:** modo de autorização de execução do agente (por ex., somente-observação, confirmar-comando; descrito em O5).

## 5. Crosscheck com os 53 IDs do PRD (resumo)

Tabela completa em [crosscheck-53-ids.md](crosscheck-53-ids.md). Resumo rápido:

- **Todos os 53 IDs do catálogo** têm critérios IPV anotados no crosscheck (44 COBERTO · 4 PARCIAL · 5 PENDENTE).
- **Lacunas de cobertura** (PENDENTE, sem card) estão listadas no arquivo de crosscheck — nada foi criado nesta tarefa.

Por ID: critérios IPV que o sustentam → estado → lacuna principal.
