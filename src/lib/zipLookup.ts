/**
 * Lightweight ZIP code → City, County, State lookup for supported states.
 * Only covers NY, NJ, CT, FL service areas.
 */

interface ZipInfo {
  city: string;
  county: string;
  state: string;
  stateCode: string;
}

// Primary ZIP3 ranges with fallback data
// Maps first 3 digits to approximate city/county for common areas
const ZIP3_MAP: Record<string, ZipInfo> = {
  // New York
  '100': { city: 'New York', county: 'New York County', state: 'New York', stateCode: 'NY' },
  '101': { city: 'New York', county: 'New York County', state: 'New York', stateCode: 'NY' },
  '102': { city: 'New York', county: 'New York County', state: 'New York', stateCode: 'NY' },
  '103': { city: 'Staten Island', county: 'Richmond County', state: 'New York', stateCode: 'NY' },
  '104': { city: 'Bronx', county: 'Bronx County', state: 'New York', stateCode: 'NY' },
  '105': { city: 'White Plains', county: 'Westchester County', state: 'New York', stateCode: 'NY' },
  '106': { city: 'White Plains', county: 'Westchester County', state: 'New York', stateCode: 'NY' },
  '107': { city: 'Yonkers', county: 'Westchester County', state: 'New York', stateCode: 'NY' },
  '108': { city: 'New Rochelle', county: 'Westchester County', state: 'New York', stateCode: 'NY' },
  '109': { city: 'Newburgh', county: 'Orange County', state: 'New York', stateCode: 'NY' },
  '110': { city: 'Garden City', county: 'Nassau County', state: 'New York', stateCode: 'NY' },
  '111': { city: 'Long Island City', county: 'Queens County', state: 'New York', stateCode: 'NY' },
  '112': { city: 'Brooklyn', county: 'Kings County', state: 'New York', stateCode: 'NY' },
  '113': { city: 'Flushing', county: 'Queens County', state: 'New York', stateCode: 'NY' },
  '114': { city: 'Jamaica', county: 'Queens County', state: 'New York', stateCode: 'NY' },
  '115': { city: 'Hempstead', county: 'Nassau County', state: 'New York', stateCode: 'NY' },
  '116': { city: 'Far Rockaway', county: 'Queens County', state: 'New York', stateCode: 'NY' },
  '117': { city: 'Brentwood', county: 'Suffolk County', state: 'New York', stateCode: 'NY' },
  '118': { city: 'Hicksville', county: 'Nassau County', state: 'New York', stateCode: 'NY' },
  '119': { city: 'Riverhead', county: 'Suffolk County', state: 'New York', stateCode: 'NY' },
  '120': { city: 'Albany', county: 'Albany County', state: 'New York', stateCode: 'NY' },
  '121': { city: 'Albany', county: 'Albany County', state: 'New York', stateCode: 'NY' },
  '122': { city: 'Albany', county: 'Albany County', state: 'New York', stateCode: 'NY' },
  '123': { city: 'Schenectady', county: 'Schenectady County', state: 'New York', stateCode: 'NY' },
  '124': { city: 'Kingston', county: 'Ulster County', state: 'New York', stateCode: 'NY' },
  '125': { city: 'Poughkeepsie', county: 'Dutchess County', state: 'New York', stateCode: 'NY' },
  '126': { city: 'Poughkeepsie', county: 'Dutchess County', state: 'New York', stateCode: 'NY' },
  '127': { city: 'Monticello', county: 'Sullivan County', state: 'New York', stateCode: 'NY' },
  '128': { city: 'Glens Falls', county: 'Warren County', state: 'New York', stateCode: 'NY' },
  '129': { city: 'Plattsburgh', county: 'Clinton County', state: 'New York', stateCode: 'NY' },
  '130': { city: 'Syracuse', county: 'Onondaga County', state: 'New York', stateCode: 'NY' },
  '131': { city: 'Syracuse', county: 'Onondaga County', state: 'New York', stateCode: 'NY' },
  '132': { city: 'Syracuse', county: 'Onondaga County', state: 'New York', stateCode: 'NY' },
  '133': { city: 'Utica', county: 'Oneida County', state: 'New York', stateCode: 'NY' },
  '134': { city: 'Utica', county: 'Oneida County', state: 'New York', stateCode: 'NY' },
  '135': { city: 'Utica', county: 'Oneida County', state: 'New York', stateCode: 'NY' },
  '136': { city: 'Watertown', county: 'Jefferson County', state: 'New York', stateCode: 'NY' },
  '137': { city: 'Binghamton', county: 'Broome County', state: 'New York', stateCode: 'NY' },
  '138': { city: 'Binghamton', county: 'Broome County', state: 'New York', stateCode: 'NY' },
  '139': { city: 'Binghamton', county: 'Broome County', state: 'New York', stateCode: 'NY' },
  '140': { city: 'Buffalo', county: 'Erie County', state: 'New York', stateCode: 'NY' },
  '141': { city: 'Buffalo', county: 'Erie County', state: 'New York', stateCode: 'NY' },
  '142': { city: 'Buffalo', county: 'Erie County', state: 'New York', stateCode: 'NY' },
  '143': { city: 'Niagara Falls', county: 'Niagara County', state: 'New York', stateCode: 'NY' },
  '144': { city: 'Rochester', county: 'Monroe County', state: 'New York', stateCode: 'NY' },
  '145': { city: 'Rochester', county: 'Monroe County', state: 'New York', stateCode: 'NY' },
  '146': { city: 'Rochester', county: 'Monroe County', state: 'New York', stateCode: 'NY' },
  '147': { city: 'Jamestown', county: 'Chautauqua County', state: 'New York', stateCode: 'NY' },
  '148': { city: 'Elmira', county: 'Chemung County', state: 'New York', stateCode: 'NY' },
  '149': { city: 'Elmira', county: 'Chemung County', state: 'New York', stateCode: 'NY' },

  // New Jersey
  '070': { city: 'Newark', county: 'Essex County', state: 'New Jersey', stateCode: 'NJ' },
  '071': { city: 'Newark', county: 'Essex County', state: 'New Jersey', stateCode: 'NJ' },
  '072': { city: 'Elizabeth', county: 'Union County', state: 'New Jersey', stateCode: 'NJ' },
  '073': { city: 'Jersey City', county: 'Hudson County', state: 'New Jersey', stateCode: 'NJ' },
  '074': { city: 'Paterson', county: 'Passaic County', state: 'New Jersey', stateCode: 'NJ' },
  '075': { city: 'Paterson', county: 'Passaic County', state: 'New Jersey', stateCode: 'NJ' },
  '076': { city: 'Hackensack', county: 'Bergen County', state: 'New Jersey', stateCode: 'NJ' },
  '077': { city: 'Freehold', county: 'Monmouth County', state: 'New Jersey', stateCode: 'NJ' },
  '078': { city: 'Dover', county: 'Morris County', state: 'New Jersey', stateCode: 'NJ' },
  '079': { city: 'Morristown', county: 'Morris County', state: 'New Jersey', stateCode: 'NJ' },
  '080': { city: 'Camden', county: 'Camden County', state: 'New Jersey', stateCode: 'NJ' },
  '081': { city: 'Camden', county: 'Camden County', state: 'New Jersey', stateCode: 'NJ' },
  '082': { city: 'Atlantic City', county: 'Atlantic County', state: 'New Jersey', stateCode: 'NJ' },
  '083': { city: 'Vineland', county: 'Cumberland County', state: 'New Jersey', stateCode: 'NJ' },
  '084': { city: 'Atlantic City', county: 'Atlantic County', state: 'New Jersey', stateCode: 'NJ' },
  '085': { city: 'Trenton', county: 'Mercer County', state: 'New Jersey', stateCode: 'NJ' },
  '086': { city: 'Trenton', county: 'Mercer County', state: 'New Jersey', stateCode: 'NJ' },
  '087': { city: 'Toms River', county: 'Ocean County', state: 'New Jersey', stateCode: 'NJ' },
  '088': { city: 'New Brunswick', county: 'Middlesex County', state: 'New Jersey', stateCode: 'NJ' },
  '089': { city: 'New Brunswick', county: 'Middlesex County', state: 'New Jersey', stateCode: 'NJ' },

  // Connecticut
  '060': { city: 'Hartford', county: 'Hartford County', state: 'Connecticut', stateCode: 'CT' },
  '061': { city: 'Hartford', county: 'Hartford County', state: 'Connecticut', stateCode: 'CT' },
  '062': { city: 'Willimantic', county: 'Windham County', state: 'Connecticut', stateCode: 'CT' },
  '063': { city: 'New London', county: 'New London County', state: 'Connecticut', stateCode: 'CT' },
  '064': { city: 'New Haven', county: 'New Haven County', state: 'Connecticut', stateCode: 'CT' },
  '065': { city: 'New Haven', county: 'New Haven County', state: 'Connecticut', stateCode: 'CT' },
  '066': { city: 'Bridgeport', county: 'Fairfield County', state: 'Connecticut', stateCode: 'CT' },
  '067': { city: 'Waterbury', county: 'New Haven County', state: 'Connecticut', stateCode: 'CT' },
  '068': { city: 'Stamford', county: 'Fairfield County', state: 'Connecticut', stateCode: 'CT' },
  '069': { city: 'Stamford', county: 'Fairfield County', state: 'Connecticut', stateCode: 'CT' },

  // Florida
  '320': { city: 'St. Augustine', county: 'St. Johns County', state: 'Florida', stateCode: 'FL' },
  '321': { city: 'Daytona Beach', county: 'Volusia County', state: 'Florida', stateCode: 'FL' },
  '322': { city: 'Jacksonville', county: 'Duval County', state: 'Florida', stateCode: 'FL' },
  '323': { city: 'Tallahassee', county: 'Leon County', state: 'Florida', stateCode: 'FL' },
  '324': { city: 'Panama City', county: 'Bay County', state: 'Florida', stateCode: 'FL' },
  '325': { city: 'Pensacola', county: 'Escambia County', state: 'Florida', stateCode: 'FL' },
  '326': { city: 'Gainesville', county: 'Alachua County', state: 'Florida', stateCode: 'FL' },
  '327': { city: 'Orlando', county: 'Seminole County', state: 'Florida', stateCode: 'FL' },
  '328': { city: 'Orlando', county: 'Orange County', state: 'Florida', stateCode: 'FL' },
  '329': { city: 'Melbourne', county: 'Brevard County', state: 'Florida', stateCode: 'FL' },
  '330': { city: 'Hialeah', county: 'Miami-Dade County', state: 'Florida', stateCode: 'FL' },
  '331': { city: 'Miami', county: 'Miami-Dade County', state: 'Florida', stateCode: 'FL' },
  '332': { city: 'Miami', county: 'Miami-Dade County', state: 'Florida', stateCode: 'FL' },
  '333': { city: 'Fort Lauderdale', county: 'Broward County', state: 'Florida', stateCode: 'FL' },
  '334': { city: 'West Palm Beach', county: 'Palm Beach County', state: 'Florida', stateCode: 'FL' },
  '335': { city: 'Tampa', county: 'Hillsborough County', state: 'Florida', stateCode: 'FL' },
  '336': { city: 'Tampa', county: 'Hillsborough County', state: 'Florida', stateCode: 'FL' },
  '337': { city: 'St. Petersburg', county: 'Pinellas County', state: 'Florida', stateCode: 'FL' },
  '338': { city: 'Lakeland', county: 'Polk County', state: 'Florida', stateCode: 'FL' },
  '339': { city: 'Fort Myers', county: 'Lee County', state: 'Florida', stateCode: 'FL' },
  '341': { city: 'Naples', county: 'Collier County', state: 'Florida', stateCode: 'FL' },
  '342': { city: 'Sarasota', county: 'Sarasota County', state: 'Florida', stateCode: 'FL' },
  '344': { city: 'Ocala', county: 'Marion County', state: 'Florida', stateCode: 'FL' },
  '346': { city: 'Spring Hill', county: 'Hernando County', state: 'Florida', stateCode: 'FL' },
  '347': { city: 'Kissimmee', county: 'Osceola County', state: 'Florida', stateCode: 'FL' },
  '349': { city: 'Port St. Lucie', county: 'St. Lucie County', state: 'Florida', stateCode: 'FL' },
};

const SUPPORTED_STATE_CODES = ['NY', 'NJ', 'CT', 'FL'];

export function lookupZip(zip: string): ZipInfo | null {
  const clean = zip.replace(/\D/g, '').slice(0, 5);
  if (clean.length < 5) return null;

  // Try full 5-digit match first (for more precision)
  const zip3 = clean.slice(0, 3);
  const info = ZIP3_MAP[zip3];

  if (!info) return null;
  return info;
}

export function isSupportedZip(zip: string): boolean {
  const info = lookupZip(zip);
  if (!info) return false;
  return SUPPORTED_STATE_CODES.includes(info.stateCode);
}

export function getZipInfo(zip: string): { city: string; county: string; state: string; stateCode: string; supported: boolean } | null {
  const info = lookupZip(zip);
  if (!info) return null;
  return { ...info, supported: SUPPORTED_STATE_CODES.includes(info.stateCode) };
}
