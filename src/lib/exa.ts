import Exa from "exa-js";

if (!process.env.EXA_API_KEY) {
  console.warn("EXA_API_KEY is not set. Exa features will not work.");
}

export const exa = new Exa(process.env.EXA_API_KEY);

export interface PersonSearchResult {
  name: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  summary?: string;
  highlights?: string[];
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
 * Search for potential buyers based on property characteristics and location
 */
export async function searchPotentialBuyers(
  location: string,
  propertyType: string,
  priceRange: string
): Promise<PersonSearchResult[]> {
  try {
    const query = `real estate investor OR home buyer ${location} ${propertyType}`;
    
    const response = await exa.search(query, {
      type: "auto",
      category: "people",
      numResults: 10,
      useAutoprompt: true,
    });

    return response.results.map((result) => ({
      name: result.title || "Unknown",
      linkedinUrl: result.url,
      summary: result.text || undefined,
    }));
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
    
    const response = await exa.searchAndContents(demographicQuery, {
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
export async function researchBuyerPersonas(
  propertyDetails: {
    address: string;
    price?: number;
    bedrooms?: number;
    sqft?: number;
    propertyType?: string;
  }
): Promise<{
  personas: string[];
  targetAudience: string;
  marketingInsights: string[];
}> {
  try {
    const query = `who buys ${propertyDetails.propertyType || "homes"} in ${propertyDetails.address} ${
      propertyDetails.price ? `$${propertyDetails.price}` : ""
    } buyer demographics`;

    const response = await exa.searchAndContents(query, {
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
          if (result.text.toLowerCase().includes(type) && !personas.includes(type)) {
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
