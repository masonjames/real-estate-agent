/**
 * Property Search Integration
 *
 * This module handles searching for property information from various sources.
 * Supports Manatee County PAO via Firecrawl web scraping, with Exa AI fallback
 * for finding parcel IDs when form-based search fails.
 */

import {
  extractManateePaoPropertyPlaywright,
  scrapeManateePaoPropertyByAddressPlaywright,
} from "./pao/manatee-pao.playwright";
import { PlaywrightError } from "./playwright/browser";
import { getExaClient } from "./exa";
import { normalizeAddressForPao } from "./address/normalize";

// DEPRECATED: Firecrawl imports kept for legacy function compatibility
// These functions are no longer used in the main search flow (now using Playwright)
// TODO: Remove these imports and legacy functions in a future cleanup
import {
  scrapeUrl,
  extractFromUrl,
  buildSearchActions,
  buildManateePaoSearchActions,
} from "./firecrawl";

// Value breakdown for assessments (land, building, extras, total)
export interface ValueBreakdown {
  land?: number;
  building?: number;
  extraFeatures?: number;
  total?: number;
}

// Valuation record for a specific tax year
export interface ValuationRecord {
  year?: number;
  just?: ValueBreakdown;       // Just/Market value
  assessed?: ValueBreakdown;   // Assessed value
  taxable?: ValueBreakdown;    // Taxable value
  adValoremTaxes?: number;
  nonAdValoremTaxes?: number;
}

// Sale transaction record
export interface SaleRecord {
  date?: string;
  price?: number;
  deedType?: string;           // QC, WD, etc.
  instrumentNumber?: string;
  bookPage?: string;
  grantor?: string;
  grantee?: string;
  qualified?: boolean;
  vacantOrImproved?: string;   // V or I
  qualificationCode?: string;
}

// Extra feature record from PAO
export interface ExtraFeatureRecord {
  description: string;
  year?: number;
  areaSqFt?: number;
  value?: number;
}

// Inspection record from PAO
export interface InspectionRecord {
  date?: string;
  inspector?: string;
  type?: string;
  result?: string;
  notes?: string;
}

// Basic property identification info
export interface PropertyBasicInfo {
  accountNumber?: string;
  useCode?: string;
  useDescription?: string;
  situsAddress?: string;
  mailingAddress?: string;
  subdivision?: string;
  neighborhood?: string;
  municipality?: string;
  jurisdiction?: string;
  taxDistrict?: string;
  sectionTownshipRange?: string;
  legalDescription?: string;
  shortDescription?: string;
  homesteadExemption?: boolean;
  femaValue?: number;
  ownerType?: string;      // e.g., "TRUSTEE", "INDIVIDUAL", "CORPORATION"
  livingUnits?: number;    // Number of living units on property
}

// Building/structure details
export interface PropertyBuilding {
  yearBuilt?: number;
  effectiveYearBuilt?: number;
  livingAreaSqFt?: number;
  totalAreaSqFt?: number;      // Under roof
  bedrooms?: number;
  bathrooms?: number;
  fullBathrooms?: number;
  halfBathrooms?: number;
  stories?: number;
  units?: number;              // Living units

  // Construction details
  constructionType?: string;
  foundation?: string;
  exteriorWalls?: string;
  roofCover?: string;
  roofStructure?: string;
  interiorFinish?: string;
  flooring?: string;

  // Systems
  heating?: string;
  cooling?: string;
  electricUtility?: boolean;
  waterSource?: string;
  sewerType?: string;

  // Garage
  garage?: {
    type?: string;
    spaces?: number;
    areaSqFt?: number;
  };

  // Pool
  pool?: {
    hasPool?: boolean;
    type?: string;
    areaSqFt?: number;
  };

  // Room features (MLS-style)
  primaryBedroom?: {
    features?: string[];
    level?: string;
  };
  kitchen?: {
    features?: string[];
    level?: string;
  };
  livingRoom?: {
    features?: string[];
    level?: string;
  };

  // Appliances
  appliances?: string[];
  laundryLocation?: string;

  // Interior features
  interiorFeatures?: string[];
  hasFireplace?: boolean;
}

// Land parcel details
export interface PropertyLand {
  lotSizeSqFt?: number;
  lotSizeAcres?: number;
  landUse?: string;
  landUseCode?: string;
  frontageFt?: number;
  depthFt?: number;
  dimensions?: string;
  roadSurfaceType?: string;
}

// Community and HOA information
export interface PropertyCommunity {
  subdivisionName?: string;
  hasHoa?: boolean;
  hoaFee?: number;
  hoaFeeFrequency?: string;    // monthly, quarterly, annual
  petFee?: number;
  petFeeFrequency?: string;
  amenities?: string[];
}

// MLS-style listing information
export interface PropertyListing {
  pricePerSqFt?: number;
  dateOnMarket?: string;
  cumulativeDaysOnMarket?: number;
  ownershipType?: string;      // Fee Simple, etc.
  totalActualRent?: number;
  newConstruction?: boolean;
  propertySubtype?: string;    // Single Family Residence, etc.
}

// Feature tags for display
export interface PropertyExtras {
  features?: string[];         // MLS-style feature chips
  paoExtraFeatures?: ExtraFeatureRecord[];
  inspections?: InspectionRecord[];
}

export interface PropertyDetails {
  // Core identification (backward compatible)
  parcelId?: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  owner?: string;
  ownerType?: string;
  propertyType?: string;

  // Summary fields (backward compatible - derived from rich data)
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: string;
  assessedValue?: number;
  marketValue?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  taxAmount?: number;
  zoning?: string;
  legal?: string;

  // Rich nested data groups
  basicInfo?: PropertyBasicInfo;
  valuations?: ValuationRecord[];
  building?: PropertyBuilding;
  land?: PropertyLand;
  salesHistory?: SaleRecord[];
  community?: PropertyCommunity;
  listing?: PropertyListing;
  extras?: PropertyExtras;

  // Raw data for debugging
  rawData?: Record<string, unknown>;
}

export interface PropertySearchResult {
  success: boolean;
  property?: PropertyDetails;
  error?: string;
  source: "manatee_pao" | "zillow" | "realtor" | "manual";
}

// DEPRECATED: Schema for Firecrawl LLM extraction (legacy code)
// The Playwright implementation uses Cheerio for deterministic HTML parsing.
// See src/lib/pao/manatee-pao.playwright.ts for the new implementation.
// TODO: Remove this schema and related legacy functions in a future cleanup
const PROPERTY_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    // Core identification
    parcelId: {
      type: "string",
      description: "The parcel ID, account number, or folio number",
    },
    situsAddress: {
      type: "string",
      description: "The property street address (situs address)",
    },
    city: {
      type: "string",
      description: "City name",
    },
    state: {
      type: "string",
      description: "State abbreviation (e.g., FL)",
    },
    zipCode: {
      type: "string",
      description: "ZIP code",
    },
    owner: {
      type: "string",
      description: "Property owner name(s) including all listed owners and FKA names",
    },
    ownerType: {
      type: "string",
      description: "Owner type (e.g., INDIVIDUAL & JOINT TENANCY & RIGHTS OF SURVIVORSHIP)",
    },
    propertyType: {
      type: "string",
      description: "Property type or land use description (e.g., SINGLE FAMILY RESIDENTIAL)",
    },

    // Basic info section
    basicInfo: {
      type: "object",
      description: "Basic property identification information",
      properties: {
        mailingAddress: { type: "string", description: "Owner mailing address" },
        jurisdiction: { type: "string", description: "Jurisdiction (e.g., CITY OF BRADENTON)" },
        taxDistrict: { type: "string", description: "Tax district code and name" },
        sectionTownshipRange: { type: "string", description: "Sec/Twp/Rge (e.g., 36-34S-17E)" },
        neighborhood: { type: "string", description: "Neighborhood code and description" },
        subdivision: { type: "string", description: "Subdivision name and details" },
        shortDescription: { type: "string", description: "Short legal description" },
        legalDescription: { type: "string", description: "Full legal description" },
        useCode: { type: "string", description: "Land use code (e.g., 0100)" },
        useDescription: { type: "string", description: "Land use description" },
        femaValue: { type: "number", description: "FEMA value in dollars" },
        homesteadExemption: { type: "boolean", description: "Whether property has homestead exemption" },
      },
    },

    // Valuations by year
    valuations: {
      type: "array",
      description: "Property valuations by tax year from the Values table",
      items: {
        type: "object",
        properties: {
          year: { type: "number", description: "Tax year (January 1)" },
          landValue: { type: "number", description: "Land value" },
          improvementsValue: { type: "number", description: "Improvements/building value" },
          justMarketValue: { type: "number", description: "Just/Market value total" },
          nonSchoolAssessed: { type: "number", description: "Non-school assessed value" },
          schoolAssessed: { type: "number", description: "School assessed value" },
          countyTaxable: { type: "number", description: "County taxable value" },
          schoolTaxable: { type: "number", description: "School taxable value" },
          municipalityTaxable: { type: "number", description: "Municipality taxable value" },
          indSpcDistTaxable: { type: "number", description: "Independent special district taxable value" },
          adValoremTaxes: { type: "number", description: "Ad valorem taxes amount" },
          nonAdValoremTaxes: { type: "number", description: "Non-ad valorem taxes amount" },
          homesteadExemption: { type: "boolean", description: "Whether homestead exemption applies" },
        },
      },
    },

    // Building details
    building: {
      type: "object",
      description: "Building and structure details",
      properties: {
        yearBuilt: { type: "number", description: "Year building was constructed" },
        effectiveYearBuilt: { type: "number", description: "Effective year built" },
        livingAreaSqFt: { type: "number", description: "Living or business area square footage" },
        totalAreaSqFt: { type: "number", description: "Total area under roof square footage" },
        residentialImperviousSqFt: { type: "number", description: "Residential impervious area" },
        bedrooms: { type: "number", description: "Number of bedrooms" },
        bathrooms: { type: "number", description: "Total number of bathrooms" },
        fullBathrooms: { type: "number", description: "Number of full bathrooms" },
        halfBathrooms: { type: "number", description: "Number of half bathrooms" },
        stories: { type: "number", description: "Number of stories" },
        units: { type: "number", description: "Number of living units" },
        constructionType: { type: "string", description: "Construction type (e.g., Block, Concrete)" },
        foundation: { type: "string", description: "Foundation type (e.g., Slab)" },
        exteriorWalls: { type: "string", description: "Exterior wall materials" },
        roofCover: { type: "string", description: "Roof covering (e.g., Shingle)" },
        roofStructure: { type: "string", description: "Roof structure type" },
        flooring: { type: "string", description: "Flooring types (e.g., Ceramic Tile, Laminate)" },
        heating: { type: "string", description: "Heating system (e.g., Heat Pump)" },
        cooling: { type: "string", description: "Cooling system (e.g., Central Air)" },
        electricUtility: { type: "boolean", description: "Whether electric utility is on property" },
        appliances: {
          type: "array",
          items: { type: "string" },
          description: "List of appliances (e.g., Convection Oven, Refrigerator)",
        },
        laundryLocation: { type: "string", description: "Laundry location (e.g., In Garage)" },
        interiorFeatures: {
          type: "array",
          items: { type: "string" },
          description: "Interior features list",
        },
        hasFireplace: { type: "boolean", description: "Whether property has fireplace" },
        hasPool: { type: "boolean", description: "Whether property has pool" },
        poolType: { type: "string", description: "Pool type if present" },
        hasGarage: { type: "boolean", description: "Whether property has garage" },
        garageSpaces: { type: "number", description: "Number of garage spaces" },
        garageType: { type: "string", description: "Garage type" },
      },
    },

    // Land details
    land: {
      type: "object",
      description: "Land parcel information",
      properties: {
        lotSizeSqFt: { type: "number", description: "Lot size in square feet" },
        lotSizeAcres: { type: "number", description: "Lot size in acres" },
        landUseCode: { type: "string", description: "DOR land use code" },
        landUse: { type: "string", description: "Land use description" },
        zoningFloodInfo: { type: "string", description: "Zoning and flood zone information" },
        roadSurfaceType: { type: "string", description: "Road surface type (e.g., Paved)" },
        frontageFt: { type: "number", description: "Lot frontage in feet" },
        depthFt: { type: "number", description: "Lot depth in feet" },
      },
    },

    // Sales history
    salesHistory: {
      type: "array",
      description: "Property sales history from Sales table",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "Sale date (MM/DD/YYYY)" },
          bookPage: { type: "string", description: "Book/Page reference" },
          instrumentNumber: { type: "string", description: "Instrument number" },
          instrumentType: { type: "string", description: "Instrument type (QC, WD, DE, FJ, etc.)" },
          vacantOrImproved: { type: "string", description: "V for vacant, I for improved" },
          qualificationCode: { type: "string", description: "Sale qualification code" },
          price: { type: "number", description: "Sale price in dollars" },
          grantee: { type: "string", description: "Buyer/Grantee name" },
          grantor: { type: "string", description: "Seller/Grantor name if available" },
        },
      },
    },

    // Community/HOA info
    community: {
      type: "object",
      description: "Community and HOA information",
      properties: {
        subdivisionName: { type: "string", description: "Subdivision name" },
        hasHoa: { type: "boolean", description: "Whether property has HOA" },
        hoaFee: { type: "number", description: "HOA fee amount" },
        hoaFeeFrequency: { type: "string", description: "HOA fee frequency (monthly, annual)" },
        petFee: { type: "number", description: "Pet fee amount" },
        petFeeFrequency: { type: "string", description: "Pet fee frequency" },
      },
    },

    // MLS-style listing info (if available from cross-referencing)
    listing: {
      type: "object",
      description: "MLS listing information if available",
      properties: {
        pricePerSqFt: { type: "number", description: "Price per square foot" },
        dateOnMarket: { type: "string", description: "Date property was listed" },
        cumulativeDaysOnMarket: { type: "number", description: "Total days on market" },
        ownershipType: { type: "string", description: "Ownership type (e.g., Fee Simple)" },
        newConstruction: { type: "boolean", description: "Whether new construction" },
        propertySubtype: { type: "string", description: "Property subtype" },
      },
    },

    // Extra features
    extras: {
      type: "object",
      description: "Extra features and PAO feature records",
      properties: {
        features: {
          type: "array",
          items: { type: "string" },
          description: "MLS-style feature tags",
        },
        paoExtraFeatures: {
          type: "array",
          description: "PAO extra features from Features section",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              year: { type: "number" },
              areaSqFt: { type: "number" },
              value: { type: "number" },
            },
          },
        },
      },
    },
  },
  required: ["situsAddress"],
};

// Type matching the extraction schema
type ExtractedPropertyData = {
  parcelId?: string;
  situsAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  owner?: string;
  ownerType?: string;
  propertyType?: string;

  basicInfo?: {
    accountNumber?: string;
    mailingAddress?: string;
    jurisdiction?: string;
    taxDistrict?: string;
    sectionTownshipRange?: string;
    neighborhood?: string;
    subdivision?: string;
    shortDescription?: string;
    legalDescription?: string;
    useCode?: string;
    useDescription?: string;
    femaValue?: number;
    homesteadExemption?: boolean;
    municipality?: string;
  };

  valuations?: Array<{
    year?: number;
    landValue?: number;
    improvementsValue?: number;
    justMarketValue?: number;
    nonSchoolAssessed?: number;
    schoolAssessed?: number;
    countyTaxable?: number;
    schoolTaxable?: number;
    municipalityTaxable?: number;
    indSpcDistTaxable?: number;
    adValoremTaxes?: number;
    nonAdValoremTaxes?: number;
    homesteadExemption?: boolean;
  }>;

  building?: {
    yearBuilt?: number;
    effectiveYearBuilt?: number;
    livingAreaSqFt?: number;
    totalAreaSqFt?: number;
    residentialImperviousSqFt?: number;
    bedrooms?: number;
    bathrooms?: number;
    fullBathrooms?: number;
    halfBathrooms?: number;
    stories?: number;
    units?: number;
    constructionType?: string;
    foundation?: string;
    exteriorWalls?: string;
    roofCover?: string;
    roofStructure?: string;
    flooring?: string;
    heating?: string;
    cooling?: string;
    electricUtility?: boolean;
    appliances?: string[];
    laundryLocation?: string;
    interiorFeatures?: string[];
    hasFireplace?: boolean;
    hasPool?: boolean;
    poolType?: string;
    hasGarage?: boolean;
    garageSpaces?: number;
    garageType?: string;
  };

  land?: {
    lotSizeSqFt?: number;
    lotSizeAcres?: number;
    landUseCode?: string;
    landUse?: string;
    zoningFloodInfo?: string;
    roadSurfaceType?: string;
    frontageFt?: number;
    depthFt?: number;
  };

  salesHistory?: Array<{
    date?: string;
    bookPage?: string;
    instrumentNumber?: string;
    instrumentType?: string;
    vacantOrImproved?: string;
    qualificationCode?: string;
    price?: number;
    grantee?: string;
    grantor?: string;
  }>;

  community?: {
    subdivisionName?: string;
    hasHoa?: boolean;
    hoaFee?: number;
    hoaFeeFrequency?: string;
    petFee?: number;
    petFeeFrequency?: string;
  };

  listing?: {
    pricePerSqFt?: number;
    dateOnMarket?: string;
    cumulativeDaysOnMarket?: number;
    ownershipType?: string;
    newConstruction?: boolean;
    propertySubtype?: string;
  };

  extras?: {
    features?: string[];
    paoExtraFeatures?: Array<{
      description: string;
      year?: number;
      areaSqFt?: number;
      value?: number;
    }>;
  };
};

/**
 * Search Manatee County Property Appraiser's Office using Playwright
 *
 * Uses the single-session orchestrator to efficiently:
 * 1. Search for the property by address
 * 2. Extract ALL data (iframe + main page JavaScript sections) in one browser session
 *
 * Falls back to Exa AI for parcel ID lookup if direct search fails.
 */
export async function searchManateePAO(
  address: string
): Promise<PropertySearchResult> {
  // Validate address input
  if (!address || !address.trim()) {
    console.error("[PAO Search] Invalid address: empty or undefined");
    return {
      success: false,
      error: "Address is required",
      source: "manatee_pao",
    };
  }

  const cleanAddress = address.trim();

  // Normalize the address to USPS standard abbreviations
  // This fixes common issues like "Terrace" → "Ter", "Boulevard" → "Blvd"
  const normalized = normalizeAddressForPao(cleanAddress);
  const searchAddress = normalized.normalizedFull;

  if (normalized.wasNormalized) {
    console.log(`[PAO Search] Address normalized: "${cleanAddress}" → "${searchAddress}"`);
    console.log(`[PAO Search] Normalizations applied: ${normalized.normalizations.join(", ")}`);
  }

  console.log(`[PAO Search] Starting Playwright-based search for: "${searchAddress}"`);

  try {
    // Use the single-session orchestrator for complete data extraction
    // Extracts owner info + main page tabs (Sales, Values, Buildings, Features, Inspections)
    // Use the normalized address for PAO search
    const scrapeResult = await scrapeManateePaoPropertyByAddressPlaywright(searchAddress);

    let { detailUrl, scraped } = scrapeResult;
    const { debug } = scrapeResult;

    // If orchestrator didn't find the property, try Exa AI fallback for parcel ID
    if (!detailUrl) {
      console.log("[PAO Search] Orchestrator search returned no results, trying Exa AI fallback...");
      // Use normalized address for Exa search as well
      const exaParcelId = await findParcelIdViaExa(searchAddress);
      if (exaParcelId) {
        detailUrl = `https://www.manateepao.gov/parcel/?parid=${exaParcelId}`;
        console.log(`[PAO Search] Found parcel ID via Exa: ${exaParcelId}`);

        // Use extraction for Exa-found URLs (separate browser session)
        const extractResult = await extractManateePaoPropertyPlaywright(detailUrl);
        scraped = extractResult.scraped;
      }
    }

    if (!detailUrl) {
      console.log("[PAO Search] No matching property found for this address");
      console.log("[PAO Search] Debug info:", debug);

      // Use original address in user-facing error message
      let errorMessage = `Property not found at "${cleanAddress}". `;
      errorMessage += "The address was not found in Manatee County Property Appraiser records. ";
      errorMessage += "Please verify: (1) The address is in Manatee County, FL, ";
      errorMessage += "(2) The street name and number are correct, ";
      errorMessage += "(3) The property is not a new construction pending registration.";

      return {
        success: false,
        error: errorMessage,
        source: "manatee_pao",
      };
    }

    // Verify we got meaningful data
    if (!scraped || (!scraped.parcelId && !scraped.owner && !scraped.address)) {
      console.error("[PAO Search] Failed to extract meaningful property data");
      console.error("[PAO Search] Debug info:", debug);
      return {
        success: false,
        error: `Could not extract property details from ${detailUrl}. The property page may have an unexpected format or the service may be temporarily unavailable.`,
        source: "manatee_pao",
      };
    }

    // Validate that extracted address matches searched address
    // Use normalized address for comparison since PAO returns USPS-formatted addresses
    const extractedAddress = (scraped.address || "").toLowerCase();
    const searchedParts = parseAddress(searchAddress);
    const searchedStreetNumber = (searchedParts.street || "").split(/\s+/)[0];
    const searchedStreetName = (searchedParts.street || "").split(/\s+/).slice(1).join(" ").toLowerCase();

    const addressMatches =
      extractedAddress.includes(searchedStreetNumber) &&
      searchedStreetName.split(" ").some(part =>
        part.length > 2 && extractedAddress.includes(part)
      );

    if (!addressMatches && extractedAddress && extractedAddress !== cleanAddress.toLowerCase()) {
      console.error(`[PAO Search] Address mismatch! Searched for "${cleanAddress}" but extracted "${scraped.address}"`);
      return {
        success: false,
        error: `Address verification failed. Searched for "${cleanAddress}" but the property page returned data for "${scraped.address}". Please verify the address and try again.`,
        source: "manatee_pao",
      };
    }

    // Normalize and validate the extracted data
    const property = normalizePropertyDetails(cleanAddress, scraped, { detailUrl });

    console.log(`[PAO Search] Successfully extracted property data:`, {
      parcelId: property.parcelId,
      valuations: property.valuations?.length || 0,
      salesHistory: property.salesHistory?.length || 0,
      extraFeatures: property.extras?.paoExtraFeatures?.length || 0,
      inspections: property.extras?.inspections?.length || 0,
    });

    return {
      success: true,
      property,
      source: "manatee_pao",
    };
  } catch (error) {
    console.error("[PAO Search] Error during property search:", error);

    // Handle Playwright-specific errors
    if (error instanceof PlaywrightError) {
      if (error.code === "BLOCKED") {
        return {
          success: false,
          error: "The property search service detected automated access. Please try again later or contact support.",
          source: "manatee_pao",
        };
      }
      if (error.code === "TIMEOUT") {
        return {
          success: false,
          error: "Property search timed out. The Manatee County website may be slow. Please try again.",
          source: "manatee_pao",
        };
      }
      if (error.code === "BROWSER_LAUNCH_FAILED") {
        return {
          success: false,
          error: "Property search service is temporarily unavailable. Please try again later.",
          source: "manatee_pao",
        };
      }
    }

    // Detect rate limiting
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit") || errorMessage.toLowerCase().includes("too many requests")) {
      return {
        success: false,
        error: "Property search rate limit exceeded. Please wait a few minutes and try again.",
        source: "manatee_pao",
      };
    }

    // Detect timeout
    if (errorMessage.toLowerCase().includes("timeout") || errorMessage.toLowerCase().includes("timed out")) {
      return {
        success: false,
        error: "Property search timed out. The Manatee County website may be slow. Please try again.",
        source: "manatee_pao",
      };
    }

    return {
      success: false,
      error: `Property search failed: ${errorMessage}. Please try again or contact support if the problem persists.`,
      source: "manatee_pao",
    };
  }
}

/**
 * Find the property detail page URL by searching the PAO site
 * Uses multiple strategies to find the best matching property
 */
async function findManateePaoDetailUrlByAddress(address: string): Promise<{
  detailUrl: string | null;
  debug?: Record<string, unknown>;
}> {
  const searchUrl = "https://www.manateepao.gov/search/";
  const parsedAddress = parseAddress(address);

  console.log("Parsed address for PAO search:", parsedAddress);

  // Strategy 1: Use the advanced multi-field PAO search form
  const paoActions = buildManateePaoSearchActions({
    situsAddress: parsedAddress.street,
    city: parsedAddress.city,
    zipCode: parsedAddress.zipCode,
    useWildcards: true,
  });

  let result = await scrapeUrl(searchUrl, {
    formats: ["markdown", "links", "html"],
    onlyMainContent: false,
    timeout: 60000,
    actions: paoActions,
  });

  if (!result.success || !result.data) {
    console.log("Strategy 1 (multi-field) failed, trying simple search...");

    // Strategy 2: Fallback to simple text search
    const simpleActions = buildSearchActions(
      address,
      'input[type="search"], input[name="search"], input[placeholder*="Search"], #searchInput, .search-input, input[type="text"]',
      'button[type="submit"], .search-button, input[type="submit"]'
    );

    result = await scrapeUrl(searchUrl, {
      formats: ["markdown", "links", "html"],
      onlyMainContent: false,
      timeout: 45000,
      actions: simpleActions,
    });
  }

  if (!result.success || !result.data) {
    console.error("Failed to scrape PAO search page:", result.error);
    return { detailUrl: null, debug: { error: result.error, strategy: "both_failed" } };
  }

  // Try to find property detail links from the response
  const { url: detailUrl, addressFound } = findBestPropertyDetailUrl(
    result.data.links || [],
    result.data.markdown || "",
    result.data.html || "",
    address
  );

  // Strategy 3: If no direct detail URL found, look for parcel IDs in the results
  // and construct the URL directly
  let finalUrl = detailUrl;
  if (!finalUrl) {
    const parcelId = extractParcelIdFromResults(result.data.markdown || "", result.data.html || "");
    if (parcelId) {
      finalUrl = `https://www.manateepao.gov/parcel/?parcel=${parcelId}`;
      console.log(`Constructed detail URL from parcel ID: ${finalUrl}`);
    }
  }

  // IMPORTANT: If we have a URL but the address wasn't found in results,
  // we're likely about to scrape the wrong property. Return null to trigger fallback.
  if (finalUrl && !addressFound) {
    console.warn(`[PAO Search] ⚠️ Rejecting URL because searched address was not found in results`);
    console.warn(`[PAO Search] This prevents scraping wrong property data`);
    finalUrl = null;
  }

  // Strategy 4: If form-based search failed, try Exa AI to find the parcel ID
  if (!finalUrl) {
    console.log("[PAO Search] Form-based search failed, trying Exa AI to find parcel ID...");
    const exaParcelId = await findParcelIdViaExa(address);
    if (exaParcelId) {
      finalUrl = `https://www.manateepao.gov/parcel/?parid=${exaParcelId}`;
      console.log(`[PAO Search] Found parcel ID via Exa: ${exaParcelId}, URL: ${finalUrl}`);
      return {
        detailUrl: finalUrl,
        debug: {
          linksFound: result.data.links?.length || 0,
          markdownLength: result.data.markdown?.length || 0,
          parsedAddress,
          addressFound: true, // Exa found a match
          strategy: "exa_ai",
        },
      };
    }
  }

  return {
    detailUrl: finalUrl,
    debug: {
      linksFound: result.data.links?.length || 0,
      markdownLength: result.data.markdown?.length || 0,
      parsedAddress,
      addressFound,
    },
  };
}

/**
 * Use Exa AI to find the parcel ID for an address
 * Searches Exa's indexed data for Manatee County PAO pages
 */
async function findParcelIdViaExa(address: string): Promise<string | null> {
  try {
    // Search for the address on manateepao.gov using Exa
    const query = `site:manateepao.gov ${address} parcel`;
    console.log(`[Exa Search] Searching for: ${query}`);

    const response = await getExaClient().searchAndContents(query, {
      type: "auto",
      numResults: 5,
      text: { maxCharacters: 3000 },
      useAutoprompt: false,
    });

    if (!response.results || response.results.length === 0) {
      console.log("[Exa Search] No results found");
      return null;
    }

    console.log(`[Exa Search] Found ${response.results.length} results`);

    // Parse the address to extract key parts for matching
    const parsedAddress = parseAddress(address);
    const streetNumber = (parsedAddress.street || "").split(/\s+/)[0];
    const streetNameParts = (parsedAddress.street || "").split(/\s+/).slice(1);
    const streetName = streetNameParts.join(" ").toLowerCase();

    // Look through results for parcel IDs and address matches
    for (const result of response.results) {
      const url = result.url || "";
      const text = (result.text || "").toLowerCase();
      const title = (result.title || "").toLowerCase();

      // Check if this result mentions our address
      const hasStreetNumber = text.includes(streetNumber) || title.includes(streetNumber);
      const hasStreetName = streetName.split(" ").some(part =>
        part.length > 2 && (text.includes(part) || title.includes(part))
      );

      if (!hasStreetNumber && !hasStreetName) {
        continue; // Skip results that don't mention our address
      }

      // Try to extract parcel ID from URL
      // URL formats:
      // - https://www.manateepao.gov/parcel/?parid=1123702559
      // - https://www.manateepao.gov/parcel/?parcel=1123702559
      const urlParcelMatch = url.match(/parcel\?(?:parid|parcel)=(\d{10})/i);
      if (urlParcelMatch) {
        console.log(`[Exa Search] Found parcel ID in URL: ${urlParcelMatch[1]}`);
        return urlParcelMatch[1];
      }

      // Try to extract parcel ID from text content
      const textParcelPatterns = [
        /parcel\s*(?:id|#|number)?[:\s]*(\d{10})/gi,
        /account\s*(?:#|number)?[:\s]*(\d{10})/gi,
        /\b(\d{10})\b/g, // 10-digit numbers (Manatee County parcel IDs)
      ];

      for (const pattern of textParcelPatterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && match[1].length === 10) {
            console.log(`[Exa Search] Found parcel ID in text: ${match[1]}`);
            return match[1];
          }
        }
      }
    }

    console.log("[Exa Search] No parcel ID found in results");
    return null;
  } catch (error) {
    console.error("[Exa Search] Error searching for parcel ID:", error);
    return null;
  }
}

/**
 * Extract parcel ID from search results markdown/HTML
 */
function extractParcelIdFromResults(markdown: string, html: string): string | null {
  // Common parcel ID patterns for Manatee County
  const patterns = [
    /parcel\s*(?:id|#)?[:\s]*(\d{10})/gi,
    /account[:\s]*(\d{10})/gi,
    /(\d{10})\s*(?:parcel|account)/gi,
    // Pattern like "4614500652" from the screenshot
    /\b(\d{10})\b/g,
  ];

  const combined = markdown + " " + html;

  for (const pattern of patterns) {
    const matches = combined.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length === 10) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * Find the best matching property detail URL from search results
 * Now validates that the found link corresponds to the searched address
 * Returns both the URL and whether the address was found in results
 *
 * IMPORTANT: Only accepts URLs that contain an actual parcel ID parameter.
 * URLs like /parcel/?display=fullaerial without a parcel ID are rejected.
 */
function findBestPropertyDetailUrl(
  links: string[],
  markdown: string,
  html: string,
  searchAddress: string
): { url: string | null; addressFound: boolean } {
  // Extract street number and name from the searched address for validation
  const parsedSearch = parseAddress(searchAddress);
  const streetParts = (parsedSearch.street || "").toLowerCase().split(/\s+/);
  const streetNumber = streetParts[0] || "";
  const streetName = streetParts.slice(1).join(" ");

  console.log(`[PAO Search] Looking for property matching: "${streetNumber}" on "${streetName}"`);
  console.log(`[PAO Search] Found ${links.length} links to check`);

  // Pattern to match URLs with actual parcel IDs
  // Valid formats:
  // - /parcel/?parid=1234567890
  // - /parcel/?parcel=1234567890
  // - parcelid=1234567890
  // - accountid=1234567890
  const parcelIdUrlPattern = /(?:parid|parcel|parcelid|accountid)=(\d{10})/i;

  // Filter links that have actual parcel IDs (not just /parcel/ path)
  const candidateLinks = links.filter((link) => {
    if (!link) return false;
    const isManateePao = link.includes("manateepao.gov") || link.startsWith("/");
    const hasParcelId = parcelIdUrlPattern.test(link);
    return isManateePao && hasParcelId;
  });

  console.log(`[PAO Search] Found ${candidateLinks.length} candidate links with parcel IDs`);

  // Log rejected links for debugging
  const rejectedParcelLinks = links.filter((link) => {
    if (!link) return false;
    const isManateePao = link.includes("manateepao.gov") || link.startsWith("/");
    const hasParcelPath = /\/parcel\//i.test(link);
    const hasParcelId = parcelIdUrlPattern.test(link);
    return isManateePao && hasParcelPath && !hasParcelId;
  });
  if (rejectedParcelLinks.length > 0) {
    console.log(`[PAO Search] Rejected ${rejectedParcelLinks.length} parcel links without parcel IDs`);
    console.log(`[PAO Search] Example rejected: ${rejectedParcelLinks[0]}`);
  }

  // Look for the searched address in the markdown content to find the matching row
  const markdownLower = markdown.toLowerCase();
  const htmlLower = html.toLowerCase();

  // Try to find a row that contains our street number AND street name
  let addressFound = false;
  if (streetNumber && streetName) {
    const combinedContent = markdownLower + " " + htmlLower;
    const streetNameFirstWord = streetName.split(" ")[0];
    addressFound = combinedContent.includes(streetNumber) &&
                   streetNameFirstWord.length > 0 &&
                   combinedContent.includes(streetNameFirstWord);

    if (addressFound) {
      console.log(`[PAO Search] ✓ Found address "${streetNumber} ${streetName}" in search results`);
    } else {
      console.log(`[PAO Search] ✗ Address "${streetNumber} ${streetName}" NOT found in search results`);
      console.log(`[PAO Search] This may indicate no matching property was found in Manatee County records`);
    }
  }

  if (candidateLinks.length > 0) {
    const url = candidateLinks[0];
    // Ensure it's an absolute URL
    const fullUrl = url.startsWith("/") ? `https://www.manateepao.gov${url}` : url;
    console.log(`[PAO Search] Selected detail URL with parcel ID: ${fullUrl}`);
    return { url: fullUrl, addressFound };
  }

  // Fallback: Try to extract URLs with parcel IDs from markdown/HTML using regex
  // More specific pattern requiring parcel ID
  const urlWithParcelIdPattern =
    /https?:\/\/[^\s"'<>]*(?:parid|parcel|parcelid|accountid)=\d{10}[^\s"'<>]*/gi;
  const markdownUrls = markdown.match(urlWithParcelIdPattern) || [];
  const htmlUrls = html.match(urlWithParcelIdPattern) || [];

  const allUrls = [...markdownUrls, ...htmlUrls].filter(
    (url) =>
      url.includes("manateepao.gov") &&
      !url.includes("search") &&
      !url.includes("login")
  );

  if (allUrls.length > 0) {
    console.log(`[PAO Search] Fallback: Found URL with parcel ID via regex: ${allUrls[0]}`);
    return { url: allUrls[0], addressFound };
  }

  console.log(`[PAO Search] No property detail URLs found`);
  return { url: null, addressFound };
}

/**
 * Extract property details from a PAO detail page using Firecrawl LLM extraction
 */
async function extractManateePaoProperty(detailUrl: string): Promise<{
  scraped: Partial<PropertyDetails>;
  debug?: Record<string, unknown>;
}> {
  // Use Firecrawl's LLM extraction to pull structured data with comprehensive prompt
  const result = await extractFromUrl<ExtractedPropertyData>(detailUrl, {
    prompt: `Extract ALL property details from this Manatee County Property Appraiser page.

IMPORTANT: Extract data from ALL sections visible on the page:

1. BASIC INFO: Parcel ID, owner name(s) including FKA names, owner type, mailing address, situs address, jurisdiction, tax district, section/township/range, neighborhood, subdivision, legal description, FEMA value, land use code and description.

2. VALUES TABLE: Extract the complete valuation table by tax year. For each year include: land value, improvements value, just/market value, non-school assessed, school assessed, county taxable, school taxable, municipality taxable, ad valorem taxes, non-ad valorem taxes, homestead exemption status.

3. BUILDING DETAILS: Year built, living area sqft, total area under roof, bedrooms, bathrooms (full and half), stories, living units, construction type, foundation, roof, flooring, heating, cooling, electric utility, appliances, interior features, garage info, pool info.

4. LAND INFO: Lot size in acres and square feet, land use, zoning/flood info, road surface type.

5. SALES HISTORY: Extract ALL sales from the Sales table. For each sale: date, book/page, instrument number, instrument type (QC, WD, etc.), vacant/improved indicator, qualification code, sale price, grantee name.

6. EXTRA FEATURES: Any additional features listed with description, year, area, and value.

Be thorough - this data will be used to build a complete property profile.`,
    schema: PROPERTY_EXTRACTION_SCHEMA,
  });

  if (!result.success || !result.data) {
    console.error("Failed to extract property data:", result.error);

    // Fallback: Try basic scraping and parse markdown
    const scrapeResult = await scrapeUrl(detailUrl, {
      formats: ["markdown"],
      onlyMainContent: false, // Get full page content
      timeout: 30000,
    });

    if (scrapeResult.success && scrapeResult.data?.markdown) {
      const parsed = parsePropertyFromMarkdown(scrapeResult.data.markdown);
      return { scraped: parsed, debug: { method: "markdown_parse" } };
    }

    return { scraped: {}, debug: { error: result.error } };
  }

  const data = result.data;

  // Map extracted data to PropertyDetails format with full nested structure
  const scraped: Partial<PropertyDetails> = {
    // Core identification
    parcelId: data.parcelId,
    address: data.situsAddress || "",
    city: data.city,
    state: data.state,
    zipCode: data.zipCode,
    owner: data.owner,
    ownerType: data.ownerType,
    propertyType: data.propertyType,

    // Basic info section
    basicInfo: data.basicInfo ? {
      accountNumber: data.basicInfo.accountNumber || data.parcelId,
      useCode: data.basicInfo.useCode,
      useDescription: data.basicInfo.useDescription,
      situsAddress: data.situsAddress,
      mailingAddress: data.basicInfo.mailingAddress,
      subdivision: data.basicInfo.subdivision,
      neighborhood: data.basicInfo.neighborhood,
      municipality: data.basicInfo.municipality,
      jurisdiction: data.basicInfo.jurisdiction,
      taxDistrict: data.basicInfo.taxDistrict,
      sectionTownshipRange: data.basicInfo.sectionTownshipRange,
      legalDescription: data.basicInfo.legalDescription,
      shortDescription: data.basicInfo.shortDescription,
      homesteadExemption: data.basicInfo.homesteadExemption,
      femaValue: data.basicInfo.femaValue,
    } : undefined,

    // Valuations - convert from extraction format to PropertyDetails format
    valuations: data.valuations?.map(v => ({
      year: v.year,
      just: {
        land: v.landValue,
        building: v.improvementsValue,
        total: v.justMarketValue,
      },
      assessed: {
        total: v.nonSchoolAssessed || v.schoolAssessed,
      },
      taxable: {
        total: v.countyTaxable || v.schoolTaxable || v.municipalityTaxable,
      },
      adValoremTaxes: v.adValoremTaxes,
      nonAdValoremTaxes: v.nonAdValoremTaxes,
    })),

    // Building details
    building: data.building ? {
      yearBuilt: data.building.yearBuilt,
      effectiveYearBuilt: data.building.effectiveYearBuilt,
      livingAreaSqFt: data.building.livingAreaSqFt,
      totalAreaSqFt: data.building.totalAreaSqFt,
      bedrooms: data.building.bedrooms,
      bathrooms: data.building.bathrooms,
      fullBathrooms: data.building.fullBathrooms,
      halfBathrooms: data.building.halfBathrooms,
      stories: data.building.stories,
      units: data.building.units,
      constructionType: data.building.constructionType,
      foundation: data.building.foundation,
      exteriorWalls: data.building.exteriorWalls,
      roofCover: data.building.roofCover,
      roofStructure: data.building.roofStructure,
      flooring: data.building.flooring,
      heating: data.building.heating,
      cooling: data.building.cooling,
      electricUtility: data.building.electricUtility,
      appliances: data.building.appliances,
      laundryLocation: data.building.laundryLocation,
      interiorFeatures: data.building.interiorFeatures,
      hasFireplace: data.building.hasFireplace,
      pool: data.building.hasPool ? {
        hasPool: true,
        type: data.building.poolType,
      } : undefined,
      garage: data.building.hasGarage ? {
        type: data.building.garageType,
        spaces: data.building.garageSpaces,
      } : undefined,
    } : undefined,

    // Land details
    land: data.land ? {
      lotSizeSqFt: data.land.lotSizeSqFt,
      lotSizeAcres: data.land.lotSizeAcres,
      landUse: data.land.landUse,
      landUseCode: data.land.landUseCode,
      roadSurfaceType: data.land.roadSurfaceType,
      frontageFt: data.land.frontageFt,
      depthFt: data.land.depthFt,
    } : undefined,

    // Sales history
    salesHistory: data.salesHistory?.map(s => ({
      date: s.date,
      price: s.price,
      deedType: s.instrumentType,
      instrumentNumber: s.instrumentNumber,
      bookPage: s.bookPage,
      grantee: s.grantee,
      grantor: s.grantor,
      vacantOrImproved: s.vacantOrImproved,
      qualificationCode: s.qualificationCode,
    })),

    // Community/HOA
    community: data.community ? {
      subdivisionName: data.community.subdivisionName,
      hasHoa: data.community.hasHoa,
      hoaFee: data.community.hoaFee,
      hoaFeeFrequency: data.community.hoaFeeFrequency,
      petFee: data.community.petFee,
      petFeeFrequency: data.community.petFeeFrequency,
    } : undefined,

    // Listing info
    listing: data.listing ? {
      pricePerSqFt: data.listing.pricePerSqFt,
      dateOnMarket: data.listing.dateOnMarket,
      cumulativeDaysOnMarket: data.listing.cumulativeDaysOnMarket,
      ownershipType: data.listing.ownershipType,
      newConstruction: data.listing.newConstruction,
      propertySubtype: data.listing.propertySubtype,
    } : undefined,

    // Extra features
    extras: data.extras ? {
      features: data.extras.features,
      paoExtraFeatures: data.extras.paoExtraFeatures,
    } : undefined,

    // Derive summary fields from nested data
    yearBuilt: data.building?.yearBuilt,
    bedrooms: data.building?.bedrooms,
    bathrooms: data.building?.bathrooms,
    sqft: data.building?.livingAreaSqFt,
    lotSize: data.land?.lotSizeAcres
      ? `${data.land.lotSizeAcres} acres`
      : data.land?.lotSizeSqFt
        ? `${data.land.lotSizeSqFt.toLocaleString()} sq ft`
        : undefined,
  };

  // Derive assessment/market values from latest valuation
  if (data.valuations && data.valuations.length > 0) {
    const latestVal = data.valuations.reduce((latest, v) =>
      (v.year || 0) > (latest.year || 0) ? v : latest
    , data.valuations[0]);

    scraped.assessedValue = latestVal.nonSchoolAssessed || latestVal.schoolAssessed;
    scraped.marketValue = latestVal.justMarketValue;
    scraped.taxAmount = (latestVal.adValoremTaxes || 0) + (latestVal.nonAdValoremTaxes || 0);
  }

  // Derive last sale from sales history
  if (data.salesHistory && data.salesHistory.length > 0) {
    // Find the most recent qualified sale with a price
    const qualifiedSales = data.salesHistory.filter(s => s.price && s.price > 0);
    if (qualifiedSales.length > 0) {
      const lastSale = qualifiedSales[0]; // Assuming they're in reverse chronological order
      scraped.lastSalePrice = lastSale.price;
      scraped.lastSaleDate = lastSale.date;
    }
  }

  // Calculate price per sqft if we have both values
  if (scraped.marketValue && scraped.sqft && scraped.sqft > 0) {
    if (!scraped.listing) scraped.listing = {};
    scraped.listing.pricePerSqFt = Math.round(scraped.marketValue / scraped.sqft);
  }

  return { scraped, debug: { method: "llm_extraction", fieldsExtracted: Object.keys(data) } };
}

/**
 * Parse property details from markdown content as a fallback
 * Enhanced to extract rich PAO data from tables and structured content
 */
function parsePropertyFromMarkdown(
  markdown: string
): Partial<PropertyDetails> {
  const property: Partial<PropertyDetails> = {};

  // Helper to extract single values
  const extractValue = (patterns: RegExp[]): string | undefined => {
    for (const pattern of patterns) {
      const match = markdown.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return undefined;
  };

  const extractNumber = (patterns: RegExp[]): number | undefined => {
    const value = extractValue(patterns);
    if (value) {
      const num = parseFloat(value.replace(/[,$]/g, ""));
      return isNaN(num) ? undefined : num;
    }
    return undefined;
  };

  // ===== BASIC IDENTIFICATION =====
  property.parcelId = extractValue([
    /parcel\s*(?:id|#|number)?[:\s]*\**\s*(\d{10})/i,
    /parcel\s*id[:\s]+([A-Z0-9-]+)/i,
    /account\s*(?:id|#|number)?[:\s]+([A-Z0-9-]+)/i,
  ]);

  property.owner = extractValue([
    /ownership[:\s]+([^\n]+)/i,
    /owner[:\s]+([^\n]+)/i,
    /owner\s*name[:\s]+([^\n]+)/i,
  ]);

  property.ownerType = extractValue([
    /owner\s*type[:\s]+([^\n]+)/i,
  ]);

  property.address = extractValue([
    /situs\s*address[:\s]+([^\n]+)/i,
    /property\s*address[:\s]+([^\n]+)/i,
  ]) || "";

  // ===== BASIC INFO SECTION =====
  property.basicInfo = {
    jurisdiction: extractValue([/jurisdiction[:\s]+([^\n]+)/i]),
    taxDistrict: extractValue([/tax\s*district[:\s]+([^\n]+)/i]),
    sectionTownshipRange: extractValue([/sec\/twp\/rge[:\s]+([^\n]+)/i, /section[:\s]+([^\n]+)/i]),
    neighborhood: extractValue([/neighborhood[:\s]+([^\n]+)/i]),
    subdivision: extractValue([/subdivision[:\s]+([^\n]+)/i]),
    shortDescription: extractValue([/short\s*description[:\s]+([^\n]+)/i]),
    legalDescription: extractValue([/legal\s*description[:\s]+([^\n]+)/i, /full\s*description[:\s]+([^\n]+)/i]),
    useCode: extractValue([/land\s*use[:\s]+(\d+)/i, /use\s*code[:\s]+(\d+)/i]),
    useDescription: extractValue([/land\s*use[:\s]+\d+;\s*([^\n]+)/i]),
    mailingAddress: extractValue([/mailing\s*address[:\s]+([^\n]+)/i]),
    femaValue: extractNumber([/fema\s*value[:\s]+\$?([\d,]+)/i]),
    homesteadExemption: markdown.toLowerCase().includes("homestead") &&
      (markdown.toLowerCase().includes("yes") || !markdown.toLowerCase().includes("no")),
  };

  // ===== BUILDING DETAILS =====
  property.building = {
    yearBuilt: extractNumber([/year\s*built[:\s]+(\d{4})/i, /built[:\s]+(\d{4})/i]),
    livingAreaSqFt: extractNumber([
      /living\s*(?:area|or\s*business\s*area)[:\s]+([\d,]+)/i,
      /living\s*area[:\s]+([\d,]+)/i,
      /([\d,]+)\s*sqft\s*living/i,
    ]),
    totalAreaSqFt: extractNumber([
      /(?:total\s*)?(?:area\s*)?under\s*roof[:\s]+([\d,]+)/i,
      /building\s*area[:\s]+([\d,]+)/i,
      /([\d,]+)\s*sqft\s*under\s*roof/i,
    ]),
    bedrooms: extractNumber([/bedrooms?[:\s]+(\d+)/i, /beds?[:\s]+(\d+)/i]),
    bathrooms: extractNumber([/bathrooms?[:\s]+(\d+\.?\d*)/i, /baths?[:\s]+(\d+\.?\d*)/i]),
    fullBathrooms: extractNumber([/full\s*bath(?:room)?s?[:\s]+(\d+)/i]),
    halfBathrooms: extractNumber([/half\s*bath(?:room)?s?[:\s]+(\d+)/i]),
    units: extractNumber([/living\s*units?[:\s]+(\d+)/i]),
    constructionType: extractValue([/construction[:\s]+([^\n,]+)/i, /materials?[:\s]+([^\n]+)/i]),
    foundation: extractValue([/foundation[:\s]+([^\n]+)/i]),
    roofCover: extractValue([/roof(?:\s*cover)?[:\s]+([^\n]+)/i]),
    flooring: extractValue([/flooring[:\s]+([^\n]+)/i]),
    heating: extractValue([/heat(?:ing)?[:\s]+([^\n]+)/i]),
    cooling: extractValue([/cool(?:ing)?[:\s]+([^\n]+)/i, /(?:central\s*)?air[:\s]+([^\n]+)/i]),
    electricUtility: markdown.toLowerCase().includes("electric") &&
      markdown.toLowerCase().includes("yes"),
    hasFireplace: markdown.toLowerCase().includes("fireplace") &&
      !markdown.toLowerCase().includes("no fireplace"),
    pool: (markdown.toLowerCase().includes("pool") && !markdown.toLowerCase().includes("no pool"))
      ? { hasPool: true }
      : undefined,
  };

  // Extract appliances if present
  const appliancesMatch = markdown.match(/appliances?[:\s]+([^\n]+)/i);
  if (appliancesMatch && property.building) {
    property.building.appliances = appliancesMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
  }

  // Extract interior features
  const featuresMatch = markdown.match(/(?:interior\s*)?features?[:\s]+([^\n]+)/i);
  if (featuresMatch && property.building) {
    property.building.interiorFeatures = featuresMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
  }

  // ===== LAND DETAILS =====
  property.land = {
    lotSizeAcres: extractNumber([/([\d.]+)\s*acres?/i]),
    lotSizeSqFt: extractNumber([
      /land\s*size[:\s]+([\d,]+)\s*(?:sq|square)/i,
      /([\d,]+)\s*square\s*feet/i,
    ]),
    landUse: extractValue([/land\s*use[:\s]+\d+;\s*([^\n]+)/i]),
    landUseCode: extractValue([/land\s*use[:\s]+(\d+)/i]),
    roadSurfaceType: extractValue([/road\s*surface[:\s]+([^\n]+)/i]),
  };

  // ===== VALUATIONS =====
  // Try to parse the values table
  property.valuations = parseValuationsFromMarkdown(markdown);

  // Extract summary values if table parsing didn't work
  if (!property.valuations || property.valuations.length === 0) {
    const justValue = extractNumber([
      /just\/market\s*(?:value)?[:\s]+\$?([\d,]+)/i,
      /market\s*value[:\s]+\$?([\d,]+)/i,
      /just\s*value[:\s]+\$?([\d,]+)/i,
    ]);
    const assessedValue = extractNumber([
      /assessed\s*value[:\s]+\$?([\d,]+)/i,
      /total\s*assessed[:\s]+\$?([\d,]+)/i,
      /non-?school\s*assessed[:\s]+\$?([\d,]+)/i,
    ]);
    const landValue = extractNumber([/land\s*value[:\s]+\$?([\d,]+)/i]);
    const improvementsValue = extractNumber([/improvements?\s*value[:\s]+\$?([\d,]+)/i]);
    const adValoremTaxes = extractNumber([/ad\s*valorem\s*taxes?[:\s]+\$?([\d,]+)/i]);

    if (justValue || assessedValue) {
      property.valuations = [{
        year: new Date().getFullYear(),
        just: { land: landValue, building: improvementsValue, total: justValue },
        assessed: { total: assessedValue },
        adValoremTaxes,
      }];
    }
  }

  // ===== SALES HISTORY =====
  property.salesHistory = parseSalesHistoryFromMarkdown(markdown);

  // ===== COMMUNITY/HOA =====
  property.community = {
    subdivisionName: extractValue([/subdivision[:\s]+([^\n;]+)/i]),
    hasHoa: markdown.toLowerCase().includes("hoa") &&
      !markdown.toLowerCase().includes("no hoa"),
    hoaFee: extractNumber([/hoa\s*(?:fee)?[:\s]+\$?([\d,]+)/i]),
  };

  // ===== DERIVE SUMMARY FIELDS =====
  property.yearBuilt = property.building?.yearBuilt;
  property.bedrooms = property.building?.bedrooms;
  property.bathrooms = property.building?.bathrooms;
  property.sqft = property.building?.livingAreaSqFt;

  if (property.land?.lotSizeAcres) {
    property.lotSize = `${property.land.lotSizeAcres} acres`;
  } else if (property.land?.lotSizeSqFt) {
    property.lotSize = `${property.land.lotSizeSqFt.toLocaleString()} sq ft`;
  }

  // Get values from latest valuation
  if (property.valuations && property.valuations.length > 0) {
    const latest = property.valuations[0];
    property.marketValue = latest.just?.total;
    property.assessedValue = latest.assessed?.total;
    property.taxAmount = latest.adValoremTaxes;
  }

  // Get last sale
  if (property.salesHistory && property.salesHistory.length > 0) {
    const qualifiedSales = property.salesHistory.filter(s => s.price && s.price > 0);
    if (qualifiedSales.length > 0) {
      property.lastSalePrice = qualifiedSales[0].price;
      property.lastSaleDate = qualifiedSales[0].date;
    }
  }

  return property;
}

/**
 * Parse valuations table from markdown
 * Looks for tables with columns like: Year, Land, Improvements, Just/Market, Assessed, Taxable, Taxes
 */
function parseValuationsFromMarkdown(markdown: string): ValuationRecord[] {
  const valuations: ValuationRecord[] = [];

  // Look for markdown table rows with valuation data
  // Pattern: | Year | Land | Improvements | Just/Market | ... |
  const tableRowPattern = /\|\s*(\d{4})\s*\|\s*(?:No|Yes)?\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|/gi;
  
  let match;
  while ((match = tableRowPattern.exec(markdown)) !== null) {
    const year = parseInt(match[1]);
    const landValue = parseFloat(match[2].replace(/,/g, ""));
    const improvementsValue = parseFloat(match[3].replace(/,/g, ""));
    const justMarketValue = parseFloat(match[4].replace(/,/g, ""));

    if (!isNaN(year) && year > 1900 && year < 2100) {
      valuations.push({
        year,
        just: {
          land: isNaN(landValue) ? undefined : landValue,
          building: isNaN(improvementsValue) ? undefined : improvementsValue,
          total: isNaN(justMarketValue) ? undefined : justMarketValue,
        },
      });
    }
  }

  // Alternative pattern: look for key-value style
  // "2024 | 40,800 | 174,707 | 215,507 | 180,950 | 215,507 | 180,950 | 215,507 | 180,950 | 180,950 | 3,548.98"
  if (valuations.length === 0) {
    const altPattern = /(\d{4})\s*\|?\s*([\d,]+)\s*\|?\s*([\d,]+)\s*\|?\s*([\d,]+)/g;
    while ((match = altPattern.exec(markdown)) !== null) {
      const year = parseInt(match[1]);
      if (year > 2000 && year <= new Date().getFullYear() + 1) {
        valuations.push({
          year,
          just: {
            land: parseFloat(match[2].replace(/,/g, "")) || undefined,
            building: parseFloat(match[3].replace(/,/g, "")) || undefined,
            total: parseFloat(match[4].replace(/,/g, "")) || undefined,
          },
        });
      }
    }
  }

  return valuations;
}

/**
 * Parse sales history table from markdown
 * Looks for tables with columns like: Date, Book/Page, Instrument, Price, Grantee
 */
function parseSalesHistoryFromMarkdown(markdown: string): SaleRecord[] {
  const sales: SaleRecord[] = [];

  // Pattern for sale rows: date | book/page | instrument | V/I | qual | price | grantee
  // Example: "06/13/2023 | 2023/1063287 | QC | I | 11 | 0 | WILLIAMS, GWENDOLYN"
  const salePattern = /(\d{1,2}\/\d{1,2}\/\d{4})\s*\|?\s*(\d+\s*\/\s*\d+)?\s*\|?\s*([A-Z]{2})?\s*\|?\s*([VI])?\s*\|?\s*(\d+)?\s*\|?\s*([\d,]+)?\s*\|?\s*([A-Z][A-Za-z\s,]+)?/gi;

  let match;
  while ((match = salePattern.exec(markdown)) !== null) {
    const date = match[1];
    const bookPage = match[2]?.replace(/\s/g, "");
    const instrumentType = match[3];
    const vacantOrImproved = match[4];
    const qualCode = match[5];
    const price = match[6] ? parseFloat(match[6].replace(/,/g, "")) : undefined;
    const grantee = match[7]?.trim();

    if (date) {
      sales.push({
        date,
        bookPage,
        deedType: instrumentType,
        vacantOrImproved,
        qualificationCode: qualCode,
        price: isNaN(price || NaN) ? undefined : price,
        grantee,
      });
    }
  }

  return sales;
}

/**
 * Normalize and validate property details, filling in missing required fields
 * Preserves rich nested data while ensuring backward-compatible summary fields
 */
function normalizePropertyDetails(
  inputAddress: string,
  scraped: Partial<PropertyDetails>,
  context?: { detailUrl?: string }
): PropertyDetails {
  const addressParts = parseAddress(inputAddress);

  // Build the normalized property with fallbacks, preserving all rich data
  const property: PropertyDetails = {
    // Core identification
    parcelId: scraped.parcelId,
    address: scraped.address || inputAddress,
    city: scraped.city || addressParts.city || "Bradenton",
    state: scraped.state || addressParts.state || "FL",
    zipCode: scraped.zipCode || addressParts.zipCode,
    owner: scraped.owner,
    ownerType: scraped.ownerType,
    propertyType: scraped.propertyType || scraped.basicInfo?.useDescription || "Residential",

    // Summary fields (backward compatible)
    yearBuilt: scraped.yearBuilt || scraped.building?.yearBuilt,
    bedrooms: scraped.bedrooms || scraped.building?.bedrooms,
    bathrooms: scraped.bathrooms || scraped.building?.bathrooms,
    sqft: scraped.sqft || scraped.building?.livingAreaSqFt,
    lotSize: scraped.lotSize || (scraped.land?.lotSizeAcres
      ? `${scraped.land.lotSizeAcres} acres`
      : scraped.land?.lotSizeSqFt
        ? `${scraped.land.lotSizeSqFt.toLocaleString()} sq ft`
        : undefined),
    assessedValue: scraped.assessedValue,
    marketValue: scraped.marketValue ||
      (scraped.assessedValue
        ? Math.round(scraped.assessedValue * 1.15)
        : undefined),
    lastSalePrice: scraped.lastSalePrice,
    lastSaleDate: scraped.lastSaleDate,
    taxAmount: scraped.taxAmount,
    zoning: scraped.zoning || scraped.land?.landUse,
    legal: scraped.legal || scraped.basicInfo?.legalDescription,

    // Rich nested data (pass through)
    basicInfo: scraped.basicInfo,
    valuations: scraped.valuations,
    building: scraped.building,
    land: scraped.land,
    salesHistory: scraped.salesHistory,
    community: scraped.community,
    listing: scraped.listing,
    extras: scraped.extras,

    // Raw data for debugging
    rawData: {
      source: "manatee_pao",
      method: "playwright",
      detailUrl: context?.detailUrl,
      scrapedAt: new Date().toISOString(),
      isFallback: false,
    },
  };

  // Calculate price per sqft if not already set
  if (!property.listing?.pricePerSqFt && property.marketValue && property.sqft && property.sqft > 0) {
    if (!property.listing) property.listing = {};
    property.listing.pricePerSqFt = Math.round(property.marketValue / property.sqft);
  }

  return property;
}

/**
 * Build mock property data for fallback scenarios
 */
function buildMockManateeProperty(
  address: string,
  reason?: string
): PropertyDetails {
  const addressParts = parseAddress(address);

  return {
    parcelId: generateMockParcelId(),
    address: address,
    city: addressParts.city || "Bradenton",
    state: "FL",
    zipCode: addressParts.zipCode || "34201",
    owner: "Property Owner",
    propertyType: "Single Family Residential",
    yearBuilt: 2005,
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1850,
    lotSize: "0.25 acres",
    assessedValue: 285000,
    marketValue: 325000,
    lastSalePrice: 275000,
    lastSaleDate: "2021-06-15",
    taxAmount: 4250,
    zoning: "RSF-3",
    rawData: {
      source: "manatee_pao",
      method: "mock",
      isFallback: true,
      fallbackReason: reason,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Search for property across all available sources
 */
export async function searchProperty(
  address: string,
  options?: {
    sources?: ("manatee_pao" | "zillow" | "realtor")[];
  }
): Promise<PropertySearchResult[]> {
  const sources = options?.sources || ["manatee_pao"];
  const results: PropertySearchResult[] = [];

  for (const source of sources) {
    switch (source) {
      case "manatee_pao":
        results.push(await searchManateePAO(address));
        break;
      case "zillow":
        // Placeholder for Zillow integration
        results.push({
          success: false,
          error: "Zillow integration not yet implemented",
          source: "zillow",
        });
        break;
      case "realtor":
        // Placeholder for Realtor.com integration
        results.push({
          success: false,
          error: "Realtor.com integration not yet implemented",
          source: "realtor",
        });
        break;
    }
  }

  return results;
}

/**
 * Parse an address string into components
 */
function parseAddress(address: string): {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
} {
  // Simple address parsing - in production, use a proper geocoding service
  const parts = address.split(",").map((p) => p.trim());

  const result: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  } = {};

  if (parts.length >= 1) {
    result.street = parts[0];
  }

  if (parts.length >= 2) {
    result.city = parts[1];
  }

  if (parts.length >= 3) {
    // Parse "FL 34201" or "FL" and "34201"
    const stateZip = parts[2].split(" ");
    result.state = stateZip[0];
    if (stateZip.length > 1) {
      result.zipCode = stateZip[1];
    }
  }

  if (parts.length >= 4) {
    result.zipCode = parts[3];
  }

  return result;
}

/**
 * Generate a mock parcel ID for demonstration
 */
function generateMockParcelId(): string {
  const section = Math.floor(Math.random() * 36) + 1;
  const township = Math.floor(Math.random() * 10) + 30;
  const range = Math.floor(Math.random() * 5) + 17;
  const parcel = Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, "0");

  return `${section.toString().padStart(2, "0")}-${township}S-${range}E-${parcel}`;
}

/**
 * Estimate property value based on comparable sales
 * This would integrate with real data sources in production
 */
export async function estimatePropertyValue(property: PropertyDetails): Promise<{
  estimatedValue: number;
  confidence: "low" | "medium" | "high";
  comparables: PropertyDetails[];
}> {
  // Mock estimation based on assessed value
  const assessedValue = property.assessedValue || 0;
  const estimatedValue = Math.round(assessedValue * 1.15); // Assume 15% above assessed

  return {
    estimatedValue,
    confidence: "medium",
    comparables: [],
  };
}
