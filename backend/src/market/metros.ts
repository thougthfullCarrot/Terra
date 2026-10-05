import type { City } from '../types.js';

/**
 * The metro area each Terra city's market data is read for.
 *
 * Dallas and Fort Worth share one metropolitan statistical area (19100), so
 * each uses its own metropolitan division instead; BLS and the Census publish
 * both divisions separately. The other cities are whole metro areas.
 */
export interface Metro {
  city: City;
  /** OMB's name for the area, shown under the city so a reader knows what is counted. */
  name: string;
  /** Five-digit CBSA or metropolitan division code, as BLS state and area employment uses it. */
  area: string;
  /** Census ACS geography: a division names its parent metro area too. */
  census: { msa: string; division?: string };
  /** BLS Local Area Unemployment Statistics area code (type prefix + state + area). */
  laus: string;
  /** Three-digit Texas county FIPS codes in the area (OMB 2023 delineation). */
  counties: string[];
  /** The TxDOT district that plans the area's state highways. */
  txdotDistrict: string;
  /** HUD Fair Market Rent area id (the FMR API's entity id). */
  hudFmr: string;
  /**
   * Set for a city that is not its metro's namesake: metro-wide figures are
   * the named metro's, and their period says so (e.g. "San Antonio metro").
   */
  sharedMetro?: string;
}

export const METROS: Metro[] = [
  {
    city: 'Dallas',
    name: 'Dallas-Plano-Irving metro division',
    area: '19124',
    census: { msa: '19100', division: '19124' },
    laus: 'DV4819124000000',
    counties: ['085', '113', '121', '139', '231', '257', '397'],
    txdotDistrict: 'Dallas',
    hudFmr: 'METRO19100M19100'
  },
  {
    city: 'Fort Worth',
    name: 'Fort Worth-Arlington-Grapevine metro division',
    area: '23104',
    census: { msa: '19100', division: '23104' },
    laus: 'DV4823104000000',
    counties: ['251', '367', '439', '497'],
    txdotDistrict: 'Fort Worth',
    hudFmr: 'METRO19100MM2800'
  },
  {
    city: 'Houston',
    name: 'Houston-Pasadena-The Woodlands metro',
    area: '26420',
    census: { msa: '26420' },
    laus: 'MT4826420000000',
    counties: ['015', '039', '071', '157', '167', '201', '291', '339', '407', '473'],
    txdotDistrict: 'Houston',
    hudFmr: 'METRO26420M26420'
  },
  {
    city: 'Austin',
    name: 'Austin-Round Rock-San Marcos metro',
    area: '12420',
    census: { msa: '12420' },
    laus: 'MT4812420000000',
    counties: ['021', '055', '209', '453', '491'],
    txdotDistrict: 'Austin',
    hudFmr: 'METRO12420M12420'
  },
  {
    city: 'San Antonio',
    name: 'San Antonio-New Braunfels metro',
    area: '41700',
    census: { msa: '41700' },
    laus: 'MT4841700000000',
    counties: ['013', '019', '029', '091', '187', '259', '325', '493'],
    txdotDistrict: 'San Antonio',
    hudFmr: 'METRO41700M41700'
  },
  {
    city: 'El Paso',
    name: 'El Paso metro',
    area: '21340',
    census: { msa: '21340' },
    laus: 'MT4821340000000',
    counties: ['141', '229'],
    txdotDistrict: 'El Paso',
    hudFmr: 'METRO21340M21340'
  },
  {
    // In the San Antonio metro: metro-level sources (BLS, ACS, population
    // estimates, FHFA, Realtor.com, HUD FMR) repeat San Antonio's figures,
    // labeled as such; city-level sources read New Braunfels's own rows.
    city: 'New Braunfels',
    name: 'San Antonio-New Braunfels metro',
    area: '41700',
    census: { msa: '41700' },
    laus: 'MT4841700000000',
    counties: ['013', '019', '029', '091', '187', '259', '325', '493'],
    txdotDistrict: 'San Antonio',
    hudFmr: 'METRO41700M41700',
    sharedMetro: 'San Antonio metro'
  },
  {
    city: 'College Station',
    name: 'College Station-Bryan metro',
    area: '17780',
    census: { msa: '17780' },
    laus: 'MT4817780000000',
    counties: ['041', '051', '395'],
    txdotDistrict: 'Bryan',
    hudFmr: 'METRO17780M17780'
  },
  {
    // In the Houston metro, like New Braunfels in San Antonio's: metro-level
    // figures repeat Houston's, labeled; city-level sources read Galveston's rows.
    city: 'Galveston',
    name: 'Houston-Pasadena-The Woodlands metro',
    area: '26420',
    census: { msa: '26420' },
    laus: 'MT4826420000000',
    counties: ['015', '039', '071', '157', '167', '201', '291', '339', '407', '473'],
    txdotDistrict: 'Houston',
    hudFmr: 'METRO26420M26420',
    sharedMetro: 'Houston metro'
  },
  {
    city: 'Lubbock',
    name: 'Lubbock metro',
    area: '31180',
    census: { msa: '31180' },
    laus: 'MT4831180000000',
    counties: ['107', '303', '305'],
    txdotDistrict: 'Lubbock',
    hudFmr: 'METRO31180M31180'
  },
  {
    // Midland metro only; Odessa (Ector County) is its own metro and shows
    // only on the development map and in the news search.
    city: 'Midland',
    name: 'Midland metro',
    area: '33260',
    census: { msa: '33260' },
    laus: 'MT4833260000000',
    counties: ['317', '329'],
    txdotDistrict: 'Odessa',
    hudFmr: 'METRO33260M33260'
  }
];
