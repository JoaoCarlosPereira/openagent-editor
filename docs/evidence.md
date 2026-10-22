# Caderno de evidências — Cursor

Data da investigação: 2026-10-22. Artefatos do usuário, analisados localmente em modo estático.

## Identidade

| Artefato | Observação | Fonte |
| --- | --- | --- |
| Linux instalado | `Cursor` 3.16.17, aplicativo derivado de `microsoft/vscode` conforme metadados do pacote | `/usr/share/cursor/resources/app/package.json` |
| Linux instalado | `product.json` informa commit `6b2afae0257df2bb5e1835f15165dc2f0de056b0` e galeria própria | `/usr/share/cursor/resources/app/product.json` |
| Windows | Instalador Inno Setup, versão 3.24.18, empresa Anysphere; pacote extraído declara commit `be4c9e5350d77747b42cd467cbd3370a753d4640` | `CursorUserSetup-x64-3.24.18.exe`, cabeçalho PE e `resources/app/{package,product}.json`; SHA-256 do instalador `be9e5c53b9dbd8b08bd719ef57b983b12317380ee70b6bb0e02411cb491e49e2` |

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

O pacote Windows é mais recente que a instalação Linux. `innoextract` 1.9 rejeitou o cabeçalho Inno 6.4.0.1, mas uma compilação local de `innoextract` 1.10-dev no commit `6e9e34e` conseguiu listar e extrair o instalador. O conteúdo extraído ocupa 1011 MiB em `/mnt/Dados/dsv/REA/artifacts/windows-3.24.18`. A versão Windows contém 116 extensões empacotadas contra 115 no Linux; entre os módulos `cursor-*`, `cursor-computer-use` aparece somente no Windows. O manifesto desse módulo declara “Computer use in Cursor” e ativação `onStartupFinished`. Isso demonstra a inclusão do módulo, sem provar ações disponíveis em execução.

## CLI instalada

O launcher local `~/.local/bin/cursor-agent` aponta para a distribuição `2026.07.23-e383d2b`. A saída de `cursor-agent --help`, observada sem iniciar sessão de agente, declara modos `plan` e `ask`, execução interativa ou `--print`, saída `text/json/stream-json`, retomada de sessões, escolha de modelo, worktrees, sandbox, auto-review, MCP e plugins. `cursor-agent mcp --help` lista `login`, `list`, `list-tools`, `enable` e `disable`. Isso comprova a superfície de comandos da versão CLI instalada, não seu funcionamento remoto ou equivalência com o editor 3.16.17.

## Método e limites

REA CLI 6.7.0 foi usado para análise estática dos manifests de `cursor-agent-exec` (Evidence `ev_9c5d0f0b6fd06eef5ee0edf637ceb11b9f1cecee452dbfcf663efe33bdf01371`), `cursor-mcp` (Evidence `ev_269cb4b023aea626f42bce02988c275c8beb6c738dcbc7024cfd24d1607632f6`) e `cursor-retrieval` (Evidence `ev_2741f6d872c7c5bc1031b354e6ea525a8084e4ec8eddff8d8c0a58b9a18d15ef`). Esses resultados cobrem só os manifests selecionados; relações com os bundles JavaScript não foram analisadas. Os manifests foram também lidos diretamente para o inventário acima. Não houve captura de rede. O próximo passo da investigação é traçar chamadas e limites de dados em módulos selecionados, depois observar cenários da interface.

O módulo `cursor-browser-automation` teve `package.json` e `dist/extension.js` analisados estaticamente pela REA (Evidence `ev_f84b6499127b7dc81439b6341047f6f2860dea2b9e01a2c541d74f36d1d9ff0c`). A análise processou 221.159 bytes de texto, um arquivo JavaScript e 17.596 nós AST, sem falha de parse. Outros nove arquivos inventariados ficaram fora do escopo; nenhum comportamento em execução foi observado.

O mesmo recorte do módulo no Windows 3.24.18 gerou Evidence `ev_f141c40d551c7731ad8f17c5349de0403676238126fe5a9be9c94c30e2a3cee8`. A comparação REA entre as duas versões (Evidence `ev_0e22c606631cdfca79db7ba57089995cd5f694193c090af77d5b0e9997e1a5a5`) apontou 10 itens alterados e 77 desconhecidos. Como ambos os grafos são parciais, nenhum item foi classificado como adicionado ou removido. Esses números medem o recorte estático selecionado, não a diferença funcional completa entre versões.

No pacote Windows, `cursor-computer-use/package.json` e `dist/extension.js` foram analisados estaticamente pela REA (Evidence `ev_2c150c41411112a327416dfdbcf248ceac305e4343326f9812259dc94c0f9ae5`). A análise leu 1.517.064 bytes de texto e 354.540 nós AST, sem falha de parse; 79 arquivos inventariados ficaram fora do escopo. Uma busca literal no bundle encontrou identificadores de ferramentas como `computer_use_screenshot`, `computer_use_click`, `computer_use_scroll`, `computer_use_drag`, `computer_use_typing`, `computer_use_press_key`, `computer_use_select_app`, `computer_use_app_state` e `computer_use_check_permissions`. Esses nomes sugerem a superfície planejada do módulo, mas não demonstram registro, execução ou política de aprovação em runtime.
