import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

const ViewActive = createContext(true);
export const useViewActive = () => useContext(ViewActive);

// Mount on the first visit, then retain the same tree for this app session.
// Background work can finish while hidden; global input uses ViewActive.
export function RetainedView({ active, children }: { active: boolean; children: ReactNode }) {
  const parentActive = useViewActive();
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!visited && !active) return null;
  return <ViewActive.Provider value={parentActive && active}>{children}</ViewActive.Provider>;
}
