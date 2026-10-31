# tooling/

Configuração compartilhada de build, lint e CI helpers.

Hoje os executáveis ficam em [`../scripts/`](../scripts/) para não quebrar paths fixos em `packages/testkit*` e no `package.json` raiz. A consolidação física em `tooling/scripts/` é uma migração adiada (ver [`../docs/monorepo-layout.md`](../docs/monorepo-layout.md)).
