import type { RawPerson } from './mlb.ts';

export interface Person {
  id: number;
  name: string;
  heightIn: number | null;
  bats: string | null;
  throws: string | null;
  position: string | null;
}

// Roster heights come as text such as 6' 1".
export function parseHeightIn(height: string | undefined): number | null {
  const m = /^\s*(\d+)\s*'\s*(\d+)?/.exec(height ?? '');

  return m ? Number(m[1]) * 12 + Number(m[2] ?? 0) : null;
}

export function toPerson(p: RawPerson): Person {
  return {
    id: p.id,
    name: p.fullName ?? `#${p.id}`,
    heightIn: parseHeightIn(p.height),
    bats: p.batSide?.code ?? null,
    throws: p.pitchHand?.code ?? null,
    position: p.primaryPosition?.abbreviation ?? null,
  };
}
