/** The heading of an upload row, or of its queued entry; focused after Upload (A11Y-13). */
export const rowTitleId = (key: string) => `upload-row-title-${key}`;

/** The title field of a draft; focused and selected after files are picked (A11Y-13). */
export const draftTitleId = (d: { id: string }) => `upload-title-${d.id}`;

/** A draft's row in the file list, which selects it; focused after a draft is removed. */
export const draftRowId = (d: { id: string }) => `upload-draft-${d.id}`;
