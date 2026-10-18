/**
 * The appraisal districts for TERRA's configured markets: each market city's
 * own county (metros.ts lists the wider metro counties; those are left to the
 * statewide parcel map fallback the Property tab already has).
 *
 * `access` is how the collector reads a district:
 *   arcgis   a public ArcGIS layer that answers queries (official or a public
 *            agency's copy of the official roll); read in object-id chunks.
 *   bulk     an official downloadable export file.
 *   none     nothing automated is permitted or available; the official search
 *            is linked for people instead.
 * `status` is what the pilot established; docs/appraisal-lookup.md has the
 * full coverage matrix.
 */

export interface FieldMap {
  /** Candidate source field names per normalized field, first present wins (case-insensitive). */
  account: string[];
  situs: string[];
  situsCity?: string[];
  situsZip?: string[];
  owner: string[];
  /** Mailing address lines, joined in order. */
  mailing: string[];
  landValue?: string[];
  improvementValue?: string[];
  totalValue?: string[];
  taxYear?: string[];
  stateCode?: string[];
  landSqft?: string[];
  landAcres?: string[];
  buildingSqft?: string[];
  yearBuilt?: string[];
}

export interface District {
  id: string;
  name: string;
  county: string;
  /** Three-digit county FIPS. */
  fips: string;
  markets: string[];
  site: string;
  search: string;
  /** Account page link, with {account} for the id. */
  accountUrl?: string;
  /** Official downloads page or files, when the district publishes them. */
  downloads?: string[];
  api?: string;
  access: 'arcgis' | 'bulk' | 'none';
  /** For arcgis: the layer URL; who publishes it. */
  layer?: string;
  publisher?: string;
  fields?: FieldMap;
  valueBasis?: 'appraised' | 'market';
  /** Seconds to wait between requests to this host. */
  pauseMs?: number;
  /** Restrictions or terms found, quoted or summarized. */
  terms: string;
  notes?: string;
}

const COMMON: Pick<FieldMap, 'situsCity' | 'situsZip' | 'taxYear'> = {
  situsCity: ['SITUS_CITY', 'SitusCity', 'site_addr_2', 'CITYNAME', 'situs_city'],
  situsZip: ['SITUS_ZIP', 'SitusZip', 'site_addr_3', 'situs_zip', 'ZIP_CODE'],
  taxYear: ['TAX_YEAR', 'TaxYear', 'Roll_Year', 'YEAR', 'APPR_YR', 'py_year', 'prop_val_yr']
};

export const DISTRICTS: District[] = [
  {
    id: 'bexar',
    name: 'Bexar Appraisal District',
    county: 'Bexar',
    fips: '029',
    markets: ['San Antonio'],
    site: 'https://www.bcad.org/',
    search: 'https://bexar.trueautomation.com/clientdb/?cid=110',
    accountUrl: 'https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id={account}',
    access: 'arcgis',
    layer: 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0',
    publisher: 'Bexar County (maps.bexar.org), from BCAD certified roll',
    fields: {
      ...COMMON,
      account: ['PropID', 'Prop_id'],
      situs: ['Situs'],
      owner: ['Owner', 'Owner_name'],
      mailing: ['AddrLn1', 'AddrLn2', 'AddrLn3', 'AddrCity', 'AddrSt', 'Zip'],
      landValue: ['LandVal'],
      improvementValue: ['ImprVal'],
      totalValue: ['TotVal', 'Market_val'],
      taxYear: ['Roll', ...COMMON.taxYear!],
      stateCode: ['State_cd'],
      landAcres: ['Acres', 'LglAcres', 'Land_acres'],
      buildingSqft: ['TOT_GBA', 'GBA', 'Sq_ft'],
      yearBuilt: ['YrBlt', 'Yr_blt']
    },
    valueBasis: 'market',
    pauseMs: 500,
    terms: 'BCAD does not offer a public bulk export; its downloads page requires a paid request. Bexar County publishes the parcel layer openly (1,000 rows per request).',
    notes: 'The SARA copy the site used before (gis.sara-tx.org BCAD_Parcels_PROD) is kept as a fallback in the browser.'
  },
  {
    id: 'harris',
    name: 'Harris Central Appraisal District',
    county: 'Harris',
    fips: '201',
    markets: ['Houston'],
    site: 'https://hcad.org/',
    search: 'https://hcad.org/property-search/',
    downloads: ['https://hcad.org/pdata/pdata-property-downloads.html'],
    access: 'bulk',
    publisher: 'HCAD public data downloads (Real_acct_owner.zip, real_acct.txt)',
    fields: {
      ...COMMON,
      account: ['acct'],
      situs: ['site_addr_1'],
      situsCity: ['site_addr_2'],
      situsZip: ['site_addr_3'],
      owner: ['mailto'],
      mailing: ['mail_addr_1', 'mail_addr_2', 'mail_city', 'mail_state', 'mail_zip'],
      landValue: ['land_val'],
      improvementValue: ['bld_val'],
      totalValue: ['tot_appr_val'],
      taxYear: ['yr'],
      stateCode: ['state_class'],
      landSqft: ['land_ar'],
      buildingSqft: ['bld_ar'],
      yearBuilt: ['yr_impr']
    },
    valueBasis: 'appraised',
    terms: 'HCAD publishes free bulk files; the existing weekly appraisal.yml already downloads real_acct.txt.',
    notes: 'The City of Houston Cadastral layer (used by the site today) covers the city only; the bulk file covers the county.'
  },
  {
    id: 'dallas',
    name: 'Dallas Central Appraisal District',
    county: 'Dallas',
    fips: '113',
    markets: ['Dallas'],
    site: 'https://www.dallascad.org/',
    search: 'https://www.dallascad.org/SearchAddr.aspx',
    accountUrl: 'https://www.dallascad.org/AcctDetailCom.aspx?ID={account}',
    downloads: ['https://www.dallascad.org/DataProducts.aspx'],
    access: 'arcgis',
    layer: 'https://services.arcgis.com/6dxqrE38upDMg1va/arcgis/rest/services/Dallas_Co_Parcels/FeatureServer/0',
    publisher: 'Public ArcGIS copy of the DCAD roll (already used by the site)',
    fields: {
      ...COMMON,
      account: ['Prop_ID', 'ACCOUNT_NUM'],
      situs: ['SITUS_ADDR'],
      owner: ['OWNER_NAME'],
      mailing: ['MAIL_LINE1', 'MAIL_LINE2', 'MAIL_CITY', 'MAIL_STAT', 'MAIL_ZIP'],
      landValue: ['LAND_VALUE', 'LAND_VAL'],
      improvementValue: ['IMPR_VALUE', 'IMP_VAL', 'IMPR_VAL'],
      totalValue: ['MKT_VALUE'],
      stateCode: ['STAT_LAND_'],
      landAcres: ['LEGAL_AREA'],
      yearBuilt: ['YEAR_BUILT']
    },
    valueBasis: 'market',
    pauseMs: 300,
    terms: 'DCAD offers free certified CSV data products (already read by appraisal.yml); its GIS shapefiles are free downloads too.'
  },
  {
    id: 'tarrant',
    name: 'Tarrant Appraisal District',
    county: 'Tarrant',
    fips: '439',
    markets: ['Fort Worth'],
    site: 'https://www.tad.org/',
    search: 'https://www.tad.org/property-search/',
    accountUrl: 'https://www.tad.org/property?account={account}',
    downloads: ['https://www.tad.org/resources/data-downloads'],
    access: 'arcgis',
    layer: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0',
    publisher: 'City of Fort Worth parcel view of the TAD roll (already used by the site)',
    fields: {
      ...COMMON,
      account: ['ACCOUNT', 'Account_Num'],
      situs: ['SITUS_ADDR'],
      situsCity: ['CITYNAME'],
      owner: ['OWNER_NAME'],
      mailing: ['OWNER_ADDRESS', 'OWNER_CITY_ST', 'OWNER_ZIP_CODE'],
      landValue: ['LAND_VALUE'],
      improvementValue: ['IMPROVEMENT_VALUE', 'IMPR_VALUE'],
      totalValue: ['APPRAISED_VALUE', 'MARKET_VALUE'],
      stateCode: ['STATE_USE_CODE'],
      landSqft: ['LAND_SQFT'],
      buildingSqft: ['LIVING_AREA'],
      yearBuilt: ['YR_BUILT']
    },
    valueBasis: 'appraised',
    pauseMs: 300,
    terms: 'TAD publishes free PropertyData downloads (already read by appraisal.yml).'
  },
  {
    id: 'travis',
    name: 'Travis Central Appraisal District',
    county: 'Travis',
    fips: '453',
    markets: ['Austin'],
    site: 'https://traviscad.org/',
    search: 'https://travis.prodigycad.com/property-search',
    accountUrl: 'https://travis.prodigycad.com/property-detail/{account}',
    downloads: ['https://traviscad.org/publicinformation'],
    access: 'arcgis',
    layer: 'https://services1.arcgis.com/HGcSYZ5bvjRswoCb/arcgis/rest/services/TCAD_Parcels_Dec_2025/FeatureServer/0',
    publisher: 'Public ArcGIS copy of the TCAD roll (already used by the site)',
    fields: {
      ...COMMON,
      account: ['PROP_ID'],
      situs: ['situs_address'],
      owner: ['py_owner_name'],
      mailing: ['py_address'],
      landValue: ['land_value', 'land_val'],
      improvementValue: ['imprv_value', 'improvement_value'],
      totalValue: ['appraised_val', 'market_value'],
      stateCode: ['land_state_cd'],
      landAcres: ['GIS_acres', 'tcad_acres'],
      yearBuilt: ['F1year_imprv']
    },
    valueBasis: 'market',
    pauseMs: 300,
    terms: 'TCAD publishes free PACS export files (already read by appraisal.yml).'
  },
  {
    id: 'el-paso',
    name: 'El Paso Central Appraisal District',
    county: 'El Paso',
    fips: '141',
    markets: ['El Paso'],
    site: 'https://epcad.org/',
    search: 'https://epcad.org/Search',
    downloads: ['https://epcad.org/OpenGovernment', 'https://export.epcad.org/datasets/REAL_ESTATE.zip', 'https://blob.epcad.org/gis/parcels2025.zip'],
    api: 'https://go.epcad.org/ApiPropertySearch',
    access: 'bulk',
    publisher: 'EPCAD Open Government downloads (Property Search flat files, ~ delimited)',
    valueBasis: 'appraised',
    terms: 'EPCAD lists its export files "for development use only" and links an Acceptable Use Policy; the documented REST API exists. Read the policy before publishing EPCAD data on the live site.'
  },
  {
    id: 'comal',
    name: 'Comal Appraisal District',
    county: 'Comal',
    fips: '091',
    markets: ['New Braunfels'],
    site: 'https://www.comalad.org/',
    search: 'https://esearch.comalad.org/',
    access: 'none',
    terms: 'No public bulk export or API found. The only open parcel layer (TNRIS copy, services6.arcgis.com Comal_County_Parcels) dates from January 2021 and is too old to use.'
  },
  {
    id: 'brazos',
    name: 'Brazos Central Appraisal District',
    county: 'Brazos',
    fips: '041',
    markets: ['College Station'],
    site: 'https://brazoscad.org/',
    search: 'https://esearch.brazoscad.org/',
    access: 'none',
    terms: 'No public bulk export or API found from the district.'
  },
  {
    id: 'galveston',
    name: 'Galveston Central Appraisal District',
    county: 'Galveston',
    fips: '167',
    markets: ['Galveston'],
    site: 'https://galvestoncad.org/',
    search: 'https://propaccess.trueautomation.com/clientdb/?cid=81',
    access: 'none',
    terms: 'No public bulk export or API found; the search is a TrueAutomation site.'
  },
  {
    id: 'lubbock',
    name: 'Lubbock Central Appraisal District',
    county: 'Lubbock',
    fips: '303',
    markets: ['Lubbock'],
    site: 'https://www.lubbockcad.org/',
    search: 'https://lubbockcad.org/property-search/',
    access: 'none',
    terms: 'No public bulk export or API found from the district.'
  },
  {
    id: 'midland',
    name: 'Midland Central Appraisal District',
    county: 'Midland',
    fips: '329',
    markets: ['Midland'],
    site: 'https://www.midcad.org/',
    search: 'https://iswdataclient.azurewebsites.net/webSearchProperty.aspx?dbkey=midlandcad',
    access: 'none',
    terms: 'No public bulk export or API found from the district.'
  }
];

export function district(id: string): District {
  const found = DISTRICTS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown district ${id}`);
  return found;
}
