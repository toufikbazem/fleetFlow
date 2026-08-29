/**
 * A media query, as React state — FF-1105.
 *
 * Used where a breakpoint has to change *what is rendered* rather than only how
 * it looks. CSS can hide a second copy of a list, but it cannot stop it
 * existing: the rows are still in the document, still found by `getByText`, and
 * still doubling the node count of a 25-row table on the device least able to
 * afford it. Where the two layouts are genuinely different components — the
 * data table's rows and cards — only one of them should be built.
 *
 * The initial value is read synchronously, so the first paint is already right
 * and nothing flashes the wrong layout.
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => setMatches(media.matches);
    // Re-read on subscribe: the viewport can change between the first render
    // and the effect, and the listener would never hear about that one.
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
