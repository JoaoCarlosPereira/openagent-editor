# Caderno de evidências — Cursor

Data da investigação: 2026-10-22. Artefatos do usuário, analisados localmente em modo estático.

## Identidade

| Artefato | Observação | Fonte |
| --- | --- | --- |
| Linux instalado | `Cursor` 3.16.17, aplicativo derivado de `microsoft/vscode` conforme metadados do pacote | `/usr/share/cursor/resources/app/package.json` |
| Linux instalado | `product.json` informa commit `6b2afae0257df2bb5e1835f15165dc2f0de056b0` e galeria própria | `/usr/share/cursor/resources/app/product.json` |
| Windows | Instalador Inno Setup, versão 3.24.18, empresa Anysphere | `CursorUserSetup-x64-3.24.18.exe`, cabeçalho PE e recursos; SHA-256 `be9e5c53b9dbd8b08bd719ef57b983b12317380ee70b6bb0e02411cb491e49e2` |

REA `inspect-artifact` confirmou a identidade PE e o SHA-256 do instalador (Evidence `ev_7390c945e689327c5546b1d1a1b9b01b1d48c04a3100d23197ffd57e3c90c7c7`). Esse inventário não interpretou o payload Inno. `inspect-pe-resources` recusou o arquivo pelo limite de entrada de 64 MiB; a falha não é evidência de ausência de recursos.

## Módulos observados na instalação Linux

Manifests de extensões incluídas em `/usr/share/cursor/resources/app/extensions`:

| Área | Evidência estática | Alcance da conclusão |
| --- | --- | --- |
| Agentes | `cursor-agent-host`, `cursor-agent-exec`, `cursor-local-agent-runtime`, `cursor-agent-worker` | Há módulos distribuídos com esses papéis declarados. Fluxos em execução ainda não foram observados. |
| Busca e indexação | `cursor-retrieval`, `cursor-file-service` | Descrições declaram indexação e recuperação. Algoritmo, armazenamento e qualidade não foram verificados. |
| MCP | `cursor-mcp` | Há extensão dedicada a MCP. Ferramentas e políticas ainda não foram traçadas. |
| Navegador | `cursor-browser-automation` | Há módulo de automação de navegador. |
| Worktrees | `cursor-shadow-workspace`, `cursor-worktree-textmate`, `cursor-checkout` | Há suporte empacotado relacionado a worktrees e checkout. |
| Remoto | `cursor-resolver`, `cursor-resolver-helper`, `cursor-socket` | Há componentes para resolução de autoridade remota e socket. |

O pacote Windows é mais recente que a instalação Linux. A extração completa ficou pendente: `innoextract` 1.9 rejeitou o cabeçalho Inno 6.4.0.1 e `7z` só expôs o fluxo comprimido do instalador. Nenhuma função da versão Windows foi inferida da versão Linux sem ressalva.

## CLI instalada

O launcher local `~/.local/bin/cursor-agent` aponta para a distribuição `2026.07.23-e383d2b`. A saída de `cursor-agent --help`, observada sem iniciar sessão de agente, declara modos `plan` e `ask`, execução interativa ou `--print`, saída `text/json/stream-json`, retomada de sessões, escolha de modelo, worktrees, sandbox, auto-review, MCP e plugins. `cursor-agent mcp --help` lista `login`, `list`, `list-tools`, `enable` e `disable`. Isso comprova a superfície de comandos da versão CLI instalada, não seu funcionamento remoto ou equivalência com o editor 3.16.17.

## Método e limites

REA CLI 6.7.0 foi usado para análise estática dos manifests de `cursor-agent-exec` (Evidence `ev_9c5d0f0b6fd06eef5ee0edf637ceb11b9f1cecee452dbfcf663efe33bdf01371`), `cursor-mcp` (Evidence `ev_269cb4b023aea626f42bce02988c275c8beb6c738dcbc7024cfd24d1607632f6`) e `cursor-retrieval` (Evidence `ev_2741f6d872c7c5bc1031b354e6ea525a8084e4ec8eddff8d8c0a58b9a18d15ef`). Esses resultados cobrem só os manifests selecionados; relações com os bundles JavaScript não foram analisadas. Os manifests foram também lidos diretamente para o inventário acima. Não houve captura de rede. O próximo passo da investigação é traçar chamadas e limites de dados em módulos selecionados, depois observar cenários da interface.

O módulo `cursor-browser-automation` teve `package.json` e `dist/extension.js` analisados estaticamente pela REA (Evidence `ev_f84b6499127b7dc81439b6341047f6f2860dea2b9e01a2c541d74f36d1d9ff0c`). A análise processou 221.159 bytes de texto, um arquivo JavaScript e 17.596 nós AST, sem falha de parse. Outros nove arquivos inventariados ficaram fora do escopo; nenhum comportamento em execução foi observado.
