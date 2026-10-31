# IPV-WBGL — Workbench global (temas, comandos, layouts, keybindings)

Paridade observável das superfícies globais do workbench: temas, paleta de comandos, configuração de layout, editor de keybindings e distribuição da janela. Cobertura canônica: LOC-01, UI-02, CUS-03, DES-01.

Origens: `O#` (URL 2026-10-30), `#vscode` (comportamento base do Code OSS documentado em https://code.visualstudio.com/docs/getstarted/keybindings e páginas correspondentes), `C#` (catálogo), `A#` (arquivos OpenAgent), `P#` (inventário).

## Janela e distribuição própria

### IPV-WBGL-01 — Janela com identidade própria
- **QUANDO** o editor iniciar ENTÃO a janela DEVE apresentar nome, logotipo e identidade OpenAgent, sem assets visuais do oráculo; o layout geral segue o editor base (abas, sidebar, painéis).
- **Teclado/A11y:** — (apariência).
- **Origem:** C# LOC-01, DES-01; P# `resources/app/out/vs/workbench/workbench.desktop.main.js` (h `ed6922…`, apenas referência de observação da UI distribuída do oráculo, nada copiado).
- **Cobertura:** PENDENTE (distribuição própria — lote principal do produto).
- **Identidade:** IPO-01.

### IPV-WBGL-02 — Abas/explorador com organização equivalente
- **QUANDO** o usuário editar arquivos ENTÃO a organização visual de abas, explorer, painel lateral e statusbar pode ser equivalente à base; comportamento e densidade verificados para OpenAgent.
- **Teclado/A11y:** todos os controles acessíveis por teclado como na base.
- **Origem:** `docs/interface-parity.md` ("A janela do editor, abas e explorador: vem do Code OSS/host"); P#: bundle `workbench.desktop.main.js`/`workbench.desktop.main.css` apenas como observação.
- **Cobertura:** PARCIAL por LOC-01 (base hospedeiro herda; verificação a cada distribuição própria.).
- **Identidade:** IPO-01.

## Temas

### IPV-WBGL-03 — Temas claros/escuros próprios
- **QUANDO** o usuário alternar ENTÃO o editor DEVE aplicar tema próprio (paleta OpenAgent) com todos os controles legíveis, e preservar conversas/diffs abertos.
- **Teclado/A11y:** contraste em ambos os temas; alternância por paleta de comandos.
- **Estados/erros:** tema inválido → fallback para tema padrão da distribuição.
- **Origem:** C# CUS-03/UI-02; `docs/interface-parity.md` ("capturas comparáveis … tema claro/escuro").
- **Cobertura:** PENDENTE (temas próprios: lote de customize).
- **Identidade:** IPO-01.

### IPV-WBGL-04 — Temas customizáveis
- **QUANDO** o usuário carregar tema próprio ENTÃO o editor DEVE aceitar temas customizáveis (formato da base) sem perder a identidade de marca nos pontos fixos (nomes/logo).
- **Teclado/A11y:** paleta de comandos para trocar tema; live preview.
- **Origem:** C# CUS-03.
- **Cobertura:** PENDENTE (sem card).
- **Identidade:** IPO-01.

## Paleta de comandos e comandos

### IPV-WBGL-05 — Paleta de comandos completa
- **QUANDO** o usuário abrir a paleta de comandos ENTÃO DEVE listar todos os comandos do editor, incluindo os comandos próprios (painel do agente, janela de agentes, revisão, permissões), com busca por texto e histórico.
- **Teclado/A11y:** filtro por teclado; Enter executa.
- **Origem:** #vscode (command palette do editor base); C# UI-01 (comandos próprios).
- **Cobertura:** COBERTA por UI-01 (base herda; comandos próprios registrados: `apps/editor/src/agent/agent-panel-keyboard.ts`).
- **Identidade:** —.

### IPV-WBGL-06 — Remap de comandos no editor de atalhos
- **QUANDO** o usuário quiser remapear comandos ENTÃO o editor de atalhos DEVE permitir remap de TODOS os comandos, incluindo os de IA próprios (painel, modos, instruções de modelo, aceitar sugestão).
- **Teclado/A11y:** busca, edição, duplicata por teclado; conflitos indicados.
- **Estados/erros:** conflito de atalho → indicador e resolução manual.
- **Origem:** O8/O7 (all keybindings remappable; comando de aceitar sugestão como exemplo de remap público); #vscode (keybindings editor); C# CUS-03.
- **Cobertura:** PARCIAL por CUS-03 (editor de atalhos da base: herança; remap dos comandos próprios: pendente).
- **Identidade:** —.

### IPV-WBGL-07 — Atalhos de IA presentes desde início
- **QUANDO** o editor distribuir ENTÃO os atalhos de IA (painel do agente, modo, aceitar sugestão, cancelar geração) DEVEM estar presentes por default remapeáveis, sem redundância de atalhos.
- **Teclado/A11y:** documentação própria de atalhos interna (binding).
- **Origem:** O8 (tabela de atalhos de IA — função/valor, sem fragmento de marca).
- **Cobertura:** PARCIAL por UI-01 (atalhos do painel: `agent-panel-keyboard.ts`; grade completa: pendente).
- **Identidade:** —.

## Layouts

### IPV-WBGL-08 — Painel de agente em layout alternável
- **QUANDO** o usuário alternar layout ENTÃO o painel do agente deve suportar alternância entre sidebar dedicada e janela separada (equiv. observável: atalho de agente layout no oráculo), com estado preservado.
- **Teclado/A11y:** atalho próprio; foco em transição consistente.
- **Estados/erros:** conversa aberta não pode ser perdida na transição.
- **Origem:** O9 (Cmd E "Toggle Agent layout").
- **Cobertura:** PENDENTE (janela separada layout: sem card).
- **Identidade:** —.

### IPV-WBGL-09 — Largura mínima do painel legível
- **QUANDO** o painel estreitar além de largura mínima ENTÃO controles DEVEM permanecer legíveis (elipses/empilhamento próprio) e a conversa deve permanecer preservada.
- **Teclado/A11y:** sem controles inalcanzáveis.
- **Origem:** C# UI-02.
- **Cobertura:** COBERTA por UI-02 (largura mínima tratada no painel: `agent-panel-appearance.ts`).
- **Identidade:** —.

### IPV-WBGL-10 — Layouts graváveis e restauráveis
- **QUANDO** o usuário rearranjar views ENTÃO o layout customizado DEVE gravar por workspace/usuário e restaurar na próxima sessão (persistência de layout — SES-01).
- **Teclado/A11y:** comandos de layout na paleta.
- **Origem:** C# CUS-03/SES-01 (config preservada em atualização DES-01).
- **Cobertura:** PARCIAL por CUS-03/SES-01 (mecanismo herdado do editor base).
- **Identidade:** —.

### IPV-WBGL-11 — Zen/foco de trabalho sem interferir no agente
- **QUANDO** o usuário ativar modos de foco do editor ENTÃO a execução do agente em curso DEVE continuar e notificar via statusbar (sem exigir foco de janela).
- **Teclado/A11y:** atalhos da base; notificação com ação própria.
- **Origem:** Comportamento de integração: statusbar conectada aos executores (STA-01).
- **Cobertura:** PARCIAL por STA-01.
- **Identidade:** —.

## Configuração e atualização

### IPV-WBGL-12 — Settings editor próprio
- **QUANDO** o usuário abrir Settings ENTÃO a página DEVE usar o editor base para preferências do editor base, e páginas OpenAgent próprias para modelos/MCP/regras/skills/permissões (ver IPV-SETG) para modelos/MCP/regras/skills/permissões (SETG).
- **Teclado/A11y:** buscar configuração por teclado; descrições anunciáveis.
- **Origem:** C# CUS-01/CUS-03; O9 (Ctrl+, General settings; Ctrl+Shift+J cursor settings equiv).
- **Cobertura:** PARCIAL por CUS-01/CUS-03 (páginas próprias pendentes).
- **Identidade:** IPO-10.

### IPV-WBGL-13 — Update preservando dados
- **QUANDO** chegar atualização ENTÃO aplicação DEVE distribuir com nome/ícones próprios e preservar configurações/sessões/índice (DES-01 — esteso do editor base).
- **Teclado/A11y:** notificação de update com ação.
- **Origem:** C# DES-01; `docs/parity-acceptance.md`.
- **Cobertura:** COBERTA por DES-01.
- **Identidade:** IPO-01.

### IPV-WBGL-14 — Package Linux/Windows/macOS próprios
- **QUANDO** instalar o editor ENTÃO os três sistemas DEVEM receber pacote próprio com nome OpenAgent e ícones próprios, não Code OSS/VSCodium.
- **Teclado/A11y:** —.
- **Origem:** C# LOC-01; `docs/parity-acceptance.md` (instalação).
- **Cobertura:** PENDENTE (distribuição própria: lote do produto).
- **Identidade:** IPO-01.

### IPV-WBGL-15 — De teclado ao painel do agente sem mouse
- **QUANDO** o usuário executar qualquer ação descrita em AGPN/HFIL ENTÃO deve existir caminho por teclado completo; nenhum controle exclusivo de mouse/pointer.
- **Teclado/A11y:** verificação por capturas em Linux e Windows (docs/interface-parity.md).
- **Origem:** C# UI-01.
- **Cobertura:** COBERTA por UI-01 (`agent-panel-keyboard.ts`).
- **Identidade:** —.

### IPV-WBGL-16 — Verificação de estrutura visual
- **QUANDO** avaliar paridade visual ENTÃO verificam-se estrutura, densidade, estados vazios, teclado, foco, acessibilidade e transições, além cores/dimensões — não pixel por pixel; decisões de estilo próprias são admitidas.
- **Teclado/A11y:** —.
- **Origem:** `docs/interface-parity.md` ("Serão verificadas estrutura, densidade, estados vazios, teclado, foco, acessibilidade e transições, além das cores/dimensões").
- **Cobertura:** processual (gate de aceite visual: `docs/parity-acceptance.md`).
- **Identidade:** IPO-01.

### IPV-WBGL-17 — Extensões compatíveis com API do editor base
- **QUANDO** o usuário instalar extensão ENTÃO o editor DEVE aceitar extensões compatíveis com a API do editor base, exibindo estado em views próprias; nenhuma pasta de extensões da marca do oráculo.
- **Teclado/A11y:** views por teclado.
- **Origem:** C# LOC-01; `apps/editor` (services/extension-host task_157).
- **Cobertura:** COBERTA (parcial) por LOC-01 (extension host isolado task_157; marketplace/próprio: pendente).
- **Identidade:** IPO-01.

### IPV-WBGL-18 — Sem marca no bundle: verificação de distribuição
- **QUANDO** gerar o distribuição ENTÃO build reproducible DEVE garantir que nenhum asset de marca do oráculo entre nos pacotes; verificação contínua da política de proveniência (script de inventário).
- **Teclado/A11y:** —.
- **Origem:** `docs/provenance-policy.md`; `scripts/inventory-cursor-artifacts.js` (verificação de hash/sem asset interno).
- **Cobertura:** COBERTA (policy) — teste do build: pendente no pacote.
- **Identidade:** IPO-01.
