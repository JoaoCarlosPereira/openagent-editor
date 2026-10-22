# Paridade de interface

Estado em 2026-10-22: **não idêntica**. A versão 0.3 usa o workbench do Code OSS e um painel OpenAgent próprio. O painel já oferece conversa, seletor Ask/Agent, indicação de modelo e contexto, nova conversa e revisão de alterações. O restante da janela conserva o visual padrão do editor hospedeiro.

## Referência observada

Os recursos de onboarding da instalação Linux 3.16.17 em `out/vs/workbench/contrib/onboarding/electron-sandbox/media/assets/` mostram trechos do compositor de Agent e da edição inline. O pacote também contém `workbench.desktop.main.css`, `workbench.desktop.main.js` e `workbench.anysphere-ui-automations.js`, indicando uma UI do workbench distribuída com o produto. Esses arquivos são referência de observação; não serão copiados para o código aberto.

A documentação oficial descreve elementos de interface que entram nos cenários de paridade: painel e modos de [Agent](https://prod.cursor.com/help/ai-features/agent), sugestões e saltos de [Tab](https://cursor.com/help/ai-features/tab), overlay de [Inline Edit](https://docs.cursor.com/en/inline-edit/overview), diff e [checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints).

| Área | Situação no OpenAgent | Trabalho necessário |
| --- | --- | --- |
| Janela do editor, abas e explorador | Vem do Code OSS/host | Criar distribuição própria e ajustar layouts, comandos e temas do workbench. |
| Painel Agent | Painel próprio com conversa, modo, modelo e contexto | Adicionar histórico, fila, anexos, indicadores de ferramentas e revisão integrada. |
| Inline Edit | Comando e diff em janela separada | Criar widget sobre o editor, estados de geração e refinamento. |
| Tab | Sugestão inline básica | Adicionar saltos, edições multilinha e entre arquivos, controles de status. |
| Diffs/checkpoints | Prévia antes de aplicar | Revisão agrupada por conversa e restauração de checkpoints. |
| Customize/settings | Configurações padrão da extensão | Construir páginas próprias para modelos, MCP, regras, skills e permissões. |
| Onboarding | README | Fluxo inicial de configuração do provedor, teste da API e projeto de exemplo. |

## Estratégia de implementação

O painel da extensão serve para validar fluxos e backend. Para paridade da janela inteira, o produto precisa de um fork mantido do Code OSS, com mudanças próprias de workbench e build. A aceitação visual exige capturas comparáveis em Linux e Windows, tema claro/escuro e larguras de painel variadas. Serão verificadas estrutura, densidade, estados vazios, teclado, foco, acessibilidade e transições, além das cores e dimensões.

O objetivo é reproduzir o comportamento e a organização visual com marca e recursos próprios. Uma captura semelhante não substitui os testes dos fluxos descritos em [parity-acceptance.md](parity-acceptance.md).
