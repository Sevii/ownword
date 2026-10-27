// Serialize a snapshot for a model prompt. JSON keeps document text
// structurally separate from instructions (a block that says "ignore your
// instructions" is still just a string), and models cite block IDs and exact
// quotes from it. Bump the version if the format changes.

export const SERIALIZE_VERSION = 'blocks-json-1';

/**
 * @param {import('../analysis/types.js').Snapshot} snapshot
 * @param {{ editableBlockIds: Iterable<string>, contextBlockIds?: Iterable<string> }} scope
 */
export function serializeForPrompt(snapshot, scope) {
  const editable = new Set(scope.editableBlockIds);
  const context = new Set(scope.contextBlockIds ?? []);
  const blocks = snapshot.blocks
    .filter((b) => editable.has(b.id) || context.has(b.id))
    .map((b) => ({
      id: b.id,
      type: b.level ? `${b.type}${b.level}` : b.type,
      editable: editable.has(b.id),
      text: b.text,
    }));
  return JSON.stringify({ format: SERIALIZE_VERSION, blocks }, null, 1);
}

/**
 * The block list sent in an AI request body (contracts/schemas/ai-request.schema.json).
 * @param {import('../analysis/types.js').Snapshot} snapshot
 * @param {Iterable<string>} blockIds
 */
export function requestBlocks(snapshot, blockIds) {
  const ids = new Set(blockIds);
  return snapshot.blocks.filter((b) => ids.has(b.id)).map((b) => ({ id: b.id, type: b.type, text: b.text }));
}
