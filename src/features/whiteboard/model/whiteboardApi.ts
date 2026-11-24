/** The one part of Excalidraw's imperative API this needs. */
export type ChangeSource = { onChange: (listener: () => void) => () => void };

/**
 * Fork (L-392): Excalidraw hands its API over from its class constructor,
 * before the editor mounts. When React throws a render away (a Suspense
 * retry, an interrupted or pre-rendered pass), that editor never mounts, but
 * its API still arrives, and can arrive after the live editor's. Drawing on
 * it then changes an editor nobody sees: the chat said "Drew 24", the sheet
 * stayed empty and nothing was saved.
 *
 * Only a mounted editor reports changes, and it reports one as soon as its
 * scene has loaded, so an API is adopted on its first change and never before.
 * `stillWanted` lets the caller refuse an editor for a sheet it has left.
 */
export function adoptWhenMounted<A extends ChangeSource>(
  candidate: A,
  adopt: (api: A) => void,
  stillWanted: () => boolean = () => true,
): void {
  const stop = candidate.onChange(() => {
    stop();
    if (stillWanted()) adopt(candidate);
  });
}
