/** Which Laya the app loads. Kept apart from runtime.ts so the page can read it without pulling in transformers.js. */
export const MODEL_ID = 'onnx-community/laya-multilingual-ONNX';
/**
 * The exact model commit this app was measured against (2026-09-29). Pinned so
 * an upload to the hub cannot change answers or break loading under readers;
 * moving it means a new download for everyone, so re-run the evals first.
 */
export const MODEL_REVISION = '46b77bbf5642fec5f14e540570228a8cbe8ab81f';
