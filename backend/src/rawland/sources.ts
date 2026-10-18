/** Raw Land's own geometry sources. Values come from #84's Bexar read, never from a second SARA value read. */
export interface GeometrySource { id: 'sara-polygons' | 'zoning' | 'city-parcels' | 'city-limits'; layer: string | null; fields: string; size: number; verified: boolean; note: string }

export const SOURCES: Record<GeometrySource['id'], GeometrySource> = {
  'sara-polygons': {
    id: 'sara-polygons', layer: 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0',
    fields: 'OBJECTID,Prop_id', size: 2000, verified: true,
    note: 'BCAD December 2025 open-records extract, SARA copy. Outlines only; repeated per-owner rows carry identical geometry.'
  },
  zoning: {
    id: 'zoning', layer: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12',
    fields: 'OBJECTID,Zoning,Base,SpecDistrict,SpecCondition,CaseNo,OrdinanceKey,ModifiedDate', size: 2000, verified: true,
    note: 'City of San Antonio zoning, read once; identical-geometry pairs with different attributes are kept as conflicts.'
  },
  'city-parcels': {
    id: 'city-parcels', layer: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer/0',
    fields: 'OBJECTID,PropID,legal_acre', size: 2000, verified: true,
    note: 'City of San Antonio weekly parcel layer, attributes only, for account matching. Never a geometry or account source.'
  },
  'city-limits': {
    // D9: the boundary source must be checked (publisher, date, every Bexar city present) before a build may use it.
    // Checked 2026-10-18 (probe run 39164852206): 32 polygons, every Bexar city plus Unincorporated and three bases;
    // 8 of 8 city points and the unincorporated point land in the right polygon. The service publishes no edit date.
    id: 'city-limits', layer: 'https://maps.bexar.org/arcgis/rest/services/LocalJurisdictions/MapServer/0', fields: 'OBJECTID,JURIS', size: 2000, verified: false,
    note: 'Bexar County "Cities" layer (JURIS field). Spot checks pass; no published edit date, so --limits-verified stays a manual call. Polygons named Unincorporated are not cities.'
  }
};
