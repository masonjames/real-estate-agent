/**
 * Property Search Integration
 *
 * This module handles searching for property information from various sources.
 * Supports Manatee County PAO via Firecrawl web scraping, with fallback to mock data.
 */

import {
  scrapeUrl,
  extractFromUrl,
  isFirecrawlConfigured,
  buildSearchActions,
} from "./firecrawl";

export interface PropertyDetails {
  parcelId?: string;
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  owner?: string;
  propertyType?: string;
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
  rawData?: Record<string, unknown>;
}

export interface PropertySearchResult {
  success: boolean;
  property?: PropertyDetails;
  error?: string;
  source: "manatee_pao" | "zillow" | "realtor" | "manual";
}

// Schema for Firecrawl LLM extraction from property detail pages
const PROPERTY_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
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
      description: "Property owner name(s)",
    },
    propertyType: {
      type: "string",
      description:
        "Property type or use code (e.g., Single Family, Residential, Commercial)",
    },
    yearBuilt: {
      type: "number",
      description: "Year the building was constructed",
    },
    bedrooms: {
      type: "number",
      description: "Number of bedrooms",
    },
    bathrooms: {
      type: "number",
      description: "Number of bathrooms",
    },
    sqft: {
      type: "number",
      description: "Living area square footage",
    },
    lotSize: {
      type: "string",
      description: "Lot size (e.g., 0.25 acres, 10000 sq ft)",
    },
    assessedValue: {
      type: "number",
      description: "Assessed value or total assessed value in dollars",
    },
    marketValue: {
      type: "number",
      description: "Market value, just value, or fair market value in dollars",
    },
    landValue: {
      type: "number",
      description: "Land value in dollars",
    },
    buildingValue: {
      type: "number",
      description: "Building or improvement value in dollars",
    },
    lastSalePrice: {
      type: "number",
      description: "Most recent sale price in dollars",
    },
    lastSaleDate: {
      type: "string",
      description: "Most recent sale date",
    },
    taxAmount: {
      type: "number",
      description: "Annual property tax amount in dollars",
    },
    zoning: {
      type: "string",
      description: "Zoning classification",
    },
    legal: {
      type: "string",
      description: "Legal description of the property",
    },
  },
  required: ["situsAddress"],
};

type ExtractedPropertyData = {
  parcelId?: string;
  situsAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  owner?: string;
  propertyType?: string;
  yearBuilt?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: string;
  assessedValue?: number;
  marketValue?: number;
  landValue?: number;
  buildingValue?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  taxAmount?: number;
  zoning?: string;
  legal?: string;
};

/**
 * Search Manatee County Property Appraiser's Office using Firecrawl
 * Falls back to mock data if scraping fails
 */
export async function searchManateePAO(
  address: string
): Promise<PropertySearchResult> {
  console.log(`Searching Manatee PAO for: ${address}`);

  // Check if Firecrawl is configured
  if (!isFirecrawlConfigured()) {
    console.log("Firecrawl not configured, using mock data");
    return {
      success: true,
      property: buildMockManateeProperty(address, "Firecrawl not configured"),
      source: "manatee_pao",
    };
  }

  try {
    // Step 1: Search for the property and find detail URL
    const { detailUrl } = await findManateePaoDetailUrlByAddress(address);

    if (!detailUrl) {
      console.log("No property detail URL found, using mock data");
      return {
        success: true,
        property: buildMockManateeProperty(
          address,
          "No matching property found in PAO search"
        ),
        source: "manatee_pao",
      };
    }

    console.log(`Found property detail URL: ${detailUrl}`);

    // Step 2: Extract property details from the detail page
    const { scraped } = await extractManateePaoProperty(detailUrl);

    // Step 3: Normalize and validate the extracted data
    const property = normalizePropertyDetails(address, scraped, { detailUrl });

    return {
      success: true,
      property,
      source: "manatee_pao",
    };
  } catch (error) {
    console.error("Manatee PAO Firecrawl error:", error);
    return {
      success: true,
      property: buildMockManateeProperty(
        address,
        error instanceof Error ? error.message : "Unknown scraping error"
      ),
      source: "manatee_pao",
    };
  }
}

/**
 * Find the property detail page URL by searching the PAO site
 */
async function findManateePaoDetailUrlByAddress(address: string): Promise<{
  detailUrl: string | null;
  debug?: Record<string, unknown>;
}> {
  const searchUrl = "https://www.manateepao.gov/search/";

  // Build actions to fill in the search form and submit
  const actions = buildSearchActions(
    address,
    'input[type="search"], input[name="search"], input[placeholder*="Search"], #searchInput, .search-input, input[type="text"]',
    'button[type="submit"], .search-button, input[type="submit"]'
  );

  // Scrape the search page with form-filling actions
  const result = await scrapeUrl(searchUrl, {
    formats: ["markdown", "links", "html"],
    onlyMainContent: false,
    timeout: 45000,
    actions,
  });

  if (!result.success || !result.data) {
    console.error("Failed to scrape PAO search page:", result.error);
    return { detailUrl: null, debug: { error: result.error } };
  }

  // Try to find property detail links from the response
  const detailUrl = findBestPropertyDetailUrl(
    result.data.links || [],
    result.data.markdown || "",
    result.data.html || "",
    address
  );

  return {
    detailUrl,
    debug: {
      linksFound: result.data.links?.length || 0,
      markdownLength: result.data.markdown?.length || 0,
    },
  };
}

/**
 * Find the best matching property detail URL from search results
 */
function findBestPropertyDetailUrl(
  links: string[],
  markdown: string,
  html: string,
  _searchAddress: string
): string | null {
  // Common URL patterns for property detail pages
  const detailPatterns = [
    /\/parcel\//i,
    /\/property\//i,
    /\/detail\//i,
    /\/account\//i,
    /\/folio\//i,
    /parcelid=/i,
    /accountid=/i,
  ];

  // Filter links that look like property detail pages
  const candidateLinks = links.filter((link) => {
    const isManateePao =
      link.includes("manateepao.gov") || link.startsWith("/");
    const isDetailPage = detailPatterns.some((pattern) => pattern.test(link));
    return isManateePao && isDetailPage;
  });

  if (candidateLinks.length > 0) {
    // Return the first candidate (typically the best match from search)
    const url = candidateLinks[0];
    // Ensure it's an absolute URL
    if (url.startsWith("/")) {
      return `https://www.manateepao.gov${url}`;
    }
    return url;
  }

  // Fallback: Try to extract URLs from markdown/HTML using regex
  const urlPattern =
    /https?:\/\/[^\s"'<>]+(?:parcel|property|detail|account)[^\s"'<>]*/gi;
  const markdownUrls = markdown.match(urlPattern) || [];
  const htmlUrls = html.match(urlPattern) || [];

  const allUrls = [...markdownUrls, ...htmlUrls].filter(
    (url) =>
      url.includes("manateepao.gov") &&
      !url.includes("search") &&
      !url.includes("login")
  );

  return allUrls.length > 0 ? allUrls[0] : null;
}

/**
 * Extract property details from a PAO detail page using Firecrawl LLM extraction
 */
async function extractManateePaoProperty(detailUrl: string): Promise<{
  scraped: Partial<PropertyDetails>;
  debug?: Record<string, unknown>;
}> {
  // Use Firecrawl's LLM extraction to pull structured data
  const result = await extractFromUrl<ExtractedPropertyData>(detailUrl, {
    prompt:
      "Extract all property details from this Manatee County Property Appraiser page. Look for parcel ID, owner name, property address, assessed value, market value, year built, bedrooms, bathrooms, square footage, lot size, sale history, and tax information.",
    schema: PROPERTY_EXTRACTION_SCHEMA,
  });

  if (!result.success || !result.data) {
    console.error("Failed to extract property data:", result.error);

    // Fallback: Try basic scraping and parse markdown
    const scrapeResult = await scrapeUrl(detailUrl, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
    });

    if (scrapeResult.success && scrapeResult.data?.markdown) {
      const parsed = parsePropertyFromMarkdown(scrapeResult.data.markdown);
      return { scraped: parsed, debug: { method: "markdown_parse" } };
    }

    return { scraped: {}, debug: { error: result.error } };
  }

  // Map extracted data to PropertyDetails format
  const scraped: Partial<PropertyDetails> = {
    parcelId: result.data.parcelId,
    address: result.data.situsAddress || "",
    city: result.data.city,
    state: result.data.state,
    zipCode: result.data.zipCode,
    owner: result.data.owner,
    propertyType: result.data.propertyType,
    yearBuilt: result.data.yearBuilt,
    bedrooms: result.data.bedrooms,
    bathrooms: result.data.bathrooms,
    sqft: result.data.sqft,
    lotSize: result.data.lotSize,
    assessedValue: result.data.assessedValue,
    marketValue: result.data.marketValue,
    lastSalePrice: result.data.lastSalePrice,
    lastSaleDate: result.data.lastSaleDate,
    taxAmount: result.data.taxAmount,
    zoning: result.data.zoning,
    legal: result.data.legal,
  };

  return { scraped, debug: { method: "llm_extraction" } };
}

/**
 * Parse property details from markdown content as a fallback
 */
function parsePropertyFromMarkdown(
  markdown: string
): Partial<PropertyDetails> {
  const property: Partial<PropertyDetails> = {};

  // Helper to extract values
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

  // Extract common fields
  property.parcelId = extractValue([
    /parcel\s*(?:id|#|number)?[:\s]+([A-Z0-9-]+)/i,
    /account\s*(?:id|#|number)?[:\s]+([A-Z0-9-]+)/i,
    /folio[:\s]+([A-Z0-9-]+)/i,
  ]);

  property.owner = extractValue([
    /owner[:\s]+([^\n]+)/i,
    /owner\s*name[:\s]+([^\n]+)/i,
  ]);

  property.yearBuilt = extractNumber([
    /year\s*built[:\s]+(\d{4})/i,
    /built[:\s]+(\d{4})/i,
  ]);

  property.bedrooms = extractNumber([
    /bedrooms?[:\s]+(\d+)/i,
    /beds?[:\s]+(\d+)/i,
  ]);

  property.bathrooms = extractNumber([
    /bathrooms?[:\s]+(\d+\.?\d*)/i,
    /baths?[:\s]+(\d+\.?\d*)/i,
  ]);

  property.sqft = extractNumber([
    /(?:living\s*)?(?:area|sqft|sq\s*ft|square\s*feet)[:\s]+([\d,]+)/i,
  ]);

  property.assessedValue = extractNumber([
    /assessed\s*value[:\s]+\$?([\d,]+)/i,
    /total\s*assessed[:\s]+\$?([\d,]+)/i,
  ]);

  property.marketValue = extractNumber([
    /market\s*value[:\s]+\$?([\d,]+)/i,
    /just\s*value[:\s]+\$?([\d,]+)/i,
    /fair\s*market[:\s]+\$?([\d,]+)/i,
  ]);

  property.taxAmount = extractNumber([
    /tax(?:es)?[:\s]+\$?([\d,]+)/i,
    /annual\s*tax[:\s]+\$?([\d,]+)/i,
  ]);

  return property;
}

/**
 * Normalize and validate property details, filling in missing required fields
 */
function normalizePropertyDetails(
  inputAddress: string,
  scraped: Partial<PropertyDetails>,
  context?: { detailUrl?: string }
): PropertyDetails {
  const addressParts = parseAddress(inputAddress);

  // Build the normalized property with fallbacks
  const property: PropertyDetails = {
    parcelId: scraped.parcelId,
    address: scraped.address || inputAddress,
    city: scraped.city || addressParts.city || "Bradenton",
    state: scraped.state || addressParts.state || "FL",
    zipCode: scraped.zipCode || addressParts.zipCode,
    owner: scraped.owner,
    propertyType: scraped.propertyType || "Residential",
    yearBuilt: scraped.yearBuilt,
    bedrooms: scraped.bedrooms,
    bathrooms: scraped.bathrooms,
    sqft: scraped.sqft,
    lotSize: scraped.lotSize,
    assessedValue: scraped.assessedValue,
    marketValue:
      scraped.marketValue ||
      (scraped.assessedValue
        ? Math.round(scraped.assessedValue * 1.15)
        : undefined),
    lastSalePrice: scraped.lastSalePrice,
    lastSaleDate: scraped.lastSaleDate,
    taxAmount: scraped.taxAmount,
    zoning: scraped.zoning,
    legal: scraped.legal,
    rawData: {
      source: "manatee_pao",
      method: "firecrawl",
      detailUrl: context?.detailUrl,
      scrapedAt: new Date().toISOString(),
      isFallback: false,
    },
  };

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
