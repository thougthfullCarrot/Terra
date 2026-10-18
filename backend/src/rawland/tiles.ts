/** Viewport tiles: a fixed degree grid. Tiles carry outlines and display fields only; counts come from the index. */
export const TILE_DEG = 0.01;
export const tileKey = (lng: number, lat: number) => `${Math.floor(lng / TILE_DEG)}_${Math.floor(lat / TILE_DEG)}`;
export function tilesFor(bbox: { west: number; south: number; east: number; north: number }): string[] {
  const out: string[] = [];
  for (let x = Math.floor(bbox.west / TILE_DEG); x <= Math.floor(bbox.east / TILE_DEG); x++)
    for (let y = Math.floor(bbox.south / TILE_DEG); y <= Math.floor(bbox.north / TILE_DEG); y++) out.push(`${x}_${y}`);
  return out;
}
