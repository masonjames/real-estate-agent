import Exa from "exa-js";

// Lazy initialization to avoid build-time errors when EXA_API_KEY is not set
let _exa: Exa | null = null;

export function getExaClient(): Exa {
  if (!_exa) {
    if (!process.env.EXA_API_KEY) {
      throw new Error("EXA_API_KEY environment variable is not set");
    }
    _exa = new Exa(process.env.EXA_API_KEY);
  }
  return _exa;
}

export interface PersonSearchResult {
  name: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  summary?: string;
  highlights?: string[];
  imageUrl?: string | null;
  matchScore?: number;
  matchCriteria?: string[];
}

export interface DemographicInsights {
  averageIncome?: string;
  predominantAge?: string;
  educationLevel?: string;
  commonOccupations?: string[];
  lifestyleIndicators?: string[];
  potentialBuyerProfiles?: PersonSearchResult[];
}

/**
 * Generate match criteria based on property and buyer characteristics
 */
function generateMatchCriteria(
  buyer: Partial<PersonSearchResult>,
  propertyContext: {
    location?: string;
    propertyType?: string;
    priceRange?: string;
  }
): string[] {
  const criteria: string[] = [];

  // Location-based matching
  if (buyer.location && propertyContext.location) {
    const buyerLocation = buyer.location.toLowerCase();
    const propLocation = propertyContext.location.toLowerCase();
    if (
      buyerLocation.includes(propLocation) ||
      propLocation.includes(buyerLocation)
    ) {
      criteria.push("Location Match");
    }
  }

  // Industry/profession matching
  if (buyer.title || buyer.company) {
    const titleLower = (buyer.title || "").toLowerCase();
    const companyLower = (buyer.company || "").toLowerCase();

    if (
      titleLower.includes("investor") ||
      titleLower.includes("real estate") ||
      companyLower.includes("capital") ||
      companyLower.includes("investment")
    ) {
      criteria.push("Real Estate Investor");
    }
    if (
      titleLower.includes("ceo") ||
      titleLower.includes("founder") ||
      titleLower.includes("executive") ||
      titleLower.includes("director")
    ) {
      criteria.push("Executive/High Income");
    }
    if (
      titleLower.includes("tech") ||
      titleLower.includes("engineer") ||
      titleLower.includes("developer") ||
      companyLower.includes("tech")
    ) {
      criteria.push("Tech Professional");
    }
  }

  // Property type matching
  if (propertyContext.propertyType) {
    const propType = propertyContext.propertyType.toLowerCase();
    if (propType.includes("luxury") || propType.includes("estate")) {
      criteria.push("Luxury Buyer");
    }
    if (propType.includes("family") || propType.includes("single")) {
      criteria.push("Family Home Buyer");
    }
    if (propType.includes("condo") || propType.includes("apartment")) {
      criteria.push("Urban Lifestyle");
    }
  }

  // If no specific criteria found, add generic ones
  if (criteria.length === 0) {
    criteria.push("Active Market Interest");
  }

  return criteria;
}

/**
 * Calculate match score based on criteria and other factors
 */
function calculateMatchScore(
  buyer: Partial<PersonSearchResult>,
  criteriaCount: number
): number {
  let score = 50; // Base score

  // More criteria = higher score
  score += criteriaCount * 10;

  // Has profile info = higher score
  if (buyer.title) score += 5;
  if (buyer.company) score += 5;
  if (buyer.location) score += 5;
  if (buyer.linkedinUrl) score += 5;
  if (buyer.summary) score += 5;

  // Cap at 100
  return Math.min(100, Math.max(0, score));
}

/**
 * Search for potential buyers based on property characteristics and location
 */
export async function searchPotentialBuyers(
  location: string,
  propertyType: string,
  priceRange: string
): Promise<PersonSearchResult[]> {
  try {
    const query = `real estate investor OR home buyer ${location} ${propertyType}`;

    const response = await getExaClient().search(query, {
      type: "auto",
      category: "people",
      numResults: 10,
      useAutoprompt: true,
    });

    const propertyContext = { location, propertyType, priceRange };

    return response.results.map((result) => {
      const buyer: Partial<PersonSearchResult> = {
        name: result.title || "Unknown",
        linkedinUrl: result.url,
        summary: result.text || undefined,
      };

      const matchCriteria = generateMatchCriteria(buyer, propertyContext);
      const matchScore = calculateMatchScore(buyer, matchCriteria.length);

      return {
        ...buyer,
        name: buyer.name || "Unknown",
        matchCriteria,
        matchScore,
        imageUrl: null, // Exa doesn't return images directly
      };
    });
  } catch (error) {
    console.error("Error searching for potential buyers:", error);
    return [];
  }
}

/**
 * Get demographic insights for a specific area
 */
export async function getDemographicInsights(
  location: string,
  zipCode?: string
): Promise<DemographicInsights> {
  try {
    // Search for demographic and economic information about the area
    const demographicQuery = `${location} ${zipCode || ""} demographics income population statistics`;

    const response = await getExaClient().searchAndContents(demographicQuery, {
      type: "auto",
      numResults: 5,
      text: { maxCharacters: 2000 },
      useAutoprompt: true,
    });

    // Extract insights from search results
    const insights: DemographicInsights = {
      lifestyleIndicators: [],
      commonOccupations: [],
      potentialBuyerProfiles: [],
    };

    // Process results to extract demographic information
    for (const result of response.results) {
      if (result.text) {
        // Simple extraction of key demographic terms
        if (result.text.toLowerCase().includes("median income")) {
          const match = result.text.match(/median income[:\s]+\$?([\d,]+)/i);
          if (match) {
            insights.averageIncome = `$${match[1]}`;
          }
        }
      }
    }

    return insights;
  } catch (error) {
    console.error("Error getting demographic insights:", error);
    return {};
  }
}

/**
 * Research potential buyer personas for a property
 */
export async function researchBuyerPersonas(propertyDetails: {
  address: string;
  price?: number;
  bedrooms?: number;
  sqft?: number;
  propertyType?: string;
}): Promise<{
  personas: string[];
  targetAudience: string;
  marketingInsights: string[];
}> {
  try {
    const query = `who buys ${propertyDetails.propertyType || "homes"} in ${propertyDetails.address} ${
      propertyDetails.price ? `$${propertyDetails.price}` : ""
    } buyer demographics`;

    const response = await getExaClient().searchAndContents(query, {
      type: "auto",
      numResults: 5,
      text: { maxCharacters: 1500 },
      useAutoprompt: true,
    });

    // Process and synthesize buyer persona information
    const personas: string[] = [];
    const marketingInsights: string[] = [];

    for (const result of response.results) {
      if (result.text) {
        // Extract buyer type mentions
        const buyerTypes = [
          "first-time buyer",
          "investor",
          "family",
          "retiree",
          "professional",
          "millennial",
          "empty nester",
        ];

        for (const type of buyerTypes) {
          if (
            result.text.toLowerCase().includes(type) &&
            !personas.includes(type)
          ) {
            personas.push(type);
          }
        }
      }
    }

    return {
      personas: personas.length > 0 ? personas : ["General home buyer"],
      targetAudience: personas.join(", ") || "General market",
      marketingInsights,
    };
  } catch (error) {
    console.error("Error researching buyer personas:", error);
    return {
      personas: ["Unable to determine"],
      targetAudience: "General market",
      marketingInsights: [],
    };
  }
}
