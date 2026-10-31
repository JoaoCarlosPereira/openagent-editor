# research/

Material de **pesquisa e rastreabilidade** — não importar em runtime de produção.

## Estrutura

| Caminho | Conteúdo |
|---------|----------|
| `provenance/` | Inventários JSON commitados (ex.: `cursor-3.24.18.inventory.json`) |
| `reverse-engineering/` | **Local opcional**: exports RE, pseudocódigo, symlinks para bundles externos |

## reverse-engineering/

Não versionamos binários nem pseudocódigo completo no Git. O inventário em `provenance/` guarda **hashes e caminhos lógicos** quando os arquivos existem localmente.

Para reproduzir hashes na sua máquina:

1. Coloque o bundle em `research/reverse-engineering/cursor-3.24.18/` (cópia ou symlink documentado).
2. Regenerar: `node scripts/inventory-cursor-artifacts.js` (ver flags em `--help`).

Espelhos opcionais de documentação pública: `sources/cursor/` na raiz. Bundles de app: `resources/app/` — ambos ignorados pelo Git (ver `.gitignore`).

## ESLint

A pasta `research/` está ignorada em `eslint.config.mjs` (dados, não código de produto).
