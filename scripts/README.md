# scripts/

Helpers invocados pelos scripts npm na raiz. Não fazem parte do runtime do editor.

| Script | npm | Função |
|--------|-----|--------|
| `run-unit-tests.mjs` | `test:unit` | Descobre e executa testes unitários nos workspaces |
| `test-integration.js` | `test:integration` | Descobre testes de integração |
| `check-provenance-gate.mjs` | `check:provenance` | Gate de `provenance.json` via `@openagent/provenance` |
| `inventory-cursor-artifacts.js` | (manual) | Gera `research/provenance/cursor-3.24.18.inventory.json` |
| `parity-report.mjs` | `parity:report` | Relatório de paridade (`@openagent/parity`) |

Execução típica na raiz: `npm run test:unit`, `npm run check:provenance`.
