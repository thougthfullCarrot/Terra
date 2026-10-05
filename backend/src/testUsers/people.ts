/**
 * Ten made-up website accounts for exercising sign-in gating, profiles and
 * best-match ordering. Every address is on a reserved example domain, so no
 * mail can reach a real person, and each account is created with
 * app_metadata.terra_test_user = true so it can be found and removed later
 * (`npm run test-users -- remove`).
 *
 * The mix covers each way access is decided (migration 0005):
 *   - .edu addresses, including a subdomain and mixed case: college, free
 *   - non-college with an active or trialing subscription: subscriber
 *   - non-college with a canceled or lapsed subscription: none (paywall)
 *   - a look-alike "edu" address with no subscription: none
 */

export type Expected = 'college' | 'subscriber' | 'none';

export interface TestSubscription {
  status: 'active' | 'trialing' | 'canceled' | 'past_due';
  /** Days from now the paid period ends; negative means it already ended. */
  periodEndDays: number | null;
}

export interface TestPerson {
  email: string;
  expected: Expected;
  /** Why this account is in the set. */
  covers: string;
  name: string;
  school: string | null;
  gradYear: number | null;
  major: string | null;
  homeCity: string | null;
  relocationOpen: boolean;
  sectors: string[];
  /** Avatar fill colour, or null for no picture. */
  avatar: [number, number, number] | null;
  /** Plain-text resume, or null for no resume. */
  resume: string | null;
  subscription: TestSubscription | null;
}

export const TEST_FLAG = 'terra_test_user';

export const PEOPLE: TestPerson[] = [
  {
    email: 'maya.patel@example.edu',
    expected: 'college',
    covers: 'plain .edu address, investment analyst profile',
    name: 'Maya Patel',
    school: 'University of Texas at Austin',
    gradYear: 2027,
    major: 'Finance',
    homeCity: 'Austin',
    relocationOpen: false,
    sectors: ['Investment', 'Capital Markets'],
    avatar: [231, 111, 81],
    resume: `Maya Patel, Austin TX
Finance, University of Texas at Austin, May 2027. GPA 3.8. Real Estate Finance and Investment Center.
Experience: Acquisitions intern, Austin multifamily sponsor (summer 2026). Built financial modeling and DCF pro forma models in Excel and Argus Enterprise for 12 deals; ran underwriting on value-add apartments; pulled sale comps from CoStar.
Skills: Argus, advanced Excel, financial modeling, waterfall, underwriting, CoStar, PowerPoint pitch deck.`,
    subscription: null
  },
  {
    email: 'jreyes@mail.example.edu',
    expected: 'college',
    covers: '.edu subdomain address, development profile',
    name: 'Jordan Reyes',
    school: 'Texas A&M University',
    gradYear: 2026,
    major: 'Land Economics and Real Estate',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Development', 'Brokerage'],
    avatar: [42, 157, 143],
    resume: `Jordan Reyes, Houston TX
B.S. Land Economics and Real Estate, Texas A&M University, December 2026.
Experience: Development intern, Houston industrial developer. Tracked entitlements, zoning and permitting for two sites; mapped parcels in ArcGIS; wrote market research memos on submarket supply.
Brokerage intern: prepared comps and lease analysis for tenant rep team. Studying for the Texas real estate license (TREC).
Skills: GIS, entitlements, market research, lease analysis, Excel, report writing.`,
    subscription: null
  },
  {
    email: 'athompson@example.edu',
    expected: 'college',
    covers: '.edu address, early-career student (class of 2028), property management',
    name: 'Aaliyah Thompson',
    school: 'University of Texas at San Antonio',
    gradYear: 2028,
    major: 'Real Estate Finance and Development',
    homeCity: 'San Antonio',
    relocationOpen: false,
    sectors: ['Property Mgmt'],
    avatar: [138, 79, 198],
    resume: `Aaliyah Thompson, San Antonio TX
Real Estate Finance and Development, UTSA, expected May 2028.
Experience: Leasing assistant, 300-unit San Antonio community. Entered rent rolls and work orders in Yardi; prepared lease administration files and lease abstracts; answered residents.
Skills: Yardi, lease administration, Excel spreadsheet, written communication, customer service.`,
    subscription: null
  },
  {
    email: 'Ethan.Nguyen@Example.EDU',
    expected: 'college',
    covers: 'mixed-case .edu address, appraisal profile',
    name: 'Ethan Nguyen',
    school: 'University of Texas at Dallas',
    gradYear: 2027,
    major: 'Economics',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Appraisal'],
    avatar: [33, 118, 199],
    resume: `Ethan Nguyen, Richardson TX
Economics, UT Dallas, May 2027. Minor in data science.
Experience: Appraisal trainee, Dallas valuation firm. Completed USPAP 15-hour course; gathered comparables and wrote report writing drafts for retail and office appraisals; cleaned assessor data with Python (pandas) and SQL.
Skills: USPAP, comps, Python, SQL, Tableau, Excel.`,
    subscription: null
  },
  {
    email: 'smartinez@example.edu',
    expected: 'college',
    covers: '.edu address with no resume, so no best-match badges should show',
    name: 'Sofia Martinez',
    school: 'University of Texas at El Paso',
    gradYear: 2026,
    major: 'Accounting',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Asset Mgmt'],
    avatar: null,
    resume: null,
    subscription: null
  },
  {
    email: 'marcus.lee@example.com',
    expected: 'subscriber',
    covers: 'non-college address with an active subscription, career changer',
    name: 'Marcus Lee',
    school: 'Tarrant County College',
    gradYear: 2025,
    major: 'Business Administration',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Brokerage', 'Investment'],
    avatar: [244, 162, 97],
    resume: `Marcus Lee, Fort Worth TX
A.A.S. Business Administration, Tarrant County College, 2025. Texas salesperson license (TREC), 2026.
Experience: Four years in retail management before real estate. Brokerage runner for a Fort Worth investment sales team: built comps in CoStar, assembled offering memorandum PowerPoint decks, cold-called owners.
Skills: real estate license, CoStar, PowerPoint, Excel, market research.`,
    subscription: { status: 'active', periodEndDays: 25 }
  },
  {
    email: 'priya.shah@example.org',
    expected: 'subscriber',
    covers: 'non-college address on a trial subscription, no grad year (alum)',
    name: 'Priya Shah',
    school: 'Rice University',
    gradYear: null,
    major: 'Statistics',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Capital Markets', 'Asset Mgmt'],
    avatar: [233, 196, 106],
    resume: `Priya Shah, Houston TX
B.A. Statistics, Rice University, 2024.
Experience: Data analyst, Houston lender (2024 to now). Loan sizing and credit analysis models; SQL and Python pipelines over the loan book; Tableau and Power BI dashboards for the capital markets desk; DCF checks on sponsor pro forma.
Skills: SQL, Python, Tableau, underwriting, modeling, Excel.`,
    subscription: { status: 'trialing', periodEndDays: 10 }
  },
  {
    email: 'dokafor@example.net',
    expected: 'none',
    covers: 'non-college address whose subscription was canceled',
    name: 'Daniel Okafor',
    school: 'Prairie View A&M University',
    gradYear: 2026,
    major: 'Construction Science',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Development', 'Homebuilder'],
    avatar: [96, 108, 56],
    resume: `Daniel Okafor, Houston TX
Construction Science, Prairie View A&M, 2026.
Experience: Field intern with a production homebuilder: scheduling, permitting, punch lists. Estimating in Excel.
Skills: permitting, Excel, scheduling.`,
    subscription: { status: 'canceled', periodEndDays: -3 }
  },
  {
    email: 'hannah.kim@edu.example.com',
    expected: 'none',
    covers: 'look-alike "edu" address that is not a college, no subscription',
    name: 'Hannah Kim',
    school: 'Baylor University',
    gradYear: 2027,
    major: 'Marketing',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Brokerage'],
    avatar: [255, 99, 146],
    resume: `Hannah Kim, Waco TX
Marketing, Baylor University, 2027.
Experience: Marketing intern for a Dallas brokerage: flyers, PowerPoint presentations, social posts.
Skills: PowerPoint, writing sample available.`,
    subscription: null
  },
  {
    email: 'carlos.alvarez@example.com',
    expected: 'none',
    covers: 'non-college address marked active but whose paid period already ended',
    name: 'Carlos Alvarez',
    school: 'Texas State University',
    gradYear: 2025,
    major: 'Real Estate',
    homeCity: 'Austin',
    relocationOpen: true,
    sectors: ['Homebuilder', 'Development'],
    avatar: [0, 109, 119],
    resume: `Carlos Alvarez, San Marcos TX
B.B.A. Real Estate, Texas State University, 2025.
Experience: Land acquisition analyst intern, Central Texas homebuilder: lot pro forma models, zoning research, GIS maps of submarkets.
Skills: pro forma, zoning, GIS, Excel, market research.`,
    subscription: { status: 'active', periodEndDays: -5 }
  }
];
