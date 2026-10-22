# Matriz de funcionalidades do Cursor

Levantamento em 2026-10-22. **Pacote** = módulo encontrado na instalação Linux 3.16.17, salvo indicação de Windows 3.24.18. **Docs** = função descrita na documentação oficial consultada nesta data. Uma linha com ambos não prova que o fluxo documentado exista exatamente nessas versões instaladas.

| Capacidade | Evidência do pacote instalado | Documentação oficial | OpenAgent 0.2 |
| --- | --- | --- | --- |
| Editor, terminal, Git, debug e extensões | `package.json` aponta para `microsoft/vscode`; diretórios `out/vs` e `extensions` | [Instalação e extensões](https://docs.cursor.com/get-started/installation) | Base Code OSS, sem distribuição própria |
| Chat e modos Agent/Ask/Plan/Debug | `cursor-agent-host`, `cursor-agent-exec`, `cursor-local-agent-runtime`; `out/vs/workbench/contrib/composer` | [Agent e modos](https://prod.cursor.com/help/ai-features/agent) | Ask e Agent básicos; Plan e Debug pendentes |
| Ferramentas do agente: busca, leitura, edição e terminal | `cursor-agent-exec`, `cursor-retrieval` | [Ferramentas](https://docs.cursor.com/en/agent/tools) | Ciclo local de ferramentas, diff/aprovação para edição e comando; ainda sem alterações em lote |
| Subagentes e fila de mensagens | Módulos de agente; detalhes não confirmados no pacote | [Agent](https://prod.cursor.com/help/ai-features/agent) | Pendente |
| Autocomplete Tab, múltiplas linhas e saltos | Implementação específica não isolada | [Tab](https://cursor.com/help/ai-features/tab) | Continuação inline básica, opcional; sem saltos/edições cruzadas |
| Inline Edit e edição de arquivo inteiro | `out/vs/workbench/contrib/composer`; detalhes não confirmados | [Inline Edit](https://docs.cursor.com/en/inline-edit/overview) | Seleção com prompt e prévia; sem UI inline ou edição integral |
| Contexto de seleção, arquivos e pastas | `cursor-file-service`, `cursor-retrieval` | [Inline Edit](https://docs.cursor.com/en/inline-edit/overview) | Arquivo ativo ou seleção, com limite de caracteres |
| Indexação e busca semântica | `cursor-retrieval` declara indexação e recuperação | [Indexação](https://docs.cursor.com/get-started/installation), [modelo de segurança](https://www.cursor.com/security) | Pendente |
| Exclusões de arquivos | Não traçado no pacote | [Ignore file](https://cursor.com/docs/reference/ignore-file) | Pendente |
| MCP e ferramentas externas | `cursor-mcp` | [MCP](https://prod.cursor.com/help/customization/mcp) | Pendente |
| Navegador controlado por agente | `cursor-browser-automation` | [Browser](https://cursor.com/docs/agent/tools/browser) | Pendente |
| Uso do computador | `cursor-computer-use` existe no Windows 3.24.18; bundle contém nomes de ferramentas de screenshot, clique, scroll, digitação e permissões | [Automations e computer use](https://cursor.com/docs/cloud-agent/automations) | Pendente; execução e aprovação ainda não observadas |
| Regras, skills, comandos, hooks e plugins | Não inventariados em detalhe no pacote | [Rules](https://prod.cursor.com/docs/rules), [Plugins](https://prod.cursor.com/docs/plugins) | Pendente |
| Checkpoints e restauração | Não traçado no pacote | [Checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints) | Pendente |
| Worktrees e checkout | `cursor-shadow-workspace`, `cursor-checkout`, `cursor-worktree-textmate` | [Agent](https://prod.cursor.com/help/ai-features/agent) | Pendente |
| Cloud Agents | `cursor-agent-worker` e `cursor-resolver` sugerem integração, sem comprovar execução remota | [Cloud Agents](https://prod.cursor.com/help/ai-features/background-agents) | MVP seguinte |
| CLI para agente | `cursor-agent --help` local declara modos, sessões, worktrees, sandbox, MCP e plugins | [Cursor CLI](https://cursor.com/docs/cli/overview) | Pendente |
| Automações remotas | Não identificadas na instalação local | [Automations](https://cursor.com/docs/cloud-agent/automations) | MVP seguinte |
| Debug Mode com instrumentação | Módulos de agente; fluxo não isolado | [Debug Mode](https://prod.cursor.com/for/debugging) | Pendente |

## Prioridades de reprodução

1. Construir um agente local com ferramentas de leitura, busca e edição em lote, antes de serviços remotos.
2. Acrescentar indexação local e exclusões; medir a qualidade da recuperação em projetos reais.
3. Evoluir Tab e Inline Edit para edições de múltiplas linhas/arquivos e saltos.
4. Integrar MCP, regras, sessões, checkpoints e navegador.
5. Empacotar o Code OSS e criar distribuição própria. Cloud Agents e automações pertencem à MVP seguinte.

As funções do Cursor documentadas online podem ter sido lançadas depois das versões examinadas. A matriz indica o método de cada afirmação para evitar equivalência indevida entre versões.
