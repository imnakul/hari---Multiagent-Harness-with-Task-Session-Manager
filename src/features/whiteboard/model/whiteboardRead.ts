import { loadSheetScene, loadWhiteboardIndex } from "./sheetStore";
import {
  describeSheetForAgent,
  isWhiteboardServing,
  requestWhiteboardRead,
  sceneElementsFromJson,
  type WhiteboardReadInput,
  type WhiteboardReadResult,
} from "./whiteboardTool";

/**
 * Fork (L-403): `whiteboard.read` for the app CLI. The open Whiteboard answers
 * (it sees unsaved edits); while it is closed the saved files answer, so a read
 * never switches the user's view.
 */
export async function readWhiteboard(input: WhiteboardReadInput): Promise<WhiteboardReadResult> {
  if (isWhiteboardServing()) return requestWhiteboardRead(input);
  const index = await loadWhiteboardIndex();
  if (!input.sheetId) {
    return { sheets: index.sheets.map((sheet) => ({ sheetId: sheet.id, name: sheet.name, locked: !!sheet.locked })) };
  }
  const sheet = index.sheets.find((item) => item.id === input.sheetId);
  if (!sheet) throw new Error(`No Whiteboard sheet has id ${input.sheetId}.`);
  const elements = sceneElementsFromJson(await loadSheetScene(sheet));
  return { sheetId: sheet.id, name: sheet.name, locked: !!sheet.locked, elements: describeSheetForAgent(elements) };
}
