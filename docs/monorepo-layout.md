# Layout do monorepo

Este repositório segue **npm workspaces** com pastas por papel. A TechSpec SDD (SpecWorkspace `3ee1d27b-fe1d-46ed-b135-69ed799628b9`) é a fonte de verdade para componentes futuros; este documento descreve o estado do checkout.

## Árvore (resumo)

| Caminho | Papel |
|--------|--------|
| `apps/` | Aplicações entregáveis (`editor`, `cli` — planejados). |
| `services/` | Processos long-lived (`harness-daemon`, `extension-host` — planejados). |
| `packages/` | Bibliotecas TypeScript compartilhadas (`protocol`, `provenance`, `parity`, …). |
| `extension/` | **Protótipo VS Code legado** (manifesto na raiz `package.json`). Referência até migração; não expandir arquitetura aqui. |
| `tests/` | Testes Node do protótipo legado (`extension/`). |
| `media/` | Ícones/recursos da extensão legada. |
| `scripts/` | Gates e helpers de CI (ver `scripts/README.md`). |
| `tooling/` | Documentação de tooling; scripts permanecem em `scripts/` por compatibilidade com tasks em voo. |
| `research/` | Pesquisa e proveniência (sem runtime de produto). |
| `schemas/` | JSON Schema (`provenance.schema.json`, exemplos). |
| `docs/` | Documentação de produto/paridade (não substitui SDD). |

## Workspaces npm

```json
"workspaces": ["packages/*", "services/*", "apps/*"]
```

Pacotes em `packages/*` têm `package.json` próprio. `apps/` e `services/` ganharão pacotes conforme as tasks de scaffold.

## Artefatos locais (não versionados)

Hashes e inventários em `research/provenance/` referenciam caminhos que podem existir só na máquina do desenvolvedor:

- `research/reverse-engineering/` — export RE / pseudocódigo Cursor 3.24.18
- `sources/cursor/` — documentação pública espelhada localmente
- `resources/app/` — bundles JS da instalação Cursor (gate diferencial)

Esses diretórios estão no `.gitignore`. Não apague evidências locais sem registrar o que seria removido.

## Migrações adiadas (rebase em worktrees)

| De | Para | Motivo |
|----|------|--------|
| `extension/` + manifesto raiz | `apps/openagent-vscode` ou pacote dedicado | Quebra F5, CI `check`, tasks 11–13 se feito às pressas |
| `scripts/` | `tooling/scripts/` | Muitos `require.resolve` em testkit/integration |

Quando migrar a extensão, atualizar: `package.json` raiz, `.vscode/launch.json`, `npm run check`, README e workflows.

## SDD vs `.docs/`

Specs oficiais: OpenMemory / `read_spec_document` no workspace acima. Qualquer PRD legado em `.docs/` (se existir) é insumo histórico, não teto de escopo.
