/**
 * Websites for owners and developers that file a lot of Texas projects.
 *
 * TDLR's filings name the owner but carry no website, so the link comes from
 * this list when the owner (or the project name) matches one of these, and
 * otherwise from a search that opens the top result for the owner's name.
 * Add a line here when a developer keeps showing up without a direct link.
 */
interface Developer {
  match: RegExp;
  name: string;
  url: string;
}

export const DEVELOPERS: Developer[] = [
  // Commercial and industrial developers
  { match: /\bhines\b/i, name: 'Hines', url: 'https://www.hines.com/' },
  { match: /trammell crow residential|\btcr\b/i, name: 'Trammell Crow Residential', url: 'https://www.tcr.com/' },
  { match: /trammell crow/i, name: 'Trammell Crow Company', url: 'https://www.trammellcrow.com/' },
  { match: /\bhillwood\b/i, name: 'Hillwood', url: 'https://www.hillwood.com/' },
  { match: /lincoln property/i, name: 'Lincoln Property Company', url: 'https://www.lpc.com/' },
  { match: /stream realty/i, name: 'Stream Realty Partners', url: 'https://www.streamrealty.com/' },
  { match: /\btranswestern\b/i, name: 'Transwestern', url: 'https://www.transwestern.com/' },
  { match: /\bskanska\b/i, name: 'Skanska', url: 'https://www.usa.skanska.com/' },
  { match: /howard hughes/i, name: 'Howard Hughes', url: 'https://www.howardhughes.com/' },
  { match: /\bmidway\b/i, name: 'Midway', url: 'https://www.midwaycompanies.com/' },
  { match: /crescent real estate/i, name: 'Crescent Real Estate', url: 'https://www.crescent.com/' },
  { match: /cousins properties/i, name: 'Cousins Properties', url: 'https://www.cousins.com/' },
  { match: /\bprologis\b/i, name: 'Prologis', url: 'https://www.prologis.com/' },
  { match: /\bdalfen\b/i, name: 'Dalfen Industrial', url: 'https://www.dalfen.com/' },
  { match: /majestic realty/i, name: 'Majestic Realty', url: 'https://www.majesticrealty.com/' },
  { match: /\bseefried\b/i, name: 'Seefried Industrial Properties', url: 'https://www.seefriedproperties.com/' },
  { match: /\beastgroup\b/i, name: 'EastGroup Properties', url: 'https://www.eastgroup.net/' },
  { match: /link logistics/i, name: 'Link Logistics', url: 'https://www.linklogistics.com/' },
  { match: /ryan companies/i, name: 'Ryan Companies', url: 'https://www.ryancompanies.com/' },
  { match: /hunt realty/i, name: 'Hunt Realty Investments', url: 'https://www.huntrealty.com/' },
  { match: /\bweitzman\b/i, name: 'Weitzman', url: 'https://www.weitzmangroup.com/' },
  { match: /\bnewquest\b/i, name: 'NewQuest', url: 'https://www.newquest.com/' },
  // Apartment developers
  { match: /\bhanover\b/i, name: 'The Hanover Company', url: 'https://www.hanoverco.com/' },
  { match: /\bgreystar\b/i, name: 'Greystar', url: 'https://www.greystar.com/' },
  { match: /\bcamden\b/i, name: 'Camden', url: 'https://www.camdenliving.com/' },
  { match: /alliance residential/i, name: 'Alliance Residential', url: 'https://www.allresco.com/' },
  { match: /wood partners/i, name: 'Wood Partners', url: 'https://www.woodpartners.com/' },
  { match: /mill creek/i, name: 'Mill Creek Residential', url: 'https://www.mcrtrust.com/' },
  { match: /\bjpi\b/i, name: 'JPI', url: 'https://www.jpi.com/' },
  { match: /thompson thrift/i, name: 'Thompson Thrift', url: 'https://www.thompsonthrift.com/' },
  { match: /fairfield residential/i, name: 'Fairfield Residential', url: 'https://www.fairfieldresidential.com/' },
  // Owners that build their own stores and campuses
  { match: /\bh-?e-?b\b|h\.e\. butt/i, name: 'H-E-B', url: 'https://www.heb.com/' },
  { match: /\bwal-?mart\b/i, name: 'Walmart', url: 'https://corporate.walmart.com/' },
  { match: /\bcostco\b/i, name: 'Costco', url: 'https://www.costco.com/' },
  { match: /\bkroger\b/i, name: 'Kroger', url: 'https://www.kroger.com/' },
  { match: /buc-?ee'?s/i, name: "Buc-ee's", url: 'https://buc-ees.com/' },
  { match: /\blilly\b/i, name: 'Eli Lilly', url: 'https://www.lilly.com/' },
  { match: /memorial hermann/i, name: 'Memorial Hermann', url: 'https://www.memorialhermann.org/' },
  { match: /houston methodist/i, name: 'Houston Methodist', url: 'https://www.houstonmethodist.org/' },
  { match: /baylor scott/i, name: 'Baylor Scott & White', url: 'https://www.bswhealth.com/' },
  { match: /texas children'?s/i, name: "Texas Children's", url: 'https://www.texaschildrens.org/' },
  // Public owners
  { match: /university of houston/i, name: 'University of Houston', url: 'https://www.uh.edu/' },
  { match: /university of texas at austin|\but austin\b/i, name: 'UT Austin', url: 'https://www.utexas.edu/' },
  { match: /\butsa\b|university of texas at san antonio/i, name: 'UTSA', url: 'https://www.utsa.edu/' },
  { match: /\butep\b|university of texas at el paso/i, name: 'UTEP', url: 'https://www.utep.edu/' },
  { match: /texas a&m/i, name: 'Texas A&M', url: 'https://www.tamu.edu/' },
  { match: /\brice university\b/i, name: 'Rice University', url: 'https://www.rice.edu/' },
  { match: /\bhouston isd\b|\bhisd\b/i, name: 'Houston ISD', url: 'https://www.houstonisd.org/' },
  { match: /\bdallas isd\b|\bdisd\b/i, name: 'Dallas ISD', url: 'https://www.dallasisd.org/' },
  { match: /\baustin isd\b|\baisd\b/i, name: 'Austin ISD', url: 'https://www.austinisd.org/' },
  { match: /fort worth isd|\bfwisd\b/i, name: 'Fort Worth ISD', url: 'https://www.fwisd.org/' },
  { match: /northside isd/i, name: 'Northside ISD', url: 'https://www.nisd.net/' },
  { match: /el paso isd|\bepisd\b/i, name: 'El Paso ISD', url: 'https://www.episd.org/' },
  { match: /aldine isd|aldine independent/i, name: 'Aldine ISD', url: 'https://www.aldineisd.org/' },
  { match: /\bkaty isd\b/i, name: 'Katy ISD', url: 'https://www.katyisd.org/' },
  { match: /cypress-fairbanks|\bcfisd\b/i, name: 'Cy-Fair ISD', url: 'https://www.cfisd.net/' },
  { match: /city of houston/i, name: 'City of Houston', url: 'https://www.houstontx.gov/' },
  { match: /city of dallas/i, name: 'City of Dallas', url: 'https://dallascityhall.com/' },
  { match: /city of austin/i, name: 'City of Austin', url: 'https://www.austintexas.gov/' },
  { match: /city of san antonio/i, name: 'City of San Antonio', url: 'https://www.sanantonio.gov/' },
  { match: /city of el paso/i, name: 'City of El Paso', url: 'https://www.elpasotexas.gov/' },
  { match: /city of fort worth/i, name: 'City of Fort Worth', url: 'https://www.fortworthtexas.gov/' },
  { match: /harris county/i, name: 'Harris County', url: 'https://www.harriscountytx.gov/' },
  { match: /\btxdot\b/i, name: 'TxDOT', url: 'https://www.txdot.gov/' }
];

export interface DeveloperLink {
  url: string;
  /** True when the link is the developer's own site from the list; false for a search. */
  direct: boolean;
  /** The developer's name as the list knows it, when matched. */
  name: string | null;
}

/**
 * The developer's website: the listed site when the owner or project name
 * matches, else DuckDuckGo's "first result" search for the owner, which lands
 * on the owner's own site for most named firms.
 */
export function developerLink(owner: string | null, project: string, city: string): DeveloperLink {
  for (const text of [owner, project]) {
    if (!text) continue;
    const found = DEVELOPERS.find((d) => d.match.test(text));
    if (found) return { url: found.url, direct: true, name: found.name };
  }
  const query = owner ? `${owner} ${city} Texas` : `${project} ${city} Texas developer`;
  return { url: `https://duckduckgo.com/?q=${encodeURIComponent(`!ducky ${query}`)}`, direct: false, name: null };
}
