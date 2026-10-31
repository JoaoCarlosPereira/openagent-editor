// Catálogo estrito dos 53 requisitos do PRD / TechSpec
// Fonte: PRD (rastreabilidade) + TechSpec (rastreabilidade de requisitos)
// Este arquivo é a fonte de verdade para parity:report e seus testes.

export interface Requirement {
  id: string;
  category: string;
  summary: string;
  criteria: string;
}

/** Todos os 53 requisitos mapeados do PRD para a Aceitação Única */
export const requirements: Requirement[] = [
  // --- LOC ---
  {
    id: "LOC-01",
    category: "LOC",
    summary: "Editor instalável multiplataforma",
    criteria: "Instalar em Linux, Windows ou macOS; abrir pasta; oferecer edição, terminal, Git, depuração e extensão compatível com a API do editor, com nome e ícone OpenAgent.",
  },
  // --- UI-01 a UI-04 ---
  {
    id: "UI-01",
    category: "UI",
    summary: "Painel e controles acessíveis",
    criteria: "Quanto a janela principal abrir, mostrar painel do agente, seletor de modo, seletor de modelo, contexto, histórico e revisão de alterações, todos alcançáveis por teclado.",
  },
  {
    id: "UI-02",
    category: "UI",
    summary: "Tema/largura preservam conversa",
    criteria: "Quando alternar tema claro e escuro ou a largura do painel, manter controles legíveis e preservar mensagens da conversa.",
  },
  {
    id: "UI-03",
    category: "UI",
    summary: "Onboarding e teste do provedor",
    criteria: "Ao abrir o editor pela primeira vez, conduzir configuração do provedor, executar teste de conexão e permitir abrir projeto sem conta da Anysphere.",
  },
  {
    id: "UI-04",
    category: "UI",
    summary: "Janela de agentes e retorno",
    criteria: "Quando abrir a janela de agentes, listar execuções locais em paralelo e oferecer comando de voltar ao editor no mesmo workspace.",
  },
  // --- AGT-01 a AGT-07 ---
  {
    id: "AGT-01",
    category: "AGT",
    summary: "Ask sem mutação",
    criteria: "Quanto escolher Ask, responder com leitura e busca, sem gravar arquivo nem executar comando.",
  },
  {
    id: "AGT-02",
    category: "AGT",
    summary: "Plan visível e executável",
    criteria: "Quando aceitar plano no modo Plan, iniciar execução com plano e progresso visíveis.",
  },
  {
    id: "AGT-03",
    category: "AGT",
    summary: "Agent edita/testa e mostra diff",
    criteria: "Ao executar tarefa no modo Agent, editar mais de um arquivo, rodar teste autorizado e mostrar diff agrupado e resultado de cada ferramenta.",
  },
  {
    id: "AGT-04",
    category: "AGT",
    summary: "Debug com hipótese/evidência",
    criteria: "Quando escolher Debug, registrar hipótese, evidência de execução e resultado da verificação antes de marcar tarefa como concluída.",
  },
  {
    id: "AGT-05",
    category: "AGT",
    summary: "Subagentes com estado próprio",
    criteria: "Quando dividir tarefa, mostrar cada subagente local com nome, estado e resultado próprios.",
  },
  {
    id: "AGT-06",
    category: "AGT",
    summary: "Fila editável durante execução",
    criteria: "Quando mensagem chegar durante execução, colocá-la na fila e permitir remover item que ainda não começou.",
  },
  {
    id: "AGT-07",
    category: "AGT",
    summary: "Cancelamento isolado de subagente",
    criteria: "Quando cancelar um subagente, interromper só esse subagente e conservar estado dos demais.",
  },
  // --- PRJ-01 ---
  {
    id: "PRJ-01",
    category: "PRJ",
    summary: "Coordenador local",
    criteria: "Quando criar projeto com objetivo, abrir coordenador local que divide em tarefas de agentes na mesma máquina e mostrar cada resultado para aceitar ou rejeitar.",
  },
  // --- PER-01 a PER-03 ---
  {
    id: "PER-01",
    category: "PER",
    summary: "Aceite explícito de ferramenta",
    criteria: "Quando ferramenta precisar permissão, mostrar ação, alvo e escopo; executar só depois de aceite explícito.",
  },
  {
    id: "PER-02",
    category: "PER",
    summary: "Cancelar em até 2 segundos",
    criteria: "Quando cancelar execução, marcar Cancelada em até 2 segundos, não iniciar nova ferramenta e conservar alteração aplicada.",
  },
  {
    id: "PER-03",
    category: "PER",
    summary: "Somente leitura bloqueia mutação",
    criteria: "Enquanto modo for Somente leitura, bloquear gravação de arquivo e comando que altere workspace; exibir 'Bloqueado pelo modo de execução.'",
  },
  // --- STA-01 ---
  {
    id: "STA-01",
    category: "STA",
    summary: "Estado terminal recusa ferramenta",
    criteria: "Quando execução estiver Concluída ou Cancelada, recusar nova ferramenta; aceitar só depois de mensagem nova.",
  },
  // --- VAL-01 ---
  {
    id: "VAL-01",
    category: "VAL",
    summary: "Mensagem vazia recusada",
    criteria: "Quando enviar mensagem sem texto e sem anexo, recusar envio e exibir 'Escreva uma mensagem ou anexe um contexto.'",
  },
  // --- CTX-01 a CTX-04 ---
  {
    id: "CTX-01",
    category: "CTX",
    summary: "Fontes, tokens e teto visíveis",
    criteria: "Ao anexar seleção, arquivo, pasta ou símbolo, listar cada fonte; mostrar contagem de tokens e teto antes do envio.",
  },
  {
    id: "CTX-02",
    category: "CTX",
    summary: "Índice incremental",
    criteria: "Ao salvar arquivo indexado, busca local deve passar a encontrar texto novo sem reconstrução do índice inteiro.",
  },
  {
    id: "CTX-03",
    category: "CTX",
    summary: "Exclusões em índice/contexto/busca",
    criteria: "Enquanto caminho estiver em regra de exclusão, omiti-lo da indexação, contexto automático e busca do agente.",
  },
  {
    id: "CTX-04",
    category: "CTX",
    summary: "Limpeza com escopo e tamanho",
    criteria: "Quando pedir limpeza do índice, mostrar escopo e tamanho; apagar dados locais daquele workspace.",
  },
  // --- PRV-01 a PRV-02 ---
  {
    id: "PRV-01",
    category: "PRV",
    summary: "Envio externo só explícito",
    criteria: "Enviar contexto a API externa só após ação explícita de envio; não enviar caminho excluído.",
  },
  {
    id: "PRV-02",
    category: "PRV",
    summary: "Log sem segredo/conteúdo bruto",
    criteria: "Registrar ação de ferramenta, omitir credencial, conteúdo de arquivo excluído e corpo bruto do modelo no log padrão.",
  },
  // --- TAB-01 a TAB-03 ---
  {
    id: "TAB-01",
    category: "TAB",
    summary: "Sugestão com aceitar/recusar",
    criteria: "Ao digitar com Tab ativo, oferecer continuação de linha ou bloco com aceitar, recusar e cancelar.",
  },
  {
    id: "TAB-02",
    category: "TAB",
    summary: "Próximo ponto e salto",
    criteria: "Ao aceitar sugestão com continuação, indicar próximo ponto e permitir salto por teclado.",
  },
  {
    id: "TAB-03",
    category: "TAB",
    summary: "Edição em outro arquivo revisada",
    criteria: "Quando sugestão alterar outro arquivo, mostrar caminho e aplicar só depois de revisão.",
  },
  // --- INL-01 a INL-02 ---
  {
    id: "INL-01",
    category: "INL",
    summary: "Inline Edit com diff/refino",
    criteria: "Quando pedir Inline Edit na seleção, mostrar diff no editor com aceitar, rejeitar e refinar.",
  },
  {
    id: "INL-02",
    category: "INL",
    summary: "Arquivo inteiro restaurável",
    criteria: "Ao pedir edição de arquivo inteiro, permitir rejeitar e restaurar conteúdo anterior ao pedido.",
  },
  // --- AUT-01 a AUT-02 ---
  {
    id: "AUT-01",
    category: "AUT",
    summary: "Browser autorizado com captura/console",
    criteria: "Quando autorizar navegador, abrir URL, executar interação autorizada, mostrar captura e texto de console.",
  },
  {
    id: "AUT-02",
    category: "AUT",
    summary: "Computer use uma ação por vez",
    criteria: "Ao autorizar uso do computador, executar ação por vez, nomeada na permissão, mostrar resultado.",
  },
  // --- DES-01 ---
  {
    id: "DES-01",
    category: "DES",
    summary: "Elemento e código anexados",
    criteria: "Quando selecionar elemento no navegador em modo desenho, anexar identificação do elemento e trecho de código à mensagem seguinte.",
  },
  // --- CAN-01 ---
  {
    id: "CAN-01",
    category: "CAN",
    summary: "Canvas persistente no painel",
    criteria: "Quando agente abrir canvas, exibir conteúdo no painel e mantê-lo visível após fim da resposta.",
  },
  // --- CUS-01 a CUS-03 ---
  {
    id: "CUS-01",
    category: "CUS",
    summary: "Regras de usuário/projeto",
    criteria: "Ao iniciar sessão, carregar regras de usuário e de projeto aplicáveis, mostrar origem de cada uma.",
  },
  {
    id: "CUS-02",
    category: "CUS",
    summary: "Comando/skill/plugin com origem",
    criteria: "Ao invocar comando, skill ou plugin local, aplicar instrução declarada e mostrar origem.",
  },
  {
    id: "CUS-03",
    category: "CUS",
    summary: "Hook pode negar ação",
    criteria: "Quando hook local negar ação, impedir ação e mostrar justificativa do hook.",
  },
  // --- MCP-01 ---
  {
    id: "MCP-01",
    category: "MCP",
    summary: "MCP stdio/HTTP com permissão",
    criteria: "Ao configurar servidor MCP por stdio/HTTP, listar ferramentas, executar escolhida só com permissão, mostrar resultado ou erro.",
  },
  // --- CLI-01 a CLI-02 ---
  {
    id: "CLI-01",
    category: "CLI",
    summary: "CLI reutiliza configuração",
    criteria: "Quando iniciar CLI num workspace, reutilizar provedor, modo, regras, MCP e sessões daquele workspace.",
  },
  {
    id: "CLI-02",
    category: "CLI",
    summary: "Sessão headless abre no editor",
    criteria: "Quando execução headless da CLI terminar, mostrar essa sessão ao abrir mesmo workspace no editor.",
  },
  // --- SES-01 a SES-07 ---
  {
    id: "SES-01",
    category: "SES",
    summary: "Retomar sessão completa",
    criteria: "Ao reiniciar editor, reabrir sessões do workspace com modo, mensagens, ferramentas e anexos existentes.",
  },
  {
    id: "SES-02",
    category: "SES",
    summary: "Exportar sessão em texto",
    criteria: "Ao exportar sessão, gravar arquivo de texto com mensagens daquela sessão.",
  },
  {
    id: "SES-03",
    category: "SES",
    summary: "Checkpoint sem sobrescrita",
    criteria: "Ao restaurar checkpoint, reverter só arquivos marcados daquela execução; mostrar conflito e não gravar por cima.",
  },
  {
    id: "SES-04",
    category: "SES",
    summary: "Isolamento por worktree",
    criteria: "Quando criar trabalho isolado, usar worktree local e manter arquivos do workspace original intactos até aplicação escolhida.",
  },
  {
    id: "SES-05",
    category: "SES",
    summary: "Buscar conversa local",
    criteria: "Ao buscar texto na conversa, listar mensagens da sessão local que contêm texto.",
  },
  {
    id: "SES-06",
    category: "SES",
    summary: "Conversa lateral preserva principal",
    criteria: "Ao abrir conversa lateral, conservar mensagens da conversa principal.",
  },
  {
    id: "SES-07",
    category: "SES",
    summary: "Apagar mensagens locais",
    criteria: "Ao apagar sessão, remover mensagens locais daquela sessão.",
  },
  // --- API-01 a API-03 ---
  {
    id: "API-01",
    category: "API",
    summary: "Teste/capabilities/cofre",
    criteria: "Ao informar endpoint, modelo e credencial, testar conexão, mostrar capacidades detectadas, guardar credencial no cofre do sistema.",
  },
  {
    id: "API-02",
    category: "API",
    summary: "Falha preserva prompt e diff",
    criteria: "Se provedor expira/recusa taxa/ausenta capacidade, exibir causa, conservar texto digitado, não apagar diff já produzido.",
  },
  {
    id: "API-03",
    category: "API",
    summary: "Teto padrão 200000 tokens",
    criteria: "Ao enviar mensagem, exibir teto de contexto em tokens; usar 200000 quando não gravado outro valor.",
  },
  // --- ERR-01 a ERR-04 ---
  {
    id: "ERR-01",
    category: "ERR",
    summary: "Conflito mostra duas versões",
    criteria: "Quando arquivo mudar entre geração e aplicação, impedir aplicação direta, mostrar duas versões.",
  },
  {
    id: "ERR-02",
    category: "ERR",
    summary: "Caminho fora do escopo negado",
    criteria: "Se ferramenta pedir caminho fora do workspace aprovado, negar operação, registrar 'Caminho fora do escopo.'",
  },
  {
    id: "ERR-03",
    category: "ERR",
    summary: "Streaming incompleto e retry",
    criteria: "Se conexão cair durante streaming, marcar resposta como Incompleta, permitir tentar de novo sem alterar gravação existente.",
  },
  {
    id: "ERR-04",
    category: "ERR",
    summary: "Remover trecho recém-excluído",
    criteria: "Se índice tiver trecho de arquivo que passou a excluído, remover antes da próxima busca.",
  },
];

/** Lista plana dos 53 IDs, em ordem de aparição na TechSpec */
export const requirementIds: string[] = requirements.map((r) => r.id);
