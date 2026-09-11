// data-source.js — the app's ONLY data layer.
// Swap the bodies of fetchFeed/fetchMarkets for real network calls and the UI
// needs no changes. Everything below the SCHEMA comment is placeholder seed data.
//
// SCHEMA
//   Posting  { id, role, firm, city, sector, kind:'Internship'|'Entry-level',
//              pay, posted:<days ago>, deadline:<display date>, days:<days left>,
//              desc, reqs:string[], source }
//   Match    { [postingId]: { score:0-100, note, lines:string[] } }
//   Market   { [cityName]: { trend, dir:'up'|'down'|'flat', summary,
//              stats:[label,value,delta,dir][], sectors:[name,note,pct][],
//              news:[tag,head,body][], hiring } }
//
// PRODUCTION NOTES
//   · Collector polls ATS endpoints (Greenhouse/Lever/Workday) + one aggregator
//     API, normalizes to Posting, dedupes on firm+role+city, writes to Postgres.
//   · fetchFeed should hit your own API, never a job board directly.
//   · Match scores are computed server-side on insert against the parsed resume.

export const SOURCE = {
  name: 'texas-cre-aggregator',
  endpoint: 'https://api.yourapp.dev/v1/postings?state=TX&level=intern,entry',
  poll: 'every 2 hours',
  transport: 'REST + realtime subscription on insert'
};

const JOBS = [
  {id:'j1',role:'Investment Analyst Intern',firm:'Lone Star Capital Partners',city:'Dallas',sector:'Investment',kind:'Internship',pay:'$24/hr',posted:1,deadline:'Oct 3, 2026',days:22,
   desc:'Summer 2027 analyst internship supporting the acquisitions team on multifamily and industrial deals across DFW. You will underwrite live opportunities and sit in on IC discussions.',
   reqs:['Rising junior or senior, finance or real estate coursework','Argus Enterprise exposure preferred, not required','Strong Excel modeling fundamentals','Available 10 weeks in Dallas'],
   source:'Posted on the firm careers page, verified 1 day ago.'},
  {id:'j2',role:'Brokerage Analyst',firm:'Trinity Realty Advisors',city:'Fort Worth',sector:'Brokerage',kind:'Entry-level',pay:'$62–70k',posted:3,deadline:'Sep 26, 2026',days:15,
   desc:'Support an office and industrial leasing team with market research, tour books, and lease abstracts. Entry-level, licensed within 90 days of hire.',
   reqs:['Bachelor degree, any major','Texas real estate salesperson license or willingness to obtain','CoStar and Excel comfort','Valid driver license, local tours'],
   source:'Aggregated from a Texas brokerage board, verified 3 days ago.'},
  {id:'j3',role:'Development Intern',firm:'Bayou Ridge Development',city:'Houston',sector:'Development',kind:'Internship',pay:'$22/hr',posted:2,deadline:'Oct 15, 2026',days:34,
   desc:'Work alongside project managers on mixed-use developments in the Inner Loop. Site due diligence, entitlement tracking, and pro forma updates.',
   reqs:['Real estate, construction management, or architecture student','Reads site plans and schedules','Detail oriented with permitting paperwork','Houston based for the summer'],
   source:'Posted on the firm careers page, verified 2 days ago.'},
  {id:'j4',role:'Property Management Associate',firm:'Alamo Asset Group',city:'San Antonio',sector:'Property Mgmt',kind:'Entry-level',pay:'$55–60k',posted:5,deadline:'Sep 30, 2026',days:19,
   desc:'First rung on the property management ladder across a 1.2M sq ft retail portfolio. Tenant requests, vendor coordination, and monthly reporting.',
   reqs:['Bachelor degree preferred','Yardi or MRI exposure a plus','Comfortable as the tenant point of contact','On-site four days a week'],
   source:'Aggregated from a Texas jobs board, verified 5 days ago.'},
  {id:'j5',role:'Capital Markets Summer Analyst',firm:'Congress Avenue Capital',city:'Austin',sector:'Capital Markets',kind:'Internship',pay:'$28/hr',posted:1,deadline:'Sep 22, 2026',days:11,
   desc:'Debt placement and structured finance internship. Build loan sizing models, assemble lender packages, and track Texas credit spreads weekly.',
   reqs:['Rising senior, finance or economics','Excel modeling test as part of interview','Interest in debt markets','Austin office, hybrid Fridays'],
   source:'Posted on the firm careers page, verified 1 day ago.'},
  {id:'j6',role:'Valuation Analyst I',firm:'Pecan Street Valuation',city:'Austin',sector:'Appraisal',kind:'Entry-level',pay:'$58–64k',posted:7,deadline:'Oct 10, 2026',days:29,
   desc:'Entry-level appraisal role on the commercial team. Assist certified appraisers with income approach analysis on Central Texas office and retail assets.',
   reqs:['Bachelor degree with quantitative coursework','Appraiser trainee license within 6 months','Clear written communication','Field inspections across Central Texas'],
   source:'Aggregated from a Texas appraisal board, verified 7 days ago.'},
  {id:'j7',role:'Asset Management Intern',firm:'Gulf Coast Industrial Trust',city:'Houston',sector:'Asset Mgmt',kind:'Internship',pay:'$25/hr',posted:4,deadline:'Oct 20, 2026',days:39,
   desc:'Support asset managers on a Texas industrial portfolio: budget variance review, lease renewal analysis, and quarterly investor reporting.',
   reqs:['Junior or senior standing','Excel and PowerPoint fluency','Curiosity about industrial fundamentals','Houston based, 12 weeks'],
   source:'Posted on the firm careers page, verified 4 days ago.'},
  {id:'j8',role:'Research Associate',firm:'Panhandle Realty Research',city:'Dallas',sector:'Investment',kind:'Entry-level',pay:'$60–66k',posted:2,deadline:'Oct 6, 2026',days:25,
   desc:'Track Texas submarket fundamentals and publish quarterly office, industrial, and retail reports used by the brokerage and capital markets teams.',
   reqs:['Bachelor degree, strong writing sample','Data cleaning in Excel, SQL a plus','Interest in Texas market dynamics','Dallas office, four days on site'],
   source:'Aggregated from a Texas research board, verified 2 days ago.'}
];

// Resume: Maya Reyes · UT Austin finance '27 · Excel/Argus · Austin-based
const MATCH = {
  j5:{score:96,note:'Austin · modeling · rising senior',lines:['Finance major at UT Austin, exactly the degree and class year listed','Excel modeling test maps to your DCF and loan-sizing coursework','Austin based, no relocation needed for a hybrid summer','Capital markets is your top saved sector']},
  j1:{score:94,note:'Argus · acquisitions · summer 27',lines:['Argus Enterprise certificate on your resume, listed as preferred','Rising senior with finance coursework, matches the class requirement','Multifamily underwriting from your REIT case competition','Dallas is 3 hours away and you marked relocation open']},
  j7:{score:88,note:'Excel · asset management',lines:[]},
  j3:{score:71,note:'',lines:[]}, j8:{score:76,note:'',lines:[]},
  j2:{score:64,note:'',lines:[]}, j4:{score:52,note:'',lines:[]}, j6:{score:69,note:'',lines:[]}
};
const STRONG = 92;

const MARKETS = {
  Austin:{trend:'Cooling',dir:'down',summary:'Office still absorbing 2023-2025 deliveries downtown, but industrial in the northeast corridor is tightening and capital markets activity picked up for the third straight month.',
    stats:[['Office vacancy','23.1%','+0.4 pts QoQ','flat'],['Industrial vacancy','9.4%','-0.6 pts QoQ','up'],['Avg asking rent','$44.10 psf','-1.2% YoY','down'],['Under constr.','4.8M sq ft','-18% YoY','down']],
    sectors:[['Industrial','Leasing up',78],['Capital markets','Recovering',62],['Office','Soft',31],['Retail','Stable',55]],
    news:[['Leasing','Semiconductor supplier takes 210k sq ft in Pflugerville','Largest northeast-corridor industrial lease of the quarter; broker teams are staffing up on research.'],['Capital markets','Two Austin office towers trade at 2019 pricing','Repricing is drawing opportunistic buyers back to the CBD.'],['Development','Domain phase expansion pushed to 2028','Developer cites construction costs; entitlement work continues.']],
    hiring:'Analyst hiring follows the debt desks here. Two of your saved firms posted summer roles in the last 10 days.'},
  Dallas:{trend:'Expanding',dir:'up',summary:'DFW remains the most active leasing market in the state. Industrial net absorption leads the country and corporate relocations keep office demand steady in Uptown and Legacy.',
    stats:[['Office vacancy','19.6%','-0.2 pts QoQ','up'],['Industrial vacancy','8.1%','-0.4 pts QoQ','up'],['Avg asking rent','$31.80 psf','+2.6% YoY','up'],['Under constr.','31M sq ft','+6% YoY','up']],
    sectors:[['Industrial','Very active',92],['Investment','Active',74],['Office','Improving',58],['Retail','Tight',68]],
    news:[['Relocation','Financial services firm signs 340k sq ft in Legacy','Adds roughly 1,400 jobs to the Plano corridor over three years.'],['Investment','Two-property industrial portfolio trades in south Dallas','Priced at a 5.9% cap, the tightest print since early 2024.'],['Retail','Grocery-anchored centers under 4% vacancy','Owners are pushing renewal rents across the metroplex.']],
    hiring:'The deepest entry-level market in Texas. Brokerage and research roles open here first and close fast.'},
  Houston:{trend:'Steady',dir:'flat',summary:'Energy tenants are holding space rather than growing, while port-driven industrial along the east side continues to lease. Inner Loop mixed-use development is the bright spot.',
    stats:[['Office vacancy','25.4%','flat QoQ','flat'],['Industrial vacancy','7.8%','-0.3 pts QoQ','up'],['Avg asking rent','$30.20 psf','+0.8% YoY','flat'],['Under constr.','18M sq ft','-9% YoY','down']],
    sectors:[['Industrial','Port-driven',84],['Development','Active',66],['Asset mgmt','Steady',60],['Office','Oversupplied',28]],
    news:[['Industrial','Port volumes up 11% year over year','Distribution tenants are pre-leasing east-side space before delivery.'],['Development','Inner Loop mixed-use project breaks ground','Adds 430 units and 60k sq ft of retail near the museum district.'],['Office','Energy tenant renews 280k sq ft downtown','Flat footprint, ten-year term, heavy TI package.']],
    hiring:'Development and asset management internships dominate here. Two are live in your feed right now.'},
  'San Antonio':{trend:'Steady',dir:'flat',summary:'A retail and property management market more than an investment market. Population growth on the north side keeps neighborhood centers full and management portfolios growing.',
    stats:[['Retail vacancy','4.2%','-0.1 pts QoQ','up'],['Office vacancy','17.9%','+0.3 pts QoQ','flat'],['Avg asking rent','$25.60 psf','+1.4% YoY','up'],['Under constr.','6.2M sq ft','+3% YoY','up']],
    sectors:[['Retail','Tight',80],['Property mgmt','Hiring',72],['Industrial','Growing',58],['Investment','Quiet',34]],
    news:[['Retail','North-side center leases final two suites','Third consecutive quarter of sub-5% retail vacancy.'],['Property mgmt','Regional owner adds 900k sq ft to portfolio','Expect associate-level management hiring in Q4.'],['Industrial','Rail-served site trades near Loop 410','Buyer plans a 400k sq ft speculative build.']],
    hiring:'Property management is the realistic entry point. Lower pay than DFW, but the fastest yes for a first job.'},
  'Fort Worth':{trend:'Expanding',dir:'up',summary:'Alliance corridor industrial keeps delivering and leasing. Downtown office is small but stable, and brokerage teams here run leaner, which means more responsibility early.',
    stats:[['Industrial vacancy','7.4%','-0.5 pts QoQ','up'],['Office vacancy','16.2%','-0.4 pts QoQ','up'],['Avg asking rent','$28.40 psf','+2.1% YoY','up'],['Under constr.','12M sq ft','+4% YoY','up']],
    sectors:[['Industrial','Very active',88],['Brokerage','Hiring',70],['Office','Stable',52],['Retail','Steady',57]],
    news:[['Leasing','Logistics tenant takes 500k sq ft at Alliance','One of the largest north Texas leases of the year.'],['Brokerage','Two teams add junior analysts','Small shops are the likeliest entry-level opening.'],['Development','Speculative build starts near I-35W','1.1M sq ft across two buildings, 2027 delivery.']],
    hiring:'Analyst seats at smaller brokerages. Fewer postings than Dallas, less competition for each.'},
  'El Paso':{trend:'Emerging',dir:'up',summary:'Cross-border manufacturing and nearshoring drive almost all activity. A small market with few postings, but industrial fundamentals are the tightest in the state.',
    stats:[['Industrial vacancy','5.1%','-0.7 pts QoQ','up'],['Office vacancy','14.8%','flat QoQ','flat'],['Avg asking rent','$22.90 psf','+3.4% YoY','up'],['Under constr.','3.1M sq ft','+22% YoY','up']],
    sectors:[['Industrial','Tightest in TX',94],['Logistics','Growing',76],['Retail','Stable',48],['Office','Quiet',30]],
    news:[['Nearshoring','Third manufacturer commits to a border-adjacent build','Nearshoring demand continues to outrun supply.'],['Industrial','Sub-6% vacancy for a fifth straight quarter','Rent growth leads all Texas markets.'],['Infrastructure','Port of entry expansion funded','Expected to add cross-dock demand through 2028.']],
    hiring:'Thin posting volume. Worth an alert rather than a weekly check.'}
};
MARKETS['Texas'] = {trend:'Mixed',dir:'flat',summary:'Statewide roll-up of the six tracked metros. Industrial carries the state, office remains split between a recovering DFW and an oversupplied Austin and Houston, and retail is the tightest it has been in a decade.',
  stats:[['Office vacancy','21.4%','flat QoQ','flat'],['Industrial vacancy','7.9%','-0.5 pts QoQ','up'],['Avg asking rent','$30.60 psf','+1.3% YoY','up'],['Under constr.','75M sq ft','-4% YoY','down']],
  sectors:[['Industrial','Leads the state',89],['Retail','Tight',67],['Investment','Recovering',58],['Office','Split',38]],
  news:[['Statewide','Texas leads the country in industrial absorption','DFW and Houston account for roughly two thirds of the total.'],['Capital markets','Transaction volume up a third year over year','Buyers are re-entering at repriced basis across all six metros.'],['Retail','Statewide retail vacancy under 5%','Population growth keeps neighborhood centers full.']],
  hiring:'Every tracked metro has at least one live entry-level or internship posting this week.'};

const wait = (ms) => new Promise(r => setTimeout(r, ms));
let failNext = false;
export function simulateFailure() { failNext = true; }

export async function fetchFeed({ state = 'TX', latency = 850 } = {}) {
  await wait(latency);
  if (failNext) { failNext = false; throw new Error('Source unreachable — ' + SOURCE.name + ' returned 503'); }
  return {
    jobs: JOBS.filter(j => state === 'TX'),
    match: MATCH,
    markets: MARKETS,
    syncedAt: new Date()
  };
}

export async function fetchMarkets({ latency = 400 } = {}) {
  await wait(latency);
  return MARKETS;
}
