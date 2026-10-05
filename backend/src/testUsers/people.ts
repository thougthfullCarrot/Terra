/**
 * Fifty made-up website accounts for exercising sign-in gating, profiles,
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
  }
];
