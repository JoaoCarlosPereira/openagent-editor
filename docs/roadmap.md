# Plano de paridade funcional

## Base entregue

O Code OSS fornece edição, terminal, Git, depuração, extensões e interface multiplataforma. A extensão OpenAgent fornece chat, contexto explícito, chave em armazenamento seguro, edição com prévia e autocomplete inline opcional.

## Próximas entregas

| Prioridade | Capacidade | Critério verificável |
| --- | --- | --- |
| P1 | Agente com ferramentas | Lê arquivos autorizados, pesquisa no workspace e propõe alterações em lote com diff. Comandos de terminal exigem confirmação. |
| P1 | Indexação local | Busca semântica incremental por workspace com exclusões e inspeção dos dados indexados. |
| P1 | Contexto de múltiplos arquivos | Usuário escolhe arquivos e diretórios a anexar, com orçamento de contexto visível. |
| P2 | MCP | Cliente para servidores MCP configurados pelo usuário, com lista de ferramentas e consentimento por execução. |
| P2 | Histórico e sessões | Conversas salvas localmente por workspace, exportáveis e removíveis. |
| P2 | Regras e modos | Instruções por workspace e perfis Ask/Edit/Agent. |
| P2 | Múltiplos provedores | Adaptadores para APIs locais e remotas, medição de tokens e erros claros. |
| P3 | Distribuição própria | Build reproduzível do Code OSS, nome e ícones próprios, pacotes Linux/Windows/macOS e atualizações. |
| P3 | Testes de paridade | Cenários observáveis repetidos no produto de referência e no OpenAgent. |

Os itens acima são decisões de produto para o clone. A existência de módulos no aplicativo de referência não prova, por si só, detalhes de comportamento em execução.
