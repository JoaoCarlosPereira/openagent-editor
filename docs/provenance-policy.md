# Política de proveniência do código extraído

Esta política vale para todo módulo do OpenAgent Editor que usa artefatos do Cursor 3.24.18 como origem ou evidência. Ela aplica o ADR-002 (programa próprio guiado pelos artefatos extraídos) e a seção "Proveniência do Código Extraído" da TechSpec.

Cada módulo nessa situação tem um arquivo `provenance.json` na sua raiz, no formato de [`schemas/provenance.schema.json`](../schemas/provenance.schema.json) (JSON Schema draft 2020-12). Há exemplos em [`schemas/examples/`](../schemas/examples/).

## Cobertura e limites do gate

O ADR-002 exige rastreabilidade por módulo; o schema de artefatos Cursor se aplica aos módulos reconstruídos que usam tais artefatos como origem ou evidência, conforme a TechSpec. A lista `requiredManifests` em `scripts/check-provenance-gate.mjs` registra os módulos identificados por suas próprias declarações de reconstrução: `packages/extension-api` e `services/extension-host`. Novas evidências de uso exigem atualizar essa lista. Ela não é um inventário completo nem demonstra que outros módulos não usem artefatos Cursor; essa conclusão exige auditoria independente.

O gate descobre `provenance.json` e `*.provenance.json` e valida todos os arquivos encontrados, inclusive os não listados. A ausência ou invalidade de um manifesto declarado bloqueia o gate. Um manifesto válido não prova que seus hashes ou alegações correspondem aos artefatos: fontes indisponíveis e divergências devem ser investigadas separadamente, sem inventar dados. Os arquivos de exemplo são ignorados por padrão.

Com `--root`, a CLI verifica apenas os manifestos obrigatórios situados nessa raiz; a aprovação parcial não substitui o gate executado na raiz padrão do repositório.

## Módulo sem artefatos Cursor

Módulo que não usa artefatos do Cursor como origem ou evidência não exige `provenance.json`: a rastreabilidade geral (ADR-002) fica coberta pela origem atribuível no repositório — TechSpec, ADRs e histórico Git do módulo. O manifesto legado de `services/harness-daemon` foi removido em 30/10/2026: ele alegava `behavioral-reimplementation` via `techspec-and-adr-003`, sem artefato, hash ou localização alguma — impossível de validar sob o schema atual e insuficiente para declarar origem em artefatos. Se surgir evidência de que parte do módulo usa artefatos do Cursor, um manifesto novo deve registrá-la com hash e localização reais, e o módulo entra na lista `requiredManifests`. Um manifesto inválido no formato legado que reapareça no disco continua travando o gate, por descoberta.

## Estratégias

Todo `provenance.json` declara exatamente uma estratégia no campo `strategy`.

### `behavioral-reimplementation`

É a estratégia padrão e o fallback obrigatório. O artefato serve só como especificação: contratos, máquinas de estado, protocolos, formatos e dependências. O código do módulo é escrito pelo projeto, sem copiar trechos, pseudocódigo, recursos ou estrutura literal do artefato.

Aplica-se quando:

- não existe documento de autorização registrado que cubra o artefato; ou
- o documento existe, mas não cobre aquele artefato ou aquele uso; ou
- o módulo foi escrito a partir de comportamento observado (runtime, teste diferencial, documentação pública).

O código resultante é distribuído sob a licença do repositório, MIT. Neste modo, `authorization` é opcional e não tem efeito.

### `direct-authorized`

Permite incorporar implementação extraída do Cursor 3.24.18 ao módulo. Aplica-se somente quando existe um documento de autorização ou licença registrado no repositório que cubra aquele artefato e aquele uso.

Regras:

- O campo `authorization` é obrigatório. Sem ele, o registro não atende ao contrato e a validação automatizada futura deve rejeitar o módulo.
- `authorization.documentRef` aponta, por caminho relativo à raiz do repositório, para o documento de autorização.
- `authorization.documentSha256` é o SHA-256 esperado do documento.
- `authorization.scope` descreve o que o documento autoriza, nos termos dele. O uso no módulo não pode ir além desse escopo.
- `license.spdx` identifica a licença ou os termos aplicáveis ao código incorporado (por exemplo, `LicenseRef-*`). A licença MIT do repositório não comprova, por si só, a autorização.

A declaração verbal de que existe autorização não basta. Enquanto o documento não estiver registrado, todo módulo usa `behavioral-reimplementation`.

A validação da referência, da existência do documento e da correspondência do hash será ativada pelos cards task_04/task_05. Até que esses cards implementem o validador e o gate, esta política descreve o contrato pretendido, não uma garantia aplicada pelo build atual.

## Campos obrigatórios

| Campo | Conteúdo |
|---|---|
| `schemaVersion` | Versão do formato. Hoje, `1`. |
| `module` | Caminho do módulo no repositório, relativo à raiz, com `/`. |
| `strategy` | `direct-authorized` ou `behavioral-reimplementation`. |
| `sources[]` | Um ou mais artefatos de origem. |
| `sources[].artifactSha256` | Hash SHA-256 do artefato (hex minúsculo). |
| `sources[].artifactPath` | Caminho do artefato na instalação do Cursor ou no export local. |
| `sources[].cursorVersion` | Sempre `3.24.18`, a versão congelada (ADR-007). |
| `sources[].origin` | Bundle (`bundle`) e/ou endereço (`address`, hexadecimal `0x...`) de origem; `symbol` é opcional. |
| `sources[].recoveryMethod` | `js-bundle-recovery`, `ghidra-pseudocode`, `runtime-observation`, `differential-test` ou `public-documentation`. |
| `license.spdx` | Licença aplicável ao código do módulo. |
| `authorization` | Obrigatório em `direct-authorized`: `documentRef`, `documentSha256` e `scope`. |
| `containsCursorBrandAssets` | Sempre `false`. |

`notes` é opcional e não pode conter trechos de código proprietário.

## Marca, ícones e textos

Marca, logotipos, ícones, nomes comerciais e textos de interface do Cursor ficam proibidos no produto, em qualquer estratégia, inclusive em `direct-authorized`. O produto usa nome, ícones e textos próprios do OpenAgent. O campo `containsCursorBrandAssets` só aceita `false`, e qualquer conteúdo desse tipo é removido antes do commit.

## Aplicação planejada

- O card task_04 implementará a validação estrutural do `provenance.json` contra o schema.
- O card task_05 integrará ao build a checagem de documento de autorização referenciado, existente e com hash conferido.
- Código, marca, ícones e textos não cobertos por esta política não entram no pacote MIT.
