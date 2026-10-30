# Coordenação de habilitação e subprocessos

A preferência de habilitação é compartilhada pelo diretório de extensões e pelo
identificador canônico; o padrão é habilitada. Habilitar não ativa a extensão.
Hosts que usam o mesmo diretório só podem executar uma instância de cada
extensão por vez. A tentativa de desabilitar enquanto outro host detém o
worker retorna `CONFLICT`: não encerra o worker remoto e não altera a
preferência. A desativação normal conserva o worker para reativação, portanto
o conflito de desabilitação persiste até o host proprietário desabilitar a
extensão ou encerrar o worker. Um outro host PODE ativar a extensão quando ela
está desativada no host proprietário: nesse caso ele assume a propriedade do
lock. Sempre que a extensão está em execução no holder, o lock do arquivo de
lock fica marcado como ativa e não é assumido.

Cada extensão usa um arquivo de lock próprio (`.disabled-<hash>.lock`) com o
descritor do holder (pid, token do host, generation e estado da extensão),
criado com exclusão atômica (`O_EXCL`). Um lock de host morto (crash ou
SIGKILL) vira stale: a próxima tentativa confere o pid e remove o arquivo
antes de criar o próprio. A recuperação não é atômica — há uma janela entre a
morte do holder e a remoção do lock. O bloqueio cobre ativação, execução,
encerramento do worker e gravação da preferência; extensões diferentes não se
bloqueiam. Não remova ou substitua esses arquivos enquanto houver hosts
ativos. O lock vale para hosts no mesmo computador (o pid é local); o escopo
não cobre diretórios em rede nem cópias independentes do diretório.

## Subprocessos de extensão

O worker rastreia processos filhos criados pela extensão via
`child_process` (CommonJS `require`; namespaces ESM congelados não são
rastreados) e registra os pids em um processo reaper próprio do host. Ao
desabilitar ou ao terminar o worker, os pids daquela extensão recebem
`SIGKILL`. Quando o host morre sem limpeza (inclusive SIGKILL), o reaper
detecta oEOF do stdin e mata os pids rastreados. Não há atomicidade: pids
registrados antes do fim inesperado são mortos; um processo criado nos
últimos instantes antes da morte pode não estar registrado. Filhos que
sozinhos criam descendentes com vida própria não são alcançados — o reaper
mata o pid registrado direto da extensão.

Uma desativação malsucedida não grava a preferência. Se a gravação falhar após
encerrar o worker, a operação falha e pode ser necessária ativação explícita.
Um crash libera o lock pelo check de pid do próximo host, que lê a preferência
persistida e não reativa automaticamente a extensão.
Essa coordenação não cancela operações de editor já despachadas.
