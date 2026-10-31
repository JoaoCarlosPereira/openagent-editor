/** Limite de tamanho para leitura de arquivo (paridade com extension/agent.js). */
export const MAX_READ_FILE_BYTES = 1024 * 1024;

/** Máximo de caracteres retornados na leitura. */
export const MAX_READ_FILE_CHARS = 20_000;

/** Limite por arquivo durante busca. */
export const MAX_SEARCH_FILE_BYTES = 512 * 1024;

/** Máximo de arquivos visitados na busca. */
export const MAX_SEARCH_FILES_SCANNED = 500;

/** Máximo de ocorrências retornadas. */
export const MAX_SEARCH_HITS = 30;

/** Tamanho máximo da consulta de busca. */
export const MAX_SEARCH_QUERY_LENGTH = 100;

/** Diretórios ignorados na busca (padrão glob do protótipo). */
export const SEARCH_SKIP_DIR_NAMES = new Set([".git", "node_modules", "dist", "build"]);
