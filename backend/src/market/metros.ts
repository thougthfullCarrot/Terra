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
  }
];
