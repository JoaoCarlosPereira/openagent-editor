# IPV-IPO — Divergências de identidade própria (IPO)

Registro canônico das divergências de identidade referenciadas pelos critérios IPV. Regra geral: **comportamento** pode ser equivalente ao oráculo; **marca, nome, ícones, textos descritivos e logotipo** DEVEM ser OpenAgent (PRD v6; `docs/provenance-policy.md`; `research/provenance/cursor-3.24.18.inventory.json` com `containsCursorBrandAssets: false`).

Cada IPO descreve o que é igual (paridade) e o que obrigatoriamente difere (identidade própria). Estado de cobertura segue a mesma coluna dos IPV.

### IPO-01 — Marca visual da janela e distribuição
- **Igual:** imagem geral do workbench (abas, sidebar, editor, statusbar).
- **Difere:** nome do produto, logotipo, ícones de app/sistema, splash e tema padrão da marca exclusivamente OpenAgent.
- **Referências:** IPV-AGPN-14, IPV-WBGL-01/02/03/04/13/14/16/17/18.
- **Cobertura:** PENDENTE (lote de distribuição/identidade visual).

### IPO-02 — Comando de conversa lateral
- **Igual:** funcionalidade de conversa lateral/durante execução preservando a principal.
- **Difere:** palavra-chave do comando e rótulo dos itens próprios (não `/side`/`/btw` do oráculo).
- **Referências:** IPV-AGPN-20, IPV-MENX-05.
- **Cobertura:** COBERTO por SES-06 (comando: escolhido no card da feature).

### IPO-03 — Estados de execução (cores/ícones)
- **Igual:** conjunto de estados (Concluída/Cancelada/Incompleta/fila) e significados.
- **Difere:** representação visual (paleta própria + texto sempre presente).
- **Referências:** IPV-HFIL-19, IPV-SBAR-01.
- **Cobertura:** PARCIAL (estado textual coberto; visual conforme UI-02).

### IPO-04 — Nome do comando de edição inline
- **Igual:** fluxo QUANDO→ENTÃO do widget de edição inline.
- **Difere:** nome do comando na paleta e rótulos do widget próprios (sem usar nome/ícone do oráculo).
- **Referências:** IPV-INED-01.
- **Cobertura:** PARCIAL por INL-01.

### IPO-05 — Controles de diff no widget
- **Igual:** ações aceitar/rejeitar/refinar e atalhos equivalentes.
- **Difere:** rótulos/ícones próprios nos botões do widget e do painel.
- **Referências:** IPV-INED-12.
- **Cobertura:** PENDENTE.

### IPO-06 — Controles de aceitação de bloco (Tab)
- **Igual:** comportamento aceitar/recusar multilinha.
- **Difere:** apresentação própria do controle inline sob o bloco (não reprodução visual do oráculo).
- **Referências:** IPV-GTAB-03.
- **Cobertura:** PARCIAL por TAB-01.

### IPO-07 — Ícones e rótulos de status
- **Igual:** semântica dos itens de status (modelo, tokens, fila, ferramentas, erros, sugestões).
- **Difere:** ícone, texto e menu próprios (ex.: indicador de sugestões nomeado OpenAgent).
- **Referências:** IPV-SBAR-01/02, IPV-GTAB-06.
- **Cobertura:** PARCIAL.

### IPO-08 — Palavra-chave de contexto de conversas
- **Igual:** anexar conversa anterior como contexto.
- **Difere:** token/rótulo próprio da categoria (equivalente funcional do item de conversas do oráculo).
- **Referências:** IPV-MENX-05.
- **Cobertura:** PENDENTE.

### IPO-09 — Categorias de contexto Git
- **Igual:** dois contextos distintos (estado não-commitado; comparação com base).
- **Difere:** nomes das categorias próprios (equivalente funcional de `@Commit`/`@Branch`).
- **Referências:** IPV-MENX-06.
- **Cobertura:** PENDENTE.

### IPO-10 — Páginas de Settings com marca própria
- **Igual:** organização/agrupamento das páginas de configuração (models, MCP, rules, skills, permissions, Tab).
- **Difere:** títulos, descrições, logotipo e terminologia OpenAgent em todas as páginas.
- **Referências:** IPV-SETG-01/02/03/05/06/07/14/17/20, IPV-WBGL-12.
- **Cobertura:** PENDENTE (páginas próprias).

### IPO-11 — Janela de agentes com identidade própria
- **Igual:** lista de execuções, panes/tiles, retorno ao editor.
- **Difere:** título, ícones e rótulos da janela OpenAgent.
- **Referências:** IPV-PARL-01/06/09.
- **Cobertura:** PARCIAL por UI-04.

### IPO-12 — Terminologia de terminal/Git/debug
- **Igual:** comportamento das superfícies do editor base.
- **Difere:** nome do produto nos títulos, perfis de shell nomeados OpenAgent.
- **Referências:** IPV-TGBD-01/05/08.
- **Cobertura:** PARCIAL por LOC-01.

### IPO-13 — Nome do binário/CLI
- **Igual:** todos os comportamentos de CLI (modos, sessões, resumo, aprovação).
- **Difere:** comando/binário próprios (não o do oráculo) e strings de ajuda próprias.
- **Referências:** IPV-CLST-01.
- **Cobertura:** PARCIAL por CLI-01.

### IPO-14 — Onboarding sem conta do fabricante do oráculo
- **Igual:** fluxo de primeira execução com teste de conexão.
- **Difere:** mensagens, marcas visuais e sem nenhuma menção do fabricante do oráculo; contas apenas do provedor de modelo escolhido.
- **Referências:** IPV-SETG-02.
- **Cobertura:** COBERTO por UI-03.

### IPO-15 — Documentação/ajuda interna
- **Igual:** pontos de acesso a documentação e atalhos no workbench.
- **Difere:** documentação própria (docs/ e help local OpenAgent), não páginas da marca do oráculo.
- **Referências:** IPV-WBGL-05 (paleta de comandos), IPV-WBGL-07 (atalhos Documentação).
- **Cobertura:** PENDENTE.

### IPO-16 — Marketplace/extensões
- **Igual:** suporte a extensões compatíveis com a API do editor base.
- **Difere:** qualquer catálogo/distribuição próprios OpenAgent; nenhum marketplace do oráculo.
- **Referências:** IPV-WBGL-17.
- **Cobertura:** PARCIAL por LOC-01.

### IPO-17 — Textos de estados/erros canônicos
- **Igual:** mensagens canônicas do catálogo de 53 IDs (ex.: "Bloqueado pelo modo de execução.", "Caminho fora do escopo.", "Escreva uma mensagem ou anexe um contexto.") são OBRIGATÓRIAS.
- **Difere:** demais textos redigidos em PT-BR/local próprio, sem tradução da marca.
- **Referências:** IPV-AGPN-08, IPV-SBAR-14, IPV-SETG-08.
- **Cobertura:** COBERTO (textos canônicos; demais próprios).

### IPO-18 — Sons/efeitos opcionais
- **Igual:** sem requisito de paridade (não observável de forma confiável nessa base).
- **Difere:** qualquer feedback sonoro é opção OpenAgent, desligada por default.
- **Referências:** — (não exige critério IPV).
- **Cobertura:** decisão proativa; implantação futura fora do ESCOPO.

### IPO-19 — Modos customizados nomeados próprios
- **Igual:** criação de modos customizados com ferramentas/permissões específicas.
- **Difere:** nomes, ícones e terminologia próprios dos modos (ex.: equivalente de "Debug mode" OpenAgent chamado por nome próprio).
- **Referências:** IPV-AGPN-03 (modos base), IPV-SETG-17.
- **Cobertura:** PENDENTE.

### IPO-20 — Nenhum asset de marca no pacote
- **Igual:** —.
- **Difere:** pipeline de distribuição exclui qualquer asset de marca (checks no build).
- **Referências:** IPV-WBGL-18, `docs/provenance-policy.md`.
- **Cobertura:** PARCIAL (policy: `scripts/inventory-cursor-artifacts.js`/check de build pendente).
