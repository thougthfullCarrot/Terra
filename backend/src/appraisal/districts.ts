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

/** Field names pacsRow() gives a PACS 8.0 export line. */
const PACS_FIELDS: FieldMap = {
  account: ['prop_id'],
  situs: ['situs'],
  situsCity: ['situs_city'],
  situsZip: ['situs_zip'],
  owner: ['py_owner_name'],
  mailing: ['py_addr_line1', 'py_addr_line2', 'py_addr_line3', 'py_addr_city', 'py_addr_state', 'py_addr_zip'],
  landValue: ['land_val'],
  improvementValue: ['imprv_val'],
  totalValue: ['appraised_val'],
  taxYear: ['prop_val_yr'],
  stateCode: ['state_cd'],
  landSqft: ['land_sqft']
};

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
    // Bexar County's own layer (maps.bexar.org Parcels) says "from BCAD FTP as of September 2019", so the
    // San Antonio River Authority copy the site already uses is read instead; its age is logged each run.
    layer: 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0',
    publisher: 'San Antonio River Authority copy of the BCAD roll (gis.sara-tx.org)',
    fields: {
      ...COMMON,
      account: ['Prop_id', 'PropID'],
      situs: ['Situs'],
      owner: ['Owner_name', 'Owner'],
      mailing: ['Addr_line1', 'Addr_line2', 'Addr_line3', 'Addr_city', 'Addr_state', 'Zip'],
      landValue: ['Land_hstd_val+Land_non_hstd_val'],
      improvementValue: ['Imprv_hstd_val+Imprv_non_hstd_val'],
      totalValue: ['Market_val'],
      taxYear: ['Prop_yr'],
      stateCode: ['State_cd'],
      landAcres: ['Land_acres', 'Acres'],
      buildingSqft: ['Sq_ft', 'TOT_GBA'],
      yearBuilt: ['Yr_blt', 'YrBlt']
    },
    valueBasis: 'market',
    pauseMs: 500,
    terms: 'BCAD offers no public bulk export or API (its site sits behind a bot check). Public agencies republish its roll as open ArcGIS layers; Bexar County\'s (maps.bexar.org) is the 2019 roll, so SARA\'s is used.',
    notes: 'Verify checks sample accounts against BCAD\'s own property page (bexar.trueautomation.com) when its robots.txt allows.'
  },
  {
    id: 'harris',
    name: 'Harris Central Appraisal District',
    county: 'Harris',
    fips: '201',
    markets: ['Houston'],
    site: 'https://hcad.org/',
    search: 'https://hcad.org/hcad-online-services/property-tax-database',
    downloads: ['https://hcad.org/pdata/pdata-property-downloads.html'],
    access: 'bulk',
    publisher: 'HCAD public data downloads (Real_acct_owner.zip: real_acct.txt + owners.txt)',
    fields: {
      ...COMMON,
      account: ['acct'],
      situs: ['site_addr_1'],
      situsCity: ['site_addr_2'],
      situsZip: ['site_addr_3'],
      owner: ['owner_name', 'mailto'],
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
    notes: 'The City of Houston Cadastral layer (used by the site today) covers the city only; the bulk file covers the county. The file has no coordinates (HCAD publishes parcel shapes separately).'
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
    access: 'bulk',
    publisher: 'DCAD certified data product (DCADyyyy_CERTIFIED zip: ACCOUNT_INFO + ACCOUNT_APPRL_YEAR)',
    fields: {
      account: ['ACCOUNT_NUM'],
      situs: ['SITUS'],
      situsCity: ['PROPERTY_CITY'],
      situsZip: ['PROPERTY_ZIPCODE'],
      owner: ['OWNER_NAME1'],
      mailing: ['OWNER_ADDRESS_LINE1', 'OWNER_ADDRESS_LINE2', 'OWNER_ADDRESS_LINE3', 'OWNER_ADDRESS_LINE4', 'OWNER_CITY', 'OWNER_STATE', 'OWNER_ZIPCODE'],
      landValue: ['LAND_VAL'],
      improvementValue: ['IMPR_VAL'],
      totalValue: ['TOT_VAL'],
      taxYear: ['APPRAISAL_YR'],
      stateCode: ['SPTD_CODE']
    },
    valueBasis: 'market',
    terms: 'DCAD offers free certified CSV data products (already read by appraisal.yml); its GIS shapefiles are free downloads too.',
    notes: 'The public ArcGIS copy the site queries (services.arcgis.com Dallas_Co_Parcels) still carries the 2025 roll, so the certified file is used here. No coordinates in the file.'
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
    access: 'bulk',
    publisher: 'TAD PropertyData (Delimited) download',
    fields: {
      account: ['Account_Num'],
      situs: ['Situs_Address'],
      situsCity: ['Property_City', 'City_Name'],
      situsZip: ['Situs_Zip', 'Property_Zip'],
      owner: ['Owner_Name'],
      mailing: ['Owner_Address', 'Owner_CityState', 'Owner_Zip'],
      landValue: ['Land_Value'],
      improvementValue: ['Improvement_Value'],
      totalValue: ['Appraised_Value', 'Total_Value'],
      taxYear: ['Appraisal_Year'],
      stateCode: ['State_Use_Code'],
      landSqft: ['Land_SqFt'],
      landAcres: ['Land_Acres'],
      buildingSqft: ['Living_Area'],
      yearBuilt: ['Year_Built']
    },
    valueBasis: 'appraised',
    terms: 'TAD publishes free PropertyData downloads (already read by appraisal.yml).',
    notes: 'The Fort Worth parcel view the site queries carries the 2024 roll and no shapes, so the TAD file is used here. No coordinates in the file.'
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
    access: 'bulk',
    publisher: 'TCAD certified appraisal export (PACS 8.0 fixed-width PROP.TXT + LAND_DET.TXT)',
    fields: PACS_FIELDS,
    valueBasis: 'appraised',
    terms: 'TCAD publishes free PACS export files (already read by appraisal.yml).',
    notes: 'The public ArcGIS copy the site queries (TCAD_Parcels_Dec_2025) has coordinates but no land or improvement split; the export is used here. Year built and building area are in IMP_DET, not read yet.'
  },
  {
    id: 'el-paso',
    name: 'El Paso Central Appraisal District',
    county: 'El Paso',
    fips: '141',
    markets: ['El Paso'],
    site: 'https://epcad.org/',
    search: 'https://epcad.org/Search',
    downloads: ['https://epcad.org/OpenGovernment', 'https://export.epcad.org/datasets/2026_Certified_Export_Files.zip', 'https://propertysearch.blob.core.windows.net/abepublicfiles/Schemas.txt', 'https://propertysearch.blob.core.windows.net/abepublicfiles/Properties2027Dump.zip'],
    api: 'https://go.epcad.org/ApiPropertySearch',
    access: 'bulk',
    publisher: 'EPCAD Property Search dataset downloads (Properties, Owners, Rolls, Lands, Improvements; ~ delimited), linked from its Open Government page',
    fields: {
      account: ['PropertyId'],
      situs: ['Location_Address'],
      situsCity: ['SitusCity'],
      owner: ['OwnerName'],
      mailing: ['MailingAddress'],
      landValue: ['LandMarket'],
      improvementValue: ['Improvements'],
      totalValue: ['Appraised'],
      taxYear: ['RollYear'],
      stateCode: ['StateCode'],
      landSqft: ['LandSqft'],
      buildingSqft: ['LivingArea'],
      yearBuilt: ['YearBuilt']
    },
    valueBasis: 'appraised',
    terms: 'EPCAD lists its files "for development use only" and links an Acceptable Use Policy. Its certified PACS export (export.epcad.org) answers 403 to TERRA\'s collector, so it is not used; the Property Search dataset dumps on propertysearch.blob.core.windows.net answer and are read instead. Rod should read the policy before EPCAD data goes on the live site.'
  },
  {
    id: 'comal',
    name: 'Comal Appraisal District',
    county: 'Comal',
    fips: '091',
    markets: ['New Braunfels'],
    site: 'https://comalad.org/',
    search: 'https://esearch.comalad.org/',
    downloads: ['https://gis.bisclient.com/comalcad/'],
    access: 'none',
    terms: 'No public bulk export or API on the district site; the property search has a CAPTCHA, so it is not automated. The district GIS viewer (gis.bisclient.com/comalcad) is a map for people. The only open parcel layer (TNRIS copy, services6.arcgis.com Comal_County_Parcels) dates from January 2021. Data can be asked for under the Public Information Act (comalad.org/open-records-request).'
  },
  {
    id: 'brazos',
    name: 'Brazos Central Appraisal District',
    county: 'Brazos',
    fips: '041',
    markets: ['College Station'],
    site: 'https://brazoscad.org/',
    search: 'https://esearch.brazoscad.org/',
    downloads: ['https://brazoscad.org/certified-data-downloads/', 'https://brazoscad.org/tax-information/gis/'],
    access: 'bulk',
    publisher: 'Brazos CAD certified data downloads (appraisal export)',
    fields: PACS_FIELDS,
    valueBasis: 'appraised',
    terms: 'Free certified data downloads on the district site; robots.txt allows it. The property search has a CAPTCHA and is not automated.'
  },
  {
    id: 'galveston',
    name: 'Galveston Central Appraisal District',
    county: 'Galveston',
    fips: '167',
    markets: ['Galveston'],
    site: 'https://galvestoncad.org/',
    search: 'https://galvestoncad.org/public-data/',
    downloads: ['https://galvestoncad.org/preliminary-and-certified-roll-export-data/', 'https://galvestoncad.org/gis-data/'],
    access: 'bulk',
    publisher: 'Galveston CAD certified roll export data',
    fields: PACS_FIELDS,
    valueBasis: 'appraised',
    terms: 'Free preliminary and certified roll exports on the district site; robots.txt allows it.'
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
    terms: 'The site answers automated requests with 403 (bot protection), and its robots.txt sets content-signal terms for collection. Not automated; the search is linked for people.'
  },
  {
    id: 'midland',
    name: 'Midland Central Appraisal District',
    county: 'Midland',
    fips: '329',
    markets: ['Midland'],
    site: 'https://midcad.org/',
    search: 'https://www.southwestdatasolution.com/webindex.aspx?dbkey=MIDLANDCAD',
    downloads: ['https://gis.bisclient.com/midlandcad/'],
    access: 'none',
    terms: 'No public bulk export or API on the district site; the search is a vendor site (Southwest Data Solutions) and the GIS viewer (gis.bisclient.com/midlandcad) is a map for people. Data can be asked for under the Public Information Act (midcad.org/open-records).'
  }
];

export function district(id: string): District {
  const found = DISTRICTS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown district ${id}`);
  return found;
}
