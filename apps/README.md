# apps/

Aplicações entregáveis do OpenAgent Editor (Electron workbench, CLI).

## Planejado (TechSpec)

| Pacote | Descrição |
|--------|-----------|
| `apps/editor` | Workbench Electron próprio |
| `apps/cli` | CLI headless/interativa |

## Legado hoje

O protótipo **VS Code** continua em [`../extension/`](../extension/) com o manifesto de extensão no [`package.json`](../package.json) da raiz. Use **F5 → OpenAgent Extension** na raiz do repositório.

Novos pacotes npm aparecerão aqui conforme as tasks de scaffold; não duplicar a extensão legada até a migração planejada.
