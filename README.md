# OpenAgent Editor

Projeto aberto para construir uma experiência de editor com assistência de IA sobre o **Code OSS**. A primeira entrega é uma extensão funcional, com código próprio e licença MIT. Ela roda em editores compatíveis com a API de extensões do VS Code.

## Estado atual

- Chat em painel lateral com API de `chat/completions` compatível com OpenAI; endpoint e modelo configuráveis.
- Contexto do arquivo ativo ou da seleção enviado quando o usuário faz uma pergunta, com limite configurável.
- Chave de API guardada no `SecretStorage` do editor.
- Autocomplete inline opcional com debounce, cancelamento e limite de resposta.
- Comandos para explicar e editar a seleção. Edições mostram diff e pedem confirmação antes de alterar o arquivo.
- Editor, terminal, Git, depuração e extensões vêm da base Code OSS; este repositório ainda não distribui um binário próprio do editor.

## Executar

1. Abra esta pasta no Code OSS, VS Code ou editor compatível.
2. Pressione `F5` e selecione **OpenAgent Extension** para abrir a janela de desenvolvimento de extensões. A extensão não precisa de `npm install` nem de compilação.
3. Configure `openagent.baseUrl` e `openagent.model`. O padrão aponta para uma API local no formato do Ollama (`http://localhost:11434/v1`). O modelo padrão precisa existir no provedor.
4. Se necessário, execute **OpenAgent: Set API Key** na paleta de comandos.
5. Abra o ícone OpenAgent na barra lateral ou use o menu de contexto de uma seleção.

`npm test` executa os testes sem depender do editor. `npm run check` valida a sintaxe.

## Direção técnica

O produto completo deve empacotar Code OSS e esta camada de IA com identidade, atualizações e instaladores próprios. A extensão é o primeiro módulo desse produto. O [plano de paridade](docs/roadmap.md), a [matriz de funcionalidades](docs/feature-matrix.md) e o [caderno de evidências](docs/evidence.md) orientam as próximas etapas.

Não inclua binários, código, recursos de marca ou credenciais do Cursor neste repositório. As observações de engenharia reversa são registradas como fatos e hipóteses, sem copiar implementação proprietária.
