/**
 * A hundred made-up website accounts for exercising sign-in gating, profiles,
 * alerts, the application tracker and best-match ordering. Every address is on a reserved example domain, so no
 * mail can reach a real person, and each account is created with
 * app_metadata.terra_test_user = true so it can be found and removed later
 * (`npm run test-users -- remove`).
 *
 * The mix covers each way access is decided (migration 0005):
 *   - .edu addresses, including a subdomain and mixed case: college, free
 *   - non-college with an active or trialing subscription: subscriber
 *   - non-college with a canceled or lapsed subscription: none (paywall)
 *   - a look-alike "edu" address with no subscription: none
 *
 * Beyond those, the set is deliberately varied so the pages meet real-world
 * input: accented and hyphenated names, plus-tagged and upper-case emails,
 * every sector and city, no sectors or no city at all, very short and very
 * long resumes, markup-looking text that must never render as HTML, and every
 * Stripe status a subscription row can hold.
 */

export type Expected = 'college' | 'subscriber' | 'none';

export interface TestSubscription {
  status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'unpaid' | 'incomplete';
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
  },
  {
    email: 'jose.hernandez@example.edu',
    expected: 'college',
    covers: 'accented name, Affordable Housing sector',
    name: 'José Ángel Hernández',
    school: 'University of Houston',
    gradYear: 2027,
    major: 'Real Estate Development',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Affordable Housing', 'Development'],
    avatar: [201, 52, 52],
    resume: `José Ángel Hernández, Houston TX
Real Estate Development, Bauer College of Business, University of Houston, May 2027.
Experience: Intern, Houston affordable housing nonprofit. Assembled LIHTC application exhibits, tracked HUD compliance files, built a pro forma for a 120-unit tax credit deal in Excel.
Skills: pro forma, Excel, market research, report writing, Spanish (fluent).`,
    subscription: null
  },
  {
    email: 'lan.nguyen@student.example.edu',
    expected: 'college',
    covers: 'Vietnamese name with diacritics, student.* .edu subdomain',
    name: 'Nguyễn Thị Lan',
    school: 'University of Houston-Clear Lake',
    gradYear: 2026,
    major: 'Finance',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Capital Markets'],
    avatar: [52, 201, 120],
    resume: `Nguyen Thi Lan, Webster TX
Finance, University of Houston-Clear Lake, December 2026.
Experience: Debt and equity intern, Houston mortgage banker. Loan sizing in Excel, credit analysis memos, assembled lender comps and pitch deck pages.
Skills: loan sizing, credit analysis, Excel, PowerPoint, Argus.`,
    subscription: null
  },
  {
    email: 'liam.oconnor-walsh@example.edu',
    expected: 'college',
    covers: "apostrophe and hyphen in the name and email",
    name: "Liam O'Connor-Walsh",
    school: 'Southern Methodist University',
    gradYear: 2027,
    major: 'Real Estate Finance',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Investment', 'Asset Mgmt'],
    avatar: [64, 64, 160],
    resume: `Liam O'Connor-Walsh, Dallas TX
B.B.A. Real Estate Finance, SMU Cox School of Business, May 2027.
Experience: Asset management intern, Dallas office REIT. Monthly variance reports, lease abstract summaries, Argus Enterprise reforecasts, quarterly investor decks.
Skills: Argus, Excel, lease abstract, PowerPoint presentation, financial modeling.`,
    subscription: null
  },
  {
    email: 'pat+terra@example.edu',
    expected: 'college',
    covers: 'plus-tagged .edu address',
    name: 'Pat Okonkwo',
    school: 'Texas Christian University',
    gradYear: 2028,
    major: 'Business Information Systems',
    homeCity: 'Fort Worth',
    relocationOpen: true,
    sectors: ['Brokerage'],
    avatar: [77, 0, 128],
    resume: `Pat Okonkwo, Fort Worth TX
Business Information Systems, TCU Neeley, May 2028.
Experience: Research intern, Fort Worth industrial brokerage. Pulled CoStar availabilities, kept the submarket database in SQL, built Power BI market reports for brokers.
Skills: CoStar, SQL, Power BI, market research, Excel.`,
    subscription: null
  },
  {
    email: 'GRACE.WILLIAMS@EXAMPLE.EDU',
    expected: 'college',
    covers: 'all upper-case .edu address',
    name: 'Grace Williams',
    school: 'Baylor University',
    gradYear: 2026,
    major: 'Entrepreneurship',
    homeCity: 'Austin',
    relocationOpen: true,
    sectors: ['Development'],
    avatar: [255, 140, 0],
    resume: `Grace Williams, Waco TX
Entrepreneurship, Baylor University, May 2026. Keller Center real estate fellow.
Experience: Development intern for an Austin mixed-use developer: entitlements tracker, zoning research with the city, site tours and GIS maps.
Skills: entitlements, zoning, GIS, Excel, written communication.`,
    subscription: null
  },
  {
    email: 'tyler.brooks@example.edu',
    expected: 'college',
    covers: 'no sectors picked and no home city',
    name: 'Tyler Brooks',
    school: 'Texas Tech University',
    gradYear: 2027,
    major: 'Personal Financial Planning',
    homeCity: null,
    relocationOpen: true,
    sectors: [],
    avatar: [0, 128, 128],
    resume: `Tyler Brooks, Lubbock TX
Personal Financial Planning, Texas Tech University, 2027.
Experience: Summer analyst at a Lubbock family office. Excel models for farmland and self-storage, comps research.
Skills: Excel, financial modeling, comps.`,
    subscription: null
  },
  {
    email: 'isabella.garcia@example.edu',
    expected: 'college',
    covers: 'every sector picked',
    name: 'Isabella García',
    school: 'University of Texas Rio Grande Valley',
    gradYear: 2027,
    major: 'Finance',
    homeCity: 'San Antonio',
    relocationOpen: true,
    sectors: ['Investment', 'Brokerage', 'Development', 'Property Mgmt', 'Asset Mgmt', 'Appraisal', 'Capital Markets', 'Homebuilder', 'Affordable Housing'],
    avatar: [220, 20, 60],
    resume: `Isabella Garcia, Edinburg TX
Finance, UTRGV, May 2027.
Experience: Rotational intern at a South Texas real estate firm across brokerage, property management and development. Lease analysis, Yardi entries, comps, pro forma checks.
Skills: Excel, Yardi, lease analysis, comps, pro forma, market research.`,
    subscription: null
  },
  {
    email: 'noah.kim@example.edu',
    expected: 'college',
    covers: 'one-word resume, so scores rest almost entirely on city and year',
    name: 'Noah Kim',
    school: 'Rice University',
    gradYear: 2026,
    major: 'Economics',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Investment'],
    avatar: [100, 149, 237],
    resume: 'Excel',
    subscription: null
  },
  {
    email: 'olivia.chen@example.edu',
    expected: 'college',
    covers: 'very long resume (about 20,000 characters)',
    name: 'Olivia Chen',
    school: 'University of Texas at Austin',
    gradYear: 2026,
    major: 'Business Honors and Plan II',
    homeCity: 'Austin',
    relocationOpen: true,
    sectors: ['Investment', 'Capital Markets', 'Development'],
    avatar: [255, 215, 0],
    resume: `Olivia Chen, Austin TX
Business Honors and Plan II, University of Texas at Austin, May 2026.
${Array.from({ length: 60 }, (_, i) => `Project ${i + 1}: underwrote a value-add multifamily acquisition with a DCF and waterfall in Excel and Argus, pulled CoStar comps, wrote the investment committee memo and built the PowerPoint pitch deck.`).join('\n')}
Skills: Argus, Excel, financial modeling, DCF, waterfall, CoStar, PowerPoint, report writing.`,
    subscription: null
  },
  {
    email: 'ahmed.hassan@example.edu',
    expected: 'college',
    covers: 'markup-looking text in major and resume, which must show as plain text',
    name: 'Ahmed Hassan',
    school: 'University of North Texas',
    gradYear: 2027,
    major: 'Real Estate <b>Finance</b>',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Brokerage', 'Investment'],
    avatar: [46, 139, 87],
    resume: `Ahmed Hassan, Denton TX
Real Estate, University of North Texas, 2027. <script>alert('x')</script> <img src=x onerror=alert(1)>
Experience: Investment sales intern, Dallas: CoStar comps, offering memorandum PowerPoint, underwriting in Excel.
Skills: CoStar, PowerPoint, underwriting, Excel.`,
    subscription: null
  },
  {
    email: 'emma.johnson@example.edu',
    expected: 'college',
    covers: 'property management with MRI and Yardi, El Paso',
    name: 'Emma Johnson',
    school: 'University of Texas at El Paso',
    gradYear: 2027,
    major: 'Management',
    homeCity: 'El Paso',
    relocationOpen: false,
    sectors: ['Property Mgmt'],
    avatar: [255, 105, 180],
    resume: `Emma Johnson, El Paso TX
Management, UTEP, May 2027.
Experience: Assistant property manager intern for an El Paso retail portfolio. CAM reconciliations in MRI, tenant work orders in Yardi, lease administration and renewals.
Skills: MRI, Yardi, lease administration, Excel, customer service.`,
    subscription: null
  },
  {
    email: 'diego.ramirez@example.edu',
    expected: 'college',
    covers: 'appraisal trainee with USPAP, San Antonio',
    name: 'Diego Ramírez',
    school: "St. Mary's University",
    gradYear: 2026,
    major: 'Finance',
    homeCity: 'San Antonio',
    relocationOpen: false,
    sectors: ['Appraisal'],
    avatar: [139, 69, 19],
    resume: `Diego Ramirez, San Antonio TX
Finance, St. Mary's University, May 2026.
Experience: Appraiser trainee, San Antonio valuation shop. USPAP 15-hour course done; gathered comparables, wrote report writing drafts for industrial and land appraisals; Bexar CAD research.
Skills: USPAP, comps, report writing, Excel.`,
    subscription: null
  },
  {
    email: 'chloe.davis@example.edu',
    expected: 'college',
    covers: 'homebuilder land acquisition, Fort Worth',
    name: 'Chloe Davis',
    school: 'University of Texas at Arlington',
    gradYear: 2027,
    major: 'Real Estate',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Homebuilder'],
    avatar: [70, 130, 180],
    resume: `Chloe Davis, Arlington TX
Real Estate, UT Arlington, May 2027.
Experience: Land acquisition intern at a DFW homebuilder: lot pro forma, zoning and entitlements research, permitting calendar, GIS maps of new communities.
Skills: pro forma, zoning, entitlements, permitting, GIS, Excel.`,
    subscription: null
  },
  {
    email: 'benjamin.wright@example.edu',
    expected: 'college',
    covers: 'grad year at the far end of the form (six years out)',
    name: 'Benjamin Wright',
    school: 'Texas A&M University-Corpus Christi',
    gradYear: 2032,
    major: 'Undeclared',
    homeCity: 'San Antonio',
    relocationOpen: true,
    sectors: ['Investment'],
    avatar: [128, 128, 0],
    resume: `Benjamin Wright, Corpus Christi TX
Freshman, Texas A&M University-Corpus Christi, expected 2032.
Experience: Real estate club member. Built a rental comps spreadsheet in Excel for coastal duplexes.
Skills: Excel, research.`,
    subscription: null
  },
  {
    email: 'zoe.martin@example.edu',
    expected: 'college',
    covers: 'grad year at the near end of the form (last year)',
    name: 'Zoe Martin',
    school: 'Texas State University',
    gradYear: 2025,
    major: 'Real Estate',
    homeCity: 'Austin',
    relocationOpen: false,
    sectors: ['Brokerage', 'Property Mgmt'],
    avatar: [199, 21, 133],
    resume: `Zoe Martin, San Marcos TX
B.B.A. Real Estate, Texas State University, December 2025. Texas salesperson license (TREC) in progress.
Experience: Leasing intern, Austin office landlord: tour scheduling, lease analysis comparisons, CoStar listings.
Skills: lease analysis, CoStar, real estate license, Excel.`,
    subscription: null
  },
  {
    email: 'samuel.adeyemi@example.edu',
    expected: 'college',
    covers: 'data-heavy capital markets profile, no picture',
    name: 'Samuel Adeyemi',
    school: 'University of Texas at Dallas',
    gradYear: 2026,
    major: 'Business Analytics',
    homeCity: 'Dallas',
    relocationOpen: true,
    sectors: ['Capital Markets', 'Investment'],
    avatar: null,
    resume: `Samuel Adeyemi, Richardson TX
M.S. Business Analytics, UT Dallas, May 2026.
Experience: Data intern on a Dallas capital markets team. Python and SQL pipelines over CMBS loan tapes, Tableau dashboards, loan sizing checks, DCF sensitivity tables.
Skills: Python, pandas, SQL, Tableau, loan sizing, DCF, Excel.`,
    subscription: null
  },
  {
    email: 'mia.lopez@example.edu',
    expected: 'college',
    covers: 'resume on file but no picture and no major',
    name: 'Mia López',
    school: 'Texas A&M University-San Antonio',
    gradYear: 2028,
    major: null,
    homeCity: 'San Antonio',
    relocationOpen: false,
    sectors: ['Affordable Housing'],
    avatar: null,
    resume: `Mia Lopez, San Antonio TX
Texas A&M University-San Antonio, expected 2028.
Experience: Volunteer with a San Antonio housing nonprofit: resident surveys, grant report writing, market research on rents.
Skills: market research, report writing, Excel.`,
    subscription: null
  },
  {
    email: 'ryan.patel@example.edu',
    expected: 'college',
    covers: 'college email that also has a canceled subscription: college access wins',
    name: 'Ryan Patel',
    school: 'University of Texas at Austin',
    gradYear: 2027,
    major: 'Finance',
    homeCity: 'Austin',
    relocationOpen: true,
    sectors: ['Investment', 'Capital Markets'],
    avatar: [65, 105, 225],
    resume: `Ryan Patel, Austin TX
Finance, McCombs, University of Texas at Austin, May 2027.
Experience: Acquisitions intern, Austin industrial sponsor. Underwriting in Argus, DCF and waterfall models, CoStar comps, IC memos.
Skills: Argus, underwriting, DCF, waterfall, CoStar, Excel.`,
    subscription: { status: 'canceled', periodEndDays: -30 }
  },
  {
    email: 'harper.scott@example.edu',
    expected: 'college',
    covers: 'name only, no school, major, year, city, sectors, picture or resume',
    name: 'Harper Scott',
    school: null,
    gradYear: null,
    major: null,
    homeCity: null,
    relocationOpen: false,
    sectors: [],
    avatar: null,
    resume: null,
    subscription: null
  },
  {
    email: 'kenji.tanaka@example.edu',
    expected: 'college',
    covers: 'Japanese name, asset management, Houston',
    name: 'Kenji Tanaka',
    school: 'Houston Christian University',
    gradYear: 2026,
    major: 'Accounting',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Asset Mgmt'],
    avatar: [25, 25, 112],
    resume: `Kenji Tanaka, Houston TX
Accounting, Houston Christian University, May 2026.
Experience: Asset management intern for a Houston medical office owner. Budget variance reports, Yardi exports, lease abstract library, Excel cash flow models.
Skills: Yardi, lease abstract, Excel, financial modeling.`,
    subscription: null
  },
  {
    email: 'ava.robinson@example.edu',
    expected: 'college',
    covers: 'Spanish-language resume text',
    name: 'Ava Robinson',
    school: 'Texas A&M International University',
    gradYear: 2027,
    major: 'Finanzas',
    homeCity: 'San Antonio',
    relocationOpen: true,
    sectors: ['Brokerage'],
    avatar: [255, 127, 80],
    resume: `Ava Robinson, Laredo TX
Finanzas, Texas A&M International University, mayo 2027.
Experiencia: Practicante en una correduría comercial de Laredo. Investigación de mercado, comparables en CoStar, presentaciones en PowerPoint.
Habilidades: Excel, CoStar, PowerPoint, investigación de mercado.`,
    subscription: null
  },
  {
    email: 'elijah.moore@example.edu',
    expected: 'college',
    covers: 'architecture student, Houston townhome developer',
    name: 'Elijah Moore',
    school: 'Prairie View A&M University',
    gradYear: 2027,
    major: 'Architecture',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Development', 'Homebuilder'],
    avatar: [112, 128, 144],
    resume: `Elijah Moore, Prairie View TX
Architecture, Prairie View A&M, May 2027.
Experience: Development intern with a Houston townhome builder: permitting packages, zoning checks, entitlements calendar, site plans in GIS.
Skills: permitting, zoning, entitlements, GIS, PowerPoint.`,
    subscription: null
  },
  {
    email: 'nina.petrova@example.org',
    expected: 'subscriber',
    covers: 'active subscription, Russian name, El Paso career changer',
    name: 'Nina Petrova',
    school: 'New Mexico State University',
    gradYear: null,
    major: 'Civil Engineering',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Development', 'Asset Mgmt'],
    avatar: [176, 196, 222],
    resume: `Nina Petrova, El Paso TX
B.S. Civil Engineering, New Mexico State University, 2021. Five years as a site engineer.
Experience: Permitting and entitlements for industrial sites near the border; budgets and schedules in Excel; moving into development management.
Skills: permitting, entitlements, zoning, Excel, GIS.`,
    subscription: { status: 'active', periodEndDays: 20 }
  },
  {
    email: 'brandon.taylor@example.com',
    expected: 'subscriber',
    covers: 'active subscription with no period end recorded',
    name: 'Brandon Taylor',
    school: 'Sam Houston State University',
    gradYear: 2024,
    major: 'General Business',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Brokerage'],
    avatar: [210, 105, 30],
    resume: `Brandon Taylor, Huntsville TX
General Business, Sam Houston State University, 2024. Texas real estate license (TREC).
Experience: Residential agent moving to commercial. Comps, CoStar searches, flyers in PowerPoint.
Skills: real estate license, CoStar, comps, PowerPoint.`,
    subscription: { status: 'active', periodEndDays: null }
  },
  {
    email: 'fatima.ali@example.net',
    expected: 'subscriber',
    covers: 'trial subscription ending tomorrow',
    name: 'Fatima Ali',
    school: 'University of Houston-Downtown',
    gradYear: 2025,
    major: 'Finance',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Investment', 'Capital Markets'],
    avatar: [147, 112, 219],
    resume: `Fatima Ali, Houston TX
Finance, University of Houston-Downtown, 2025.
Experience: Credit analyst at a community bank: credit analysis on CRE loans, loan sizing, rent roll reviews, underwriting memos.
Skills: credit analysis, loan sizing, underwriting, Excel.`,
    subscription: { status: 'trialing', periodEndDays: 1 }
  },
  {
    email: 'jack.anderson@example.com',
    expected: 'subscriber',
    covers: 'active subscription, Austin, no resume (paying without matching)',
    name: 'Jack Anderson',
    school: 'Austin Community College',
    gradYear: null,
    major: null,
    homeCity: 'Austin',
    relocationOpen: false,
    sectors: ['Property Mgmt'],
    avatar: [95, 158, 160],
    resume: null,
    subscription: { status: 'active', periodEndDays: 29 }
  },
  {
    email: 'sophie.dubois@example.org',
    expected: 'subscriber',
    covers: 'French accented name, appraisal, Dallas',
    name: 'Sophie Dubois-Lefèvre',
    school: 'Université Laval',
    gradYear: null,
    major: 'Économie',
    homeCity: 'Dallas',
    relocationOpen: true,
    sectors: ['Appraisal', 'Asset Mgmt'],
    avatar: [216, 191, 216],
    resume: `Sophie Dubois-Lefevre, Dallas TX
Economics, Universite Laval, 2023. Moved to Dallas in 2025.
Experience: Valuation analyst: comparables, appraisal standards (USPAP equivalent), report writing, Tableau dashboards.
Skills: USPAP, comps, report writing, Tableau, Excel.`,
    subscription: { status: 'active', periodEndDays: 12 }
  },
  {
    email: 'omar.farouk@example.com',
    expected: 'subscriber',
    covers: 'trial subscription, Fort Worth, investment',
    name: 'Omar Farouk',
    school: 'Texas Wesleyan University',
    gradYear: 2024,
    major: 'Accounting',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Investment'],
    avatar: [0, 191, 255],
    resume: `Omar Farouk, Fort Worth TX
Accounting, Texas Wesleyan University, 2024. Staff accountant at a Fort Worth CPA firm.
Experience: Partnership tax for real estate funds; waterfall distribution schedules in Excel; pro forma reviews.
Skills: waterfall, pro forma, Excel, financial modeling.`,
    subscription: { status: 'trialing', periodEndDays: 14 }
  },
  {
    email: 'rachel.green@example.net',
    expected: 'subscriber',
    covers: 'active subscription, San Antonio, affordable housing',
    name: 'Rachel Green',
    school: 'Trinity University',
    gradYear: 2023,
    major: 'Urban Studies',
    homeCity: 'San Antonio',
    relocationOpen: false,
    sectors: ['Affordable Housing', 'Development'],
    avatar: [60, 179, 113],
    resume: `Rachel Green, San Antonio TX
Urban Studies, Trinity University, 2023.
Experience: City housing department analyst: LIHTC and HOME compliance, market research memos, GIS maps of opportunity zones, report writing for council.
Skills: GIS, market research, report writing, Excel.`,
    subscription: { status: 'active', periodEndDays: 3 }
  },
  {
    email: 'victor.huang@example.com',
    expected: 'subscriber',
    covers: 'active subscription, every city open (relocation), data skills',
    name: 'Victor Huang',
    school: 'Georgia Tech',
    gradYear: 2025,
    major: 'Industrial Engineering',
    homeCity: 'Dallas',
    relocationOpen: true,
    sectors: ['Capital Markets', 'Investment', 'Asset Mgmt'],
    avatar: [255, 69, 0],
    resume: `Victor Huang, Dallas TX
Industrial Engineering, Georgia Tech, 2025.
Experience: Analyst at a proptech startup: Python models of rent growth, SQL warehouse, Power BI reports for asset managers, DCF tools.
Skills: Python, SQL, Power BI, DCF, Excel, financial modeling.`,
    subscription: { status: 'active', periodEndDays: 27 }
  },
  {
    email: 'laura.bennett@example.org',
    expected: 'subscriber',
    covers: 'trial subscription, homebuilder sales',
    name: 'Laura Bennett',
    school: 'Stephen F. Austin State University',
    gradYear: 2022,
    major: 'Marketing',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Homebuilder'],
    avatar: [244, 164, 96],
    resume: `Laura Bennett, The Woodlands TX
Marketing, Stephen F. Austin State University, 2022. Texas salesperson license.
Experience: New home sales consultant for a Houston builder: traffic reports in Excel, presentations, permitting status updates for buyers.
Skills: real estate license, Excel, PowerPoint presentation, customer service.`,
    subscription: { status: 'trialing', periodEndDays: 6 }
  },
  {
    email: 'andre.jackson@example.net',
    expected: 'none',
    covers: 'subscription past due (failed card): paywall',
    name: 'Andre Jackson',
    school: 'Texas Southern University',
    gradYear: 2025,
    major: 'Finance',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Investment'],
    avatar: [105, 105, 105],
    resume: `Andre Jackson, Houston TX
Finance, Texas Southern University, 2025.
Experience: Analyst intern at a Houston multifamily syndicator: underwriting, CoStar comps, Excel models.
Skills: underwriting, CoStar, Excel.`,
    subscription: { status: 'past_due', periodEndDays: 5 }
  },
  {
    email: 'megan.clark@example.com',
    expected: 'none',
    covers: 'subscription unpaid: paywall',
    name: 'Megan Clark',
    school: 'Abilene Christian University',
    gradYear: 2024,
    major: 'Management',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Property Mgmt'],
    avatar: [188, 143, 143],
    resume: `Megan Clark, Dallas TX
Management, Abilene Christian University, 2024.
Experience: Leasing consultant, Dallas apartments: Yardi, lease administration, renewals.
Skills: Yardi, lease administration, Excel.`,
    subscription: { status: 'unpaid', periodEndDays: 10 }
  },
  {
    email: 'kevin.wu@example.org',
    expected: 'none',
    covers: 'checkout started but never finished (incomplete): paywall',
    name: 'Kevin Wu',
    school: 'University of Houston',
    gradYear: 2023,
    major: 'Supply Chain',
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Capital Markets'],
    avatar: [72, 61, 139],
    resume: `Kevin Wu, Houston TX
Supply Chain Management, University of Houston, 2023.
Experience: Logistics analyst moving into industrial real estate: SQL, Tableau, market research on warehouse submarket demand.
Skills: SQL, Tableau, market research, Excel.`,
    subscription: { status: 'incomplete', periodEndDays: null }
  },
  {
    email: 'jessica.ortiz@example.net',
    expected: 'none',
    covers: 'trial that ended yesterday: paywall',
    name: 'Jessica Ortiz',
    school: 'Our Lady of the Lake University',
    gradYear: 2024,
    major: 'Business',
    homeCity: 'San Antonio',
    relocationOpen: true,
    sectors: ['Brokerage', 'Property Mgmt'],
    avatar: [218, 112, 214],
    resume: `Jessica Ortiz, San Antonio TX
Business, Our Lady of the Lake University, 2024.
Experience: Office manager at a San Antonio brokerage: listing flyers, CoStar updates, lease analysis spreadsheets.
Skills: CoStar, lease analysis, Excel, PowerPoint.`,
    subscription: { status: 'trialing', periodEndDays: -1 }
  },
  {
    email: 'alex.rivera@example.edu.mx',
    expected: 'none',
    covers: 'Mexican university domain (.edu.mx) is not .edu, no subscription',
    name: 'Alex Rivera',
    school: 'Universidad Autónoma de Chihuahua',
    gradYear: 2027,
    major: 'Arquitectura',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Development'],
    avatar: [255, 160, 122],
    resume: `Alex Rivera, Ciudad Juarez
Arquitectura, Universidad Autonoma de Chihuahua, 2027.
Experience: Cross-border industrial projects: permitting drawings, zoning research, GIS.
Skills: permitting, zoning, GIS.`,
    subscription: null
  },
  {
    email: 'taylor.reed@example.education',
    expected: 'none',
    covers: 'look-alike ".education" domain, no subscription',
    name: 'Taylor Reed',
    school: 'Texas Woman’s University',
    gradYear: 2026,
    major: 'Business',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Brokerage'],
    avatar: [143, 188, 143],
    resume: `Taylor Reed, Denton TX
Business, Texas Woman's University, 2026.
Experience: Marketing intern at a Dallas retail brokerage: flyers, CoStar listings.
Skills: CoStar, PowerPoint.`,
    subscription: null
  },
  {
    email: 'william.foster@example.com',
    expected: 'none',
    covers: 'never subscribed, non-college: paywall with a profile filled in',
    name: 'William Foster',
    school: 'Midwestern State University',
    gradYear: 2025,
    major: 'Finance',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Investment', 'Brokerage'],
    avatar: [107, 142, 35],
    resume: `William Foster, Wichita Falls TX
Finance, Midwestern State University, 2025.
Experience: Bank teller and part-time real estate assistant: comps, Excel.
Skills: Excel, comps.`,
    subscription: null
  },
  {
    email: 'edu.fan@example.com',
    expected: 'subscriber',
    covers: '"edu" in the part before the @ does not make it a college email; subscribed',
    name: 'Marcus Edu Bell',
    school: 'Collin College',
    gradYear: 2025,
    major: 'Real Estate',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Brokerage', 'Investment'],
    avatar: [30, 144, 255],
    resume: `Marcus Bell, Plano TX
A.A. Real Estate, Collin College, 2025. Texas salesperson license (TREC).
Experience: Brokerage associate for a Plano office team: CoStar comps, lease analysis, PowerPoint proposals.
Skills: real estate license, CoStar, lease analysis, PowerPoint.`,
    subscription: { status: 'active', periodEndDays: 18 }
  },
  {
    email: 'marisol.vega@example.org',
    expected: 'subscriber',
    covers: 'active subscription, Austin homebuilder land analyst',
    name: 'Marisol Vega',
    school: 'Texas A&M University-Kingsville',
    gradYear: 2022,
    major: 'Agribusiness',
    homeCity: 'Austin',
    relocationOpen: true,
    sectors: ['Homebuilder', 'Development'],
    avatar: [154, 205, 50],
    resume: `Marisol Vega, Round Rock TX
Agribusiness, Texas A&M University-Kingsville, 2022.
Experience: Land analyst for a Central Texas builder: lot pro forma, zoning and entitlements, GIS parcel maps, market research on absorption.
Skills: pro forma, zoning, entitlements, GIS, market research, Excel.`,
    subscription: { status: 'active', periodEndDays: 22 }
  },
  // The second fifty (2026-10-07): more schools, names, cities and every access path again, for a 100-account run.
  {
    email: 'nikolai.pham@example.edu',
    expected: 'college',
    covers: '.edu student, investment profile, San Antonio, no resume',
    name: 'Nikolai Pham',
    school: 'University of Houston',
    gradYear: 2027,
    major: 'Urban Planning',
    homeCity: 'San Antonio',
    relocationOpen: false,
    sectors: ['Investment', 'Asset Mgmt'],
    avatar: [67, 225, 182],
    resume: null,
    subscription: null
  },
  {
    email: 'noah.kowalski@example.edu',
    expected: 'college',
    covers: '.edu student, appraisal profile, El Paso',
    name: 'Noah Kowalski',
    school: 'Prairie View A&M University',
    gradYear: 2029,
    major: 'Finance',
    homeCity: 'El Paso',
    relocationOpen: false,
    sectors: ['Appraisal', 'Capital Markets', 'Property Mgmt'],
    avatar: [90, 83, 234],
    resume: `Noah Kowalski, El Paso TX
Finance, Prairie View A&M University, 2029.
Experience: Appraisal trainee: gathered comparables and drafted 30 retail reports.
Experience: Debt placement intern: sized loans and wrote 4 loan memos.
Experience: Leasing assistant at a 6-unit community: rent rolls, renewals, resident calls.
Skills: USPAP, comps, report writing, cost approach, income approach, debt sizing, DSCR, loan memos, Excel, market research, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: null
  },
  {
    email: 'logan.benavides@example.edu',
    expected: 'college',
    covers: '.edu student, brokerage profile, New Braunfels',
    name: 'Logan Benavides',
    school: 'Southern Methodist University',
    gradYear: 2027,
    major: 'Management Information Systems',
    homeCity: 'New Braunfels',
    relocationOpen: false,
    sectors: ['Brokerage'],
    avatar: [179, 34, 35],
    resume: `Logan Benavides, New Braunfels TX
Management Information Systems, Southern Methodist University, 2027.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint.`,
    subscription: null
  },
  {
    email: 'hana.whitfield@example.edu',
    expected: 'college',
    covers: '.edu student, brokerage profile, Lubbock, no resume so no best-match badges',
    name: 'Hana Whitfield',
    school: 'Stephen F. Austin State University',
    gradYear: 2028,
    major: 'Accounting',
    homeCity: 'Lubbock',
    relocationOpen: false,
    sectors: ['Brokerage', 'Asset Mgmt'],
    avatar: [151, 216, 58],
    resume: null,
    subscription: null
  },
  {
    email: 'ava.dubois@example.edu',
    expected: 'college',
    covers: '.edu student, capital markets profile, Lubbock, no resume',
    name: 'Ava DuBois',
    school: 'University of Texas at Austin',
    gradYear: 2026,
    major: 'Management Information Systems',
    homeCity: 'Lubbock',
    relocationOpen: false,
    sectors: ['Capital Markets', 'Property Mgmt'],
    avatar: [197, 88, 184],
    resume: null,
    subscription: null
  },
  {
    email: 'mateo.castillo@example.edu',
    expected: 'college',
    covers: '.edu student who picked no sectors, New Braunfels',
    name: 'Mateo Castillo',
    school: 'Texas A&M University',
    gradYear: 2027,
    major: null,
    homeCity: 'New Braunfels',
    relocationOpen: false,
    sectors: [],
    avatar: [194, 151, 201],
    resume: `Mateo Castillo, New Braunfels TX
Undeclared, Texas A&M University, 2027.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint.`,
    subscription: null
  },
  {
    email: 'lucas.lindqvist@example.edu',
    expected: 'college',
    covers: '.edu student, brokerage profile, El Paso',
    name: 'Lucas Lindqvist',
    school: 'Lamar University',
    gradYear: 2027,
    major: 'Accounting',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Brokerage', 'Development'],
    avatar: [26, 145, 97],
    resume: `Lucas Lindqvist, El Paso TX
Accounting, Lamar University, 2027.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Development intern: tracked entitlements and permitting for 7 sites.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint, entitlements, zoning, pro forma, GIS, site selection.`,
    subscription: null
  },
  {
    email: 'priya.delgado@example.edu',
    expected: 'college',
    covers: '.edu student, development profile, College Station',
    name: 'Priya Delgado',
    school: 'Rice University',
    gradYear: 2026,
    major: 'Marketing',
    homeCity: 'College Station',
    relocationOpen: true,
    sectors: ['Development', 'Property Mgmt'],
    avatar: [212, 185, 213],
    resume: `Priya Delgado, College Station TX
Marketing, Rice University, 2026.
Experience: Development intern: tracked entitlements and permitting for 4 sites.
Experience: Leasing assistant at a 23-unit community: rent rolls, renewals, resident calls.
Skills: entitlements, zoning, pro forma, GIS, site selection, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: null
  },
  {
    email: 'isaac.acosta@example.edu',
    expected: 'college',
    covers: '.edu student, appraisal profile, no home city',
    name: 'Isaac Acosta',
    school: 'Rice University',
    gradYear: 2028,
    major: 'Geography',
    homeCity: null,
    relocationOpen: true,
    sectors: ['Appraisal'],
    avatar: null,
    resume: `Isaac Acosta, Texas TX
Geography, Rice University, 2028.
Experience: Appraisal trainee: gathered comparables and drafted 39 retail reports.
Skills: USPAP, comps, report writing, cost approach, income approach.`,
    subscription: null
  },
  {
    email: 'nora.novak@example.edu',
    expected: 'college',
    covers: '.edu student, homebuilder profile, Houston, one-line resume',
    name: 'Nora Novak',
    school: 'University of Texas Rio Grande Valley',
    gradYear: 2027,
    major: 'Architecture',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Homebuilder'],
    avatar: [74, 98, 203],
    resume: `Nora Novak. Excel.`,
    subscription: null
  },
  {
    email: 'jude.carrington@example.edu',
    expected: 'college',
    covers: '.edu student, asset mgmt profile, Dallas',
    name: 'Jude Carrington',
    school: 'St. Mary’s University',
    gradYear: 2028,
    major: 'Architecture',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Asset Mgmt', 'Property Mgmt'],
    avatar: [84, 190, 33],
    resume: `Jude Carrington, Dallas TX
Architecture, St. Mary’s University, 2028.
Experience: Asset management intern: monthly variance reports for 5 office buildings.
Experience: Leasing assistant at a 11-unit community: rent rolls, renewals, resident calls.
Skills: variance reports, budgeting, Excel, NOI analysis, investor reporting, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: null
  },
  {
    email: 'yusuf.saldana@example.edu',
    expected: 'college',
    covers: '.edu student, affordable housing profile, Austin',
    name: 'Yusuf Saldaña',
    school: 'Stephen F. Austin State University',
    gradYear: 2028,
    major: 'Accounting',
    homeCity: 'Austin',
    relocationOpen: false,
    sectors: ['Affordable Housing', 'Capital Markets'],
    avatar: [124, 156, 140],
    resume: `Yusuf Saldaña, Austin TX
Accounting, Stephen F. Austin State University, 2028.
Experience: Housing finance intern: helped assemble 36 LIHTC applications.
Experience: Debt placement intern: sized loans and wrote 28 loan memos.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel, debt sizing, DSCR, loan memos, market research.`,
    subscription: null
  },
  {
    email: 'owen.oyelaran@example.edu',
    expected: 'college',
    covers: '.edu student, property mgmt profile, College Station',
    name: 'Owen Oyelaran',
    school: 'Prairie View A&M University',
    gradYear: 2031,
    major: 'Management Information Systems',
    homeCity: 'College Station',
    relocationOpen: true,
    sectors: ['Property Mgmt', 'Asset Mgmt'],
    avatar: [143, 92, 193],
    resume: `Owen Oyelaran, College Station TX
Management Information Systems, Prairie View A&M University, 2031.
Experience: Leasing assistant at a 34-unit community: rent rolls, renewals, resident calls.
Experience: Asset management intern: monthly variance reports for 36 office buildings.
Skills: Yardi, AppFolio, rent rolls, work orders, lease administration, variance reports, budgeting, Excel, NOI analysis, investor reporting.`,
    subscription: null
  },
  {
    email: 'wyatt.garza@example.edu',
    expected: 'college',
    covers: '.edu student, affordable housing profile, Dallas',
    name: 'Wyatt Garza',
    school: 'University of St. Thomas',
    gradYear: 2027,
    major: 'Political Science',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Affordable Housing', 'Property Mgmt'],
    avatar: [56, 31, 142],
    resume: `Wyatt Garza, Dallas TX
Political Science, University of St. Thomas, 2027.
Experience: Housing finance intern: helped assemble 39 LIHTC applications.
Experience: Leasing assistant at a 37-unit community: rent rolls, renewals, resident calls.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: null
  },
  {
    email: 'caleb.lozano@example.edu',
    expected: 'college',
    covers: '.edu student, asset mgmt profile, Fort Worth, very long resume',
    name: 'Caleb Lozano',
    school: 'Texas Christian University',
    gradYear: 2029,
    major: 'Political Science',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Asset Mgmt', 'Capital Markets'],
    avatar: [170, 230, 47],
    resume: `Caleb Lozano, Fort Worth TX
Political Science, Texas Christian University, 2029.
Experience: Asset management intern: monthly variance reports for 15 office buildings.
Experience: Debt placement intern: sized loans and wrote 20 loan memos.
Skills: variance reports, budgeting, Excel, NOI analysis, investor reporting, debt sizing, DSCR, loan memos, market research.
Leadership: Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, mentor.
Leadership: Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, mentor.
Leadership: Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, Real Estate Club officer, case competition finalist, mentor.`,
    subscription: null
  },
  {
    email: 'chloe.morales@example.edu',
    expected: 'college',
    covers: '.edu student, affordable housing profile, Fort Worth',
    name: 'Chloe Morales',
    school: 'Texas Christian University',
    gradYear: 2027,
    major: 'Political Science',
    homeCity: 'Fort Worth',
    relocationOpen: true,
    sectors: ['Affordable Housing', 'Asset Mgmt', 'Appraisal'],
    avatar: [171, 61, 123],
    resume: `Chloe Morales, Fort Worth TX
Political Science, Texas Christian University, 2027.
Experience: Housing finance intern: helped assemble 5 LIHTC applications.
Experience: Asset management intern: monthly variance reports for 34 office buildings.
Experience: Appraisal trainee: gathered comparables and drafted 38 retail reports.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel, variance reports, budgeting, NOI analysis, investor reporting, USPAP, comps, report writing, cost approach, income approach.`,
    subscription: null
  },
  {
    email: 'julian.ellison@example.edu',
    expected: 'college',
    covers: '.edu student, investment profile, Fort Worth',
    name: 'Julian Ellison',
    school: 'Texas A&M University-Corpus Christi',
    gradYear: 2028,
    major: 'Business Administration',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Investment', 'Capital Markets'],
    avatar: [50, 204, 118],
    resume: `Julian Ellison, Fort Worth TX
Business Administration, Texas A&M University-Corpus Christi, 2028.
Experience: Acquisitions intern: built pro forma models and underwrote 11 value-add deals.
Experience: Debt placement intern: sized loans and wrote 40 loan memos.
Skills: Argus, financial modeling, DCF, underwriting, CoStar, debt sizing, DSCR, loan memos, Excel, market research.`,
    subscription: null
  },
  {
    email: 'amara.bianchi@example.edu',
    expected: 'college',
    covers: '.edu student, investment profile, Dallas',
    name: 'Amara Bianchi',
    school: 'University of Texas at Austin',
    gradYear: 2027,
    major: 'Supply Chain Management',
    homeCity: 'Dallas',
    relocationOpen: true,
    sectors: ['Investment', 'Capital Markets'],
    avatar: [157, 100, 199],
    resume: `Amara Bianchi, Dallas TX
Supply Chain Management, University of Texas at Austin, 2027.
Experience: Acquisitions intern: built pro forma models and underwrote 19 value-add deals.
Experience: Debt placement intern: sized loans and wrote 24 loan memos.
Skills: Argus, financial modeling, DCF, underwriting, CoStar, debt sizing, DSCR, loan memos, Excel, market research.`,
    subscription: null
  },
  {
    email: 'liam.okafor@example.edu',
    expected: 'college',
    covers: '.edu student, development profile, Dallas',
    name: 'Liam Okafor',
    school: 'St. Mary’s University',
    gradYear: 2026,
    major: 'Supply Chain Management',
    homeCity: 'Dallas',
    relocationOpen: true,
    sectors: ['Development', 'Investment', 'Asset Mgmt'],
    avatar: [31, 22, 122],
    resume: `Liam Okafor, Dallas TX
Supply Chain Management, St. Mary’s University, 2026.
Experience: Development intern: tracked entitlements and permitting for 21 sites.
Experience: Acquisitions intern: built pro forma models and underwrote 15 value-add deals.
Experience: Asset management intern: monthly variance reports for 28 office buildings.
Skills: entitlements, zoning, pro forma, GIS, site selection, Argus, financial modeling, DCF, underwriting, CoStar, variance reports, budgeting, Excel, NOI analysis, investor reporting.`,
    subscription: null
  },
  {
    email: 'anjali.quintanilla@example.edu',
    expected: 'college',
    covers: '.edu student, affordable housing profile, Houston',
    name: 'Anjali Quintanilla',
    school: 'Texas A&M University-Corpus Christi',
    gradYear: 2028,
    major: 'Accounting',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Affordable Housing'],
    avatar: [98, 164, 209],
    resume: `Anjali Quintanilla, Houston TX
Accounting, Texas A&M University-Corpus Christi, 2028.
Experience: Housing finance intern: helped assemble 26 LIHTC applications.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: null
  },
  {
    email: 'theo.oconnor@example.edu',
    expected: 'college',
    covers: '.edu student, brokerage profile, El Paso',
    name: 'Theo O’Connor',
    school: 'Abilene Christian University',
    gradYear: 2028,
    major: 'Real Estate',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Brokerage', 'Investment', 'Property Mgmt'],
    avatar: [40, 120, 196],
    resume: `Theo O’Connor, El Paso TX
Real Estate, Abilene Christian University, 2028.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Acquisitions intern: built pro forma models and underwrote 5 value-add deals.
Experience: Leasing assistant at a 29-unit community: rent rolls, renewals, resident calls.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint, Argus, financial modeling, DCF, underwriting, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: null
  },
  {
    email: 'rafael.trevino@example.edu',
    expected: 'college',
    covers: '.edu student, affordable housing profile, Houston',
    name: 'Rafael Treviño',
    school: 'Stephen F. Austin State University',
    gradYear: 2026,
    major: 'Architecture',
    homeCity: 'Houston',
    relocationOpen: true,
    sectors: ['Affordable Housing'],
    avatar: [204, 42, 110],
    resume: `Rafael Treviño, Houston TX
Architecture, Stephen F. Austin State University, 2026.
Experience: Housing finance intern: helped assemble 8 LIHTC applications.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: null
  },
  {
    email: 'esperanza.brooks@example.edu',
    expected: 'college',
    covers: '.edu student, property mgmt profile, Fort Worth',
    name: 'Esperanza Brooks',
    school: 'Texas Tech University',
    gradYear: 2028,
    major: 'Management Information Systems',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Property Mgmt', 'Affordable Housing'],
    avatar: [70, 226, 237],
    resume: `Esperanza Brooks, Fort Worth TX
Management Information Systems, Texas Tech University, 2028.
Experience: Leasing assistant at a 12-unit community: rent rolls, renewals, resident calls.
Experience: Housing finance intern: helped assemble 10 LIHTC applications.
Skills: Yardi, AppFolio, rent rolls, work orders, lease administration, LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: null
  },
  {
    email: 'kenji.hernandez@example.edu',
    expected: 'college',
    covers: '.edu student, investment profile, New Braunfels',
    name: 'Kenji Hernández',
    school: 'Prairie View A&M University',
    gradYear: 2029,
    major: 'Civil Engineering',
    homeCity: 'New Braunfels',
    relocationOpen: false,
    sectors: ['Investment', 'Brokerage'],
    avatar: [20, 174, 139],
    resume: `Kenji Hernández, New Braunfels TX
Civil Engineering, Prairie View A&M University, 2029.
Experience: Acquisitions intern: built pro forma models and underwrote 26 value-add deals.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Skills: Argus, financial modeling, DCF, underwriting, CoStar, lease analysis, prospecting, Salesforce, PowerPoint.`,
    subscription: null
  },
  {
    email: 'andres.nakamura@example.edu',
    expected: 'college',
    covers: '.edu student, property mgmt profile, Lubbock',
    name: 'Andrés Nakamura',
    school: 'Texas Tech University',
    gradYear: 2026,
    major: 'Data Science',
    homeCity: 'Lubbock',
    relocationOpen: true,
    sectors: ['Property Mgmt', 'Affordable Housing'],
    avatar: [109, 155, 130],
    resume: `Andrés Nakamura, Lubbock TX
Data Science, Texas Tech University, 2026.
Experience: Leasing assistant at a 30-unit community: rent rolls, renewals, resident calls.
Experience: Housing finance intern: helped assemble 8 LIHTC applications.
Skills: Yardi, AppFolio, rent rolls, work orders, lease administration, LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: null
  },
  {
    email: 'diego.gallagher@example.edu',
    expected: 'college',
    covers: '.edu student, development profile, Austin',
    name: 'Diego Gallagher',
    school: 'Baylor University',
    gradYear: 2029,
    major: 'Data Science',
    homeCity: 'Austin',
    relocationOpen: false,
    sectors: ['Development'],
    avatar: [231, 33, 212],
    resume: `Diego Gallagher, Austin TX
Data Science, Baylor University, 2029.
Experience: Development intern: tracked entitlements and permitting for 29 sites.
Skills: entitlements, zoning, pro forma, GIS, site selection.`,
    subscription: null
  },
  {
    email: 'skim@realestate.example.edu',
    expected: 'college',
    covers: '.edu subdomain with a department host',
    name: 'Samuel Kim',
    school: 'Angelo State University',
    gradYear: 2027,
    major: 'Real Estate',
    homeCity: 'Austin',
    relocationOpen: false,
    sectors: ['Brokerage', 'Asset Mgmt'],
    avatar: [28, 49, 188],
    resume: `Samuel Kim, Austin TX
Real Estate, Angelo State University, 2027.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Asset management intern: monthly variance reports for 22 office buildings.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint, variance reports, budgeting, Excel, NOI analysis, investor reporting.`,
    subscription: null
  },
  {
    email: 'PALOMA.IYER+terra@EXAMPLE.EDU',
    expected: 'college',
    covers: 'upper-case .EDU address with a plus tag',
    name: 'Paloma Iyer',
    school: 'Prairie View A&M University',
    gradYear: 2026,
    major: 'Business Administration',
    homeCity: 'Dallas',
    relocationOpen: false,
    sectors: ['Investment'],
    avatar: null,
    resume: `Paloma Iyer, Dallas TX
Business Administration, Prairie View A&M University, 2026.
Experience: Acquisitions intern: built pro forma models and underwrote 17 value-add deals.
Skills: Argus, financial modeling, DCF, underwriting, CoStar.`,
    subscription: null
  },
  {
    email: 'callum.trinh@example.com',
    expected: 'subscriber',
    covers: 'active subscription, brokerage profile',
    name: 'Callum Trinh',
    school: 'Texas Tech University',
    gradYear: 2024,
    major: 'Urban Planning',
    homeCity: 'Lubbock',
    relocationOpen: true,
    sectors: ['Brokerage', 'Property Mgmt'],
    avatar: [83, 77, 55],
    resume: `Callum Trinh, Lubbock TX
Urban Planning, Texas Tech University, 2024.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Leasing assistant at a 5-unit community: rent rolls, renewals, resident calls.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: { status: 'active', periodEndDays: 25 }
  },
  {
    email: 'zainab.adeyemi@example.net',
    expected: 'subscriber',
    covers: 'active subscription, investment profile',
    name: 'Zainab Adeyemi',
    school: 'Lone Star College',
    gradYear: 2022,
    major: 'Real Estate',
    homeCity: 'Galveston',
    relocationOpen: true,
    sectors: ['Investment', 'Appraisal'],
    avatar: [139, 120, 195],
    resume: `Zainab Adeyemi, Galveston TX
Real Estate, Lone Star College, 2022.
Experience: Acquisitions intern: built pro forma models and underwrote 18 value-add deals.
Experience: Appraisal trainee: gathered comparables and drafted 8 retail reports.
Skills: Argus, financial modeling, DCF, underwriting, CoStar, USPAP, comps, report writing, cost approach, income approach.`,
    subscription: { status: 'active', periodEndDays: 14 }
  },
  {
    email: 'kofi.fairchild@example.com',
    expected: 'subscriber',
    covers: 'active subscription, appraisal profile',
    name: 'Kofi Fairchild',
    school: 'Tarrant County College',
    gradYear: 2022,
    major: 'Supply Chain Management',
    homeCity: 'College Station',
    relocationOpen: false,
    sectors: ['Appraisal', 'Capital Markets'],
    avatar: [154, 94, 148],
    resume: `Kofi Fairchild, College Station TX
Supply Chain Management, Tarrant County College, 2022.
Experience: Appraisal trainee: gathered comparables and drafted 20 retail reports.
Experience: Debt placement intern: sized loans and wrote 27 loan memos.
Skills: USPAP, comps, report writing, cost approach, income approach, debt sizing, DSCR, loan memos, Excel, market research.`,
    subscription: { status: 'active', periodEndDays: 3 }
  },
  {
    email: 'siobhan.sullivan@example.com',
    expected: 'subscriber',
    covers: 'active subscription, appraisal profile',
    name: 'Siobhan Sullivan',
    school: null,
    gradYear: 2021,
    major: 'Supply Chain Management',
    homeCity: 'Fort Worth',
    relocationOpen: false,
    sectors: ['Appraisal', 'Brokerage', 'Property Mgmt'],
    avatar: [197, 164, 65],
    resume: `Siobhan Sullivan, Fort Worth TX
Experience: Appraisal trainee: gathered comparables and drafted 36 retail reports.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Leasing assistant at a 11-unit community: rent rolls, renewals, resident calls.
Skills: USPAP, comps, report writing, cost approach, income approach, CoStar, lease analysis, prospecting, Salesforce, PowerPoint, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: { status: 'active', periodEndDays: 30 }
  },
  {
    email: 'mason.villarreal@example.com',
    expected: 'subscriber',
    covers: 'active subscription, homebuilder profile',
    name: 'Mason Villarreal',
    school: 'San Jacinto College',
    gradYear: 2021,
    major: 'Architecture',
    homeCity: 'College Station',
    relocationOpen: false,
    sectors: ['Homebuilder'],
    avatar: [102, 136, 195],
    resume: `Mason Villarreal, College Station TX
Architecture, San Jacinto College, 2021.
Experience: Land intern at a homebuilder: lot pro formas and absorption research on 30 communities.
Skills: lot pro forma, land acquisition, absorption studies, Procore.`,
    subscription: { status: 'active', periodEndDays: 9 }
  },
  {
    email: 'camila.mcallister@example.org',
    expected: 'subscriber',
    covers: 'active subscription, development profile',
    name: 'Camila McAllister',
    school: 'Lone Star College',
    gradYear: 2023,
    major: 'Business Administration',
    homeCity: 'Galveston',
    relocationOpen: false,
    sectors: ['Development'],
    avatar: [99, 145, 200],
    resume: `Camila McAllister, Galveston TX
Business Administration, Lone Star College, 2023.
Experience: Development intern: tracked entitlements and permitting for 24 sites.
Skills: entitlements, zoning, pro forma, GIS, site selection.`,
    subscription: { status: 'active', periodEndDays: 21 }
  },
  {
    email: 'elijah.montoya@example.com',
    expected: 'subscriber',
    covers: 'active subscription, development profile',
    name: 'Elijah Montoya',
    school: null,
    gradYear: 2022,
    major: 'Economics',
    homeCity: 'San Antonio',
    relocationOpen: true,
    sectors: ['Development', 'Investment'],
    avatar: [68, 52, 210],
    resume: `Elijah Montoya, San Antonio TX
Experience: Development intern: tracked entitlements and permitting for 28 sites.
Experience: Acquisitions intern: built pro forma models and underwrote 35 value-add deals.
Skills: entitlements, zoning, pro forma, GIS, site selection, Argus, financial modeling, DCF, underwriting, CoStar.`,
    subscription: { status: 'active', periodEndDays: 12 }
  },
  {
    email: 'valentina.chavez@example.org',
    expected: 'subscriber',
    covers: 'active subscription, brokerage profile',
    name: 'Valentina Chávez',
    school: 'Southern Methodist University',
    gradYear: 2022,
    major: 'Real Estate',
    homeCity: 'El Paso',
    relocationOpen: false,
    sectors: ['Brokerage', 'Capital Markets', 'Appraisal'],
    avatar: [200, 37, 87],
    resume: `Valentina Chávez, El Paso TX
Real Estate, Southern Methodist University, 2022.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Debt placement intern: sized loans and wrote 6 loan memos.
Experience: Appraisal trainee: gathered comparables and drafted 33 retail reports.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint, debt sizing, DSCR, loan memos, Excel, market research, USPAP, comps, report writing, cost approach, income approach.`,
    subscription: { status: 'active', periodEndDays: 27 }
  },
  {
    email: 'olivia.ramirezsoto@example.com',
    expected: 'subscriber',
    covers: 'free trial, brokerage profile',
    name: 'Olivia Ramírez-Soto',
    school: 'San Jacinto College',
    gradYear: 2026,
    major: 'Management Information Systems',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Brokerage'],
    avatar: [172, 195, 199],
    resume: `Olivia Ramírez-Soto, El Paso TX
Management Information Systems, San Jacinto College, 2026.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint.`,
    subscription: { status: 'trialing', periodEndDays: 6 }
  },
  {
    email: 'leah.yoon@example.net',
    expected: 'subscriber',
    covers: 'free trial, appraisal profile',
    name: 'Leah Yoon',
    school: 'Dallas College',
    gradYear: 2024,
    major: 'Geography',
    homeCity: 'San Antonio',
    relocationOpen: false,
    sectors: ['Appraisal', 'Affordable Housing'],
    avatar: null,
    resume: `Leah Yoon, San Antonio TX
Geography, Dallas College, 2024.
Experience: Appraisal trainee: gathered comparables and drafted 39 retail reports.
Experience: Housing finance intern: helped assemble 39 LIHTC applications.
Skills: USPAP, comps, report writing, cost approach, income approach, LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: { status: 'trialing', periodEndDays: 2 }
  },
  {
    email: 'imani.sato@example.com',
    expected: 'subscriber',
    covers: 'free trial, homebuilder profile, no resume',
    name: 'Imani Sato',
    school: 'Texas Tech University',
    gradYear: 2026,
    major: 'Geography',
    homeCity: 'Galveston',
    relocationOpen: false,
    sectors: ['Homebuilder', 'Appraisal', 'Capital Markets'],
    avatar: [170, 108, 172],
    resume: null,
    subscription: { status: 'trialing', periodEndDays: 13 }
  },
  {
    email: 'beau.haddad@example.net',
    expected: 'subscriber',
    covers: 'active subscription with no period end recorded, brokerage profile',
    name: 'Beau Haddad',
    school: 'San Jacinto College',
    gradYear: 2021,
    major: 'Geography',
    homeCity: 'College Station',
    relocationOpen: true,
    sectors: ['Brokerage', 'Development'],
    avatar: [138, 143, 179],
    resume: `Beau Haddad, College Station TX
Geography, San Jacinto College, 2021.
Experience: Brokerage intern: pulled comps and prepared lease proposals for a tenant rep team.
Experience: Development intern: tracked entitlements and permitting for 14 sites.
Skills: CoStar, lease analysis, prospecting, Salesforce, PowerPoint, entitlements, zoning, pro forma, GIS, site selection.`,
    subscription: { status: 'active', periodEndDays: null }
  },
  {
    email: 'tariq.strickland@example.net',
    expected: 'none',
    covers: 'canceled last week: paywall',
    name: 'Tariq Strickland',
    school: 'Dallas College',
    gradYear: 2025,
    major: 'Real Estate',
    homeCity: 'Galveston',
    relocationOpen: false,
    sectors: ['Property Mgmt', 'Affordable Housing'],
    avatar: [154, 204, 67],
    resume: `Tariq Strickland, Galveston TX
Real Estate, Dallas College, 2025.
Experience: Leasing assistant at a 37-unit community: rent rolls, renewals, resident calls.
Experience: Housing finance intern: helped assemble 14 LIHTC applications.
Skills: Yardi, AppFolio, rent rolls, work orders, lease administration, LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: { status: 'canceled', periodEndDays: -7 }
  },
  {
    email: 'renee.zamora@example.com',
    expected: 'none',
    covers: 'past due after a failed card: paywall',
    name: 'Renée Zamora',
    school: 'Texas Christian University',
    gradYear: 2025,
    major: 'Urban Planning',
    homeCity: 'El Paso',
    relocationOpen: true,
    sectors: ['Appraisal', 'Affordable Housing', 'Property Mgmt'],
    avatar: [93, 138, 36],
    resume: `Renée Zamora, El Paso TX
Urban Planning, Texas Christian University, 2025.
Experience: Appraisal trainee: gathered comparables and drafted 32 retail reports.
Experience: Housing finance intern: helped assemble 17 LIHTC applications.
Experience: Leasing assistant at a 9-unit community: rent rolls, renewals, resident calls.
Skills: USPAP, comps, report writing, cost approach, income approach, LIHTC, compliance, HUD, tax credit applications, Excel, Yardi, AppFolio, rent rolls, work orders, lease administration.`,
    subscription: { status: 'past_due', periodEndDays: 4 }
  },
  {
    email: 'harper.huang@example.com',
    expected: 'none',
    covers: 'unpaid subscription: paywall',
    name: 'Harper Huang',
    school: 'University of Houston',
    gradYear: 2026,
    major: 'Economics',
    homeCity: 'Galveston',
    relocationOpen: true,
    sectors: ['Capital Markets', 'Appraisal', 'Investment'],
    avatar: null,
    resume: `Harper Huang, Galveston TX
Economics, University of Houston, 2026.
Experience: Debt placement intern: sized loans and wrote 32 loan memos.
Experience: Appraisal trainee: gathered comparables and drafted 25 retail reports.
Experience: Acquisitions intern: built pro forma models and underwrote 5 value-add deals.
Skills: debt sizing, DSCR, loan memos, Excel, market research, USPAP, comps, report writing, cost approach, income approach, Argus, financial modeling, DCF, underwriting, CoStar.`,
    subscription: { status: 'unpaid', periodEndDays: 15 }
  },
  {
    email: 'gabriel.mbeki@example.com',
    expected: 'none',
    covers: 'checkout never finished (incomplete): paywall',
    name: 'Gabriel Mbeki',
    school: 'Houston Community College',
    gradYear: 2024,
    major: 'Business Administration',
    homeCity: 'New Braunfels',
    relocationOpen: true,
    sectors: ['Capital Markets', 'Affordable Housing'],
    avatar: [60, 46, 230],
    resume: `Gabriel Mbeki, New Braunfels TX
Business Administration, Houston Community College, 2024.
Experience: Debt placement intern: sized loans and wrote 4 loan memos.
Experience: Housing finance intern: helped assemble 19 LIHTC applications.
Skills: debt sizing, DSCR, loan memos, Excel, market research, LIHTC, compliance, HUD, tax credit applications.`,
    subscription: { status: 'incomplete', periodEndDays: null }
  },
  {
    email: 'mia.escobedo@example.org',
    expected: 'none',
    covers: 'trial ran out two days ago: paywall',
    name: 'Mia Escobedo',
    school: 'Tarrant County College',
    gradYear: 2022,
    major: 'Civil Engineering',
    homeCity: 'Lubbock',
    relocationOpen: true,
    sectors: ['Affordable Housing'],
    avatar: [184, 169, 126],
    resume: `Mia Escobedo, Lubbock TX
Civil Engineering, Tarrant County College, 2022.
Experience: Housing finance intern: helped assemble 10 LIHTC applications.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: { status: 'trialing', periodEndDays: -2 }
  },
  {
    email: 'mei.rahman@example.org',
    expected: 'none',
    covers: 'active but the period ended yesterday: paywall',
    name: 'Mei Rahman',
    school: 'University of Houston',
    gradYear: 2026,
    major: 'Management Information Systems',
    homeCity: 'College Station',
    relocationOpen: false,
    sectors: ['Development'],
    avatar: [185, 141, 33],
    resume: `Mei Rahman, College Station TX
Management Information Systems, University of Houston, 2026.
Experience: Development intern: tracked entitlements and permitting for 33 sites.
Skills: entitlements, zoning, pro forma, GIS, site selection.`,
    subscription: { status: 'active', periodEndDays: -1 }
  },
  {
    email: 'lucia.whitaker@example.com',
    expected: 'none',
    covers: 'never subscribed, non-college: paywall',
    name: 'Lucía Whitaker',
    school: 'Dallas College',
    gradYear: 2022,
    major: 'Urban Planning',
    homeCity: 'El Paso',
    relocationOpen: false,
    sectors: ['Homebuilder', 'Property Mgmt', 'Asset Mgmt'],
    avatar: null,
    resume: `Lucía Whitaker, El Paso TX
Urban Planning, Dallas College, 2022.
Experience: Land intern at a homebuilder: lot pro formas and absorption research on 37 communities.
Experience: Leasing assistant at a 26-unit community: rent rolls, renewals, resident calls.
Experience: Asset management intern: monthly variance reports for 23 office buildings.
Skills: lot pro forma, land acquisition, absorption studies, Procore, Yardi, AppFolio, rent rolls, work orders, lease administration, variance reports, budgeting, Excel, NOI analysis, investor reporting.`,
    subscription: null
  },
  {
    email: 'dakota.abernathy@example.edu.au',
    expected: 'none',
    covers: 'look-alike ".edu.au" domain, no subscription',
    name: 'Dakota Abernathy',
    school: 'Tarrant County College',
    gradYear: 2025,
    major: 'Geography',
    homeCity: 'College Station',
    relocationOpen: true,
    sectors: ['Affordable Housing'],
    avatar: [83, 210, 100],
    resume: `Dakota Abernathy, College Station TX
Geography, Tarrant County College, 2025.
Experience: Housing finance intern: helped assemble 14 LIHTC applications.
Skills: LIHTC, compliance, HUD, tax credit applications, Excel.`,
    subscription: null
  },
  {
    email: 'ingrid.cardenas@edu-mail.example.com',
    expected: 'none',
    covers: 'look-alike "edu-mail" domain, no subscription',
    name: 'Ingrid Cárdenas',
    school: 'Dallas College',
    gradYear: 2026,
    major: null,
    homeCity: 'Houston',
    relocationOpen: false,
    sectors: ['Development'],
    avatar: [30, 20, 72],
    resume: `Ingrid Cárdenas, Houston TX
Undeclared, Dallas College, 2026.
Experience: Development intern: tracked entitlements and permitting for 28 sites.
Skills: entitlements, zoning, pro forma, GIS, site selection.`,
    subscription: null
  },
  {
    email: 'layla.patterson@example.org',
    expected: 'none',
    covers: 'never subscribed, no profile filled in, no resume',
    name: 'Layla Patterson',
    school: null,
    gradYear: null,
    major: null,
    homeCity: null,
    relocationOpen: false,
    sectors: [],
    avatar: null,
    resume: null,
    subscription: null
  }
];
