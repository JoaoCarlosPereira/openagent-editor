# IPV-SETG — Settings (models/MCP/rules/skills/permissions)

Paridade observável das páginas de configuração do editor (equiv. comportamental do "Cursor Settings" do oráculo), com identidade própria. Cobertura canônica: CUS-01..CUS-03, UI-03, API-01..API-03, MCP-01, PER-01..PER-03, PRV-02.

Origens: `O#` (URL 2026-10-30), `C#` (catálogo), `P#` (inventário), `A#` (arquivos OpenAgent).

### IPV-SETG-01 — Página de provedor/modelo com teste de conexão
- **QUANDO** o usuário abrir a página de modelos/provedor ENTÃO DEVE permitir configurar provedor, endpoint, modelo e credencial, testar conexão e exibir capabilities detectadas; credencial guarda-se no cofre do sistema operacional.
- **Teclado/A11y:** campos por teclado; botão Testar com resultado anunciável; sem nenhum espaço de brand no oráculo.
- **Estados/erros:** teste com falha → causa clara (API-02); credencial inválida → estado textual.
- **Origem:** C# API-01/CUS-02, UI-03 (onboarding de provedor); configuração por workspace ou usuário.
- **Cobertura:** COBERTA por API-01/UI-03 (packages/model-gateway, UI de página: parcial — páginas próprias em `docs/interface-parity.md` "Customize/settings").
- **Identidade:** IPO-10.

### IPV-SETG-02 — Onboard sem conta de fabricante
- **QUANDO** a primeira execução ocorrer ENTÃO onboarding DEVE conduzir configuração do provedor, teste de conexão e abrir projeto sem necessidade de conta qualquer do fabricante do oráculo.
- **Teclado/A11y:** fluxo navegável só com teclado; cada etapa precedente retornável.
- **Estados/erros:** pular → editor aberto com estado sem provedor e convite nos Settings.
- **Origem:** C# UI-03; `docs/interface-parity.md` (Onboarding "Fluxo inicial de configuração do provedor, teste da API").
- **Cobertura:** COBERTA por UI-03.
- **Identidade:** IPO-10.

### IPV-SETG-03 — MCP: servidores e ferramentas
- **QUANDO** o usuário configurar servidor MCP stdio/HTTP ENTÃO a página DEVE listar servidores e abrir ferramentas declaradas, com estado de conexão lado-a-lado.
- **Teclado/A11y:** tabelas navegáveis; estado textual.
- **Estados/erros:** servidor inacessível → estado de erro com causa; ferramenta indisponível → marca própria de indisponível.
- **Origem:** C# MCP-01; `docs/feature-matrix.md` (cursor-mcp; prontidão local implementável).
- **Cobertura:** COBERTA (parcial) por MCP-01 (integração backend; página própria: pendente).
- **Identidade:** IPO-10.

### IPV-SETG-04 — MCP execução com permissão
- **QUANDO** o usuário executar a ferramenta MCP escolhida ENTÃO o sistema DEVE pedir aprovação por execução e mostrar resultado ou erro.
- **Teclado/A11y:** cartão de permissão igual ao de ferramentas nativas (PER-01); teclado completo.
- **Origem:** C# MCP-01, PER-01.
- **Cobertura:** COBERTA por MCP-01/PER-01 (`apps/editor/src/permissions/permission-dialog.ts`).
- **Identidade:** —.

### IPV-SETG-05 — Rules: usuário e projeto
- **QUANDO** o usuário abrir Rules ENTÃO DEVE exibir regras de usuário e de projeto aplicáveis, com origem de cada uma e marca de atividade.
- **Teclado/A11y:** lista navegável; origem textual.
- **Estados/erros:** regra inválida → erro de leitura com localização.
- **Origem:** C# CUS-01.
- **Cobertura:** COBERTA por CUS-01.
- **Identidade:** IPO-10.

### IPV-SETG-06 — Skills/comandos/plugins locais
- **QUANDO** o usuário abrir skills/comandos ENTÃO DEVE listar os locais disponíveis com origem e instrução descrita (nada executa fora de permissão).
- **Teclado/A11y:** busca/lista por teclado.
- **Origem:** C# CUS-02.
- **Cobertura:** COBERTA por CUS-02.
- **Identidade:** IPO-10.

### IPV-SETG-07 — Permissions: capability, alvo, escopo
- **QUANDO** o usuário abrir a página de permissões ENTÃO DEVE (a) listar ferramentas/MCP/grupos declarando capability/alvo/scope, (b) exigir grant explícito e (c) mostrar estado de grant por linha.
- **Teclado/A11y:** concessão por teclado, sem duplo sentido.
- **Estados/erros:** grant revogado → recusado em runtime com mensagem PER-01.
- **Origem:** C# PER-01; `docs/feature-matrix.md` (accept before execution).
- **Cobertura:** COBERTA por PER-01.
- **Identidade:** IPO-10.

### IPV-SETG-08 — Modo somente leitura e bloqueio
- **QUANDO** o modo de execução Somente leitura for ativo ENTÃO a página DEVE exibir o modo e a runtime recusar mutação com a mensagem canônica ("Bloqueado pelo modo de execução.").
- **Teclado/A11y:** estado de modo visível no painel e na página.
- **Origem:** C# PER-03.
- **Cobertura:** COBERTA por PER-03 (`read-only-block.ts`).
- **Identidade:** —.

### IPV-SETG-09 — Sandbox e modo degradado informado
- **QUANDO** o run da ferramenta configurar worker isolado com sandbox nativa ENTÃO disponibilidade de sandbox DEVE ser mostrada; quando houver modo degradado (sandbox indisponível), este DEVE ser informado antes do consentimento.
- **Teclado/A11y:** aviso textual antes de escolha.
- **Origem:** C# PER-02.
- **Cobertura:** COBERTA por PER-02.
- **Identidade:** —.

### IPV-SETG-10 — Aprovação de comandos com args visíveis
- **QUANDO** ferramenta sensível pedir permissão ENTÃO o cartão DEVE exibir comando completo incluindo argumentos, com aceitar/recusar antes da execução (comportamento do auto-review público: comandos perigosos de delete sempre exibem cartão).
- **Teclado/A11y:** aceitar/recusar por teclado; argumentos legíveis por leitor.
- **Estados/erros:** recusa → ferramenta não executa; recusa registrada com causa no log.
- **Origem:** O5 (auto-review asks before risky deletes; "Commands that match one of your block instructions now always show the approval card"); C# AGT-03/PER-01.
- **Cobertura:** COBERTA por AGT-03/PER-01 (`permission-dialog.ts`).
- **Identidade:** —.

### IPV-SETG-11 — Tópicos de Settings no tema/largura
- **QUANDO** a página abrir em tema claro/escuro e largura pequena ENTÃO controles DEVEM permanecer legíveis e operáveis (regra UI-02).
- **Teclado/A11y:** ordem de tabulação consistente; sem cut-off em largura mínima.
- **Origem:** C# UI-02.
- **Cobertura:** PENDENTE (páginas próprias em lote futuro).
- **Identidade:** —.

### IPV-SETG-12 — Configuração preservada em atualização
- **QUANDO** o editor atualizar ENTÃO as configurações (provedor, regras, MCP, permissões, tema) DEVEM preservar-se; dados locais não são derrubados.
- **Teclado/A11y:** —.
- **Origem:** C# DES-01/CUS-03; `docs/parity-acceptance.md` (atualizações).
- **Cobertura:** COBERTA (parcial) por DES-01 (empacotamento; migração de settings: pendente).
- **Identidade:** —.

### IPV-SETG-13 — APIs compatíveis com sidecar local
- **QUANDO** o usuário configurar APIs compatíveis ENTÃO o layout DEVE expor configuração através do gateway sidecar, com binding localhost e token efêmero e estado visível.
- **Teclado/A11y:** campos textuais com estados claros.
- **Estados/erros:** binding fora de localhost → bloqueio com causa (API-03).
- **Origem:** C# API-03.
- **Cobertura:** COBERTA por API-03.
- **Identidade:** —.

### IPV-SETG-14 — Página de sugestões/Tab
- **QUANDO** sugestões enquanto digitar forem configuráveis ENTÃO a página própria DEVE agrupar config de on/off global e por tipo de arquivo (equivalente ao O7; dentro do lote de páginas do workbench).
- **Teclado/A11y:** configuração por teclado.
- **Origem:** O7 ("configure Tab settings in Settings > Tab"); C# CUS-03.
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** IPO-10.

### IPV-SETG-15 — Modelos compartilham contexto de sessão
- **QUANDO** sessão tiver multi-provedores ENTÃO página DEVE exibir opções de medição de tokens e de erros claros por provedor (SES-05).
- **Teclado/A11y:** indicators textuais.
- **Origem:** C# SES-05.
- **Cobertura:** COBERTA por SES-05.
- **Identidade:** —.

### IPV-SETG-16 — Persistência da gravação
- **QUANDO** qualquer page de Settings gravar dado ENTÃO a gravação DEVE persistir localmente por workspace ou usuário, e os dados DEVEM preservar-se em atualização (DES-01).
- **Teclado/A11y:** —.
- **Origem:** C# DES-01.
- **Cobertura:** COBERTA por DES-01.
- **Identidade:** —.

### IPV-SETG-17 — Página de modo de depuração
- **QUANDO** o campo de debug mode estiver disponível ENTÃO a página DEVE indicar instrumentação do modo e exibir hipótese/evidência/verificação (requisito AGT-04).
- **Teclado/A11y:** etapas navegáveis por teclado.
- **Origem:** C# AGT-04; `docs/feature-matrix.md` (Debug Mode pendente).
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** IPO-10.

### IPV-SETG-18 — Rotinas de indexação (settings)
- **QUANDO** página de contexto abrir ENTÃO DEVE exibir escopo/tamanho do índice local e a ação de limpar por workspace (CTX-04) com estado.
- **Teclado/A11y:** confirmar clear por diálogo padrão.
- **Origem:** C# CTX-04.
- **Cobertura:** COBERTA por CTX-04.
- **Identidade:** —.

### IPV-SETG-19 — Exclude rules editáveis
- **QUANDO** o usuário editar ignore/exclusions ENTÃO a página DEVE permitir editar e validar a regra, exibindo o escopo (mecanismo equivalente ao ignore file público).
- **Teclado/A11y:** caixa de texto com validação; erro textual.
- **Origem:** C# CTX-03; O11 (link ignore files no help; `docs/feature-matrix.md` "Não traçado no pacote, docs describe").
- **Cobertura:** COBERTA por CTX-03 (página própria de edição: pendente).
- **Identidade:** —.

### IPV-SETG-20 — Identidade própria e organização igual
- **QUANDO** qualquer página de Settings abrir ENTÃO a organização (agrupamento/seções) pode ser equivalente, mas títulos, descrição, ícones e logotipo DEVEM ser OpenAgent.
- **Teclado/A11y:** mantidas regras de a11y.
- **Origem:** `docs/provenance-policy.md`; princípio canônico do PRD (sem copiar marca).
- **Cobertura:** PENDENTE (páginas próprias; lote de customize).
- **Identidade:** IPO-10.
