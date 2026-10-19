/**
 * Input limits shared by the page (`client.ts`) and the offline bake (`scripts/bake`): plain
 * constants, no browser API, so Node can import them.
 */

/** Largest GPX Vert reads, bytes (matches the Dropzone's limit). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
