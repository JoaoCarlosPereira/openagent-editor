# services/

Processos de runtime isolados do renderer Electron.

## Planejado (TechSpec)

| Serviço | Descrição |
|---------|-----------|
| `services/harness-daemon` | Sessões, fila, subagentes, policy |
| `services/extension-host` | Host compatível com extensões Cursor 3.24.18 |

Cada serviço terá `package.json` próprio e entrará no workspace npm (`services/*`).
