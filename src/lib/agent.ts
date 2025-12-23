/**
 * Real Estate Demographic Research Agent
 * 
 * Uses Claude Agent SDK to orchestrate property research and buyer matching.
 */

import { searchProperty, type PropertyDetails } from "./property-search";
import {
  searchPotentialBuyers,
  getDemographicInsights,
  researchBuyerPersonas,
  type PersonSearchResult,
  type DemographicInsights,
} from "./exa";

export interface ResearchResult {
  property: PropertyDetails | null;
  demographics: DemographicInsights;
  potentialBuyers: PersonSearchResult[];
  buyerPersonas: {
    personas: string[];
    targetAudience: string;
    marketingInsights: string[];
  };
  summary: string;
  recommendations: string[];
  error?: string; // Error message if property search failed
}

/**
 * Main research agent that orchestrates all property and demographic research
 */
export async function runPropertyResearchAgent(
  address: string,
  options?: {
    includeDemographics?: boolean;
    includeBuyerSearch?: boolean;
    includePersonas?: boolean;
  }
): Promise<ResearchResult> {
  const {
    includeDemographics = true,
    includeBuyerSearch = true,
    includePersonas = true,
  } = options || {};

  // Step 1: Search for property details
  const propertyResults = await searchProperty(address);
  const successfulResult = propertyResults.find((r) => r.success);
  const failedResult = propertyResults.find((r) => !r.success && r.error);
  const property = successfulResult?.property || null;
  const propertyError = !property && failedResult?.error ? failedResult.error : undefined;

  // If property search failed, return early with error
  if (!property && propertyError) {
    return {
      property: null,
      demographics: {},
      potentialBuyers: [],
      buyerPersonas: {
        personas: [],
        targetAudience: "",
        marketingInsights: [],
      },
      summary: propertyError,
      recommendations: [
        "Verify the address is correct and complete",
        "Ensure the property is located in Manatee County, Florida",
        "Try searching with a slightly different address format",
        "Contact support if the problem persists",
      ],
      error: propertyError,
    };
  }

  // Step 2: Get demographic insights if property found
  let demographics: DemographicInsights = {};
  if (includeDemographics && property) {
    demographics = await getDemographicInsights(
      `${property.city}, ${property.state}`,
      property.zipCode
    );
  }

  // Step 3: Search for potential buyers
  let potentialBuyers: PersonSearchResult[] = [];
  if (includeBuyerSearch && property) {
    potentialBuyers = await searchPotentialBuyers(
      `${property.city}, ${property.state}`,
      property.propertyType || "residential",
      property.marketValue ? `$${property.marketValue}` : "market rate"
    );
  }

  // Step 4: Research buyer personas
  let buyerPersonas = {
    personas: [] as string[],
    targetAudience: "",
    marketingInsights: [] as string[],
  };
  if (includePersonas && property) {
    buyerPersonas = await researchBuyerPersonas({
      address: property.address,
      price: property.marketValue,
      bedrooms: property.bedrooms,
      sqft: property.sqft,
      propertyType: property.propertyType,
    });
  }

  // Step 5: Generate summary and recommendations
  const summary = generateSummary(property, demographics, buyerPersonas);
  const recommendations = generateRecommendations(
    property,
    demographics,
    potentialBuyers,
    buyerPersonas
  );

  return {
    property,
    demographics,
    potentialBuyers,
    buyerPersonas,
    summary,
    recommendations,
  };
}

/**
 * Generate a natural language summary of the research
 */
function generateSummary(
  property: PropertyDetails | null,
  demographics: DemographicInsights,
  buyerPersonas: { personas: string[]; targetAudience: string }
): string {
  if (!property) {
    return "Unable to find property information for the given address.";
  }

  const parts: string[] = [];

  // Property summary
  parts.push(
    `${property.address} is a ${property.propertyType || "property"} ` +
      `${property.yearBuilt ? `built in ${property.yearBuilt}` : ""}.`
  );

  if (property.bedrooms || property.bathrooms || property.sqft) {
    parts.push(
      `It features ${property.bedrooms || "N/A"} bedrooms, ` +
        `${property.bathrooms || "N/A"} bathrooms, and ${property.sqft || "N/A"} sqft.`
    );
  }

  if (property.marketValue) {
    parts.push(`The estimated market value is $${property.marketValue.toLocaleString()}.`);
  }

  // Demographics summary
  if (demographics.averageIncome) {
    parts.push(`The area has a median income of ${demographics.averageIncome}.`);
  }

  // Target audience
  if (buyerPersonas.targetAudience) {
    parts.push(`Target buyer profiles include: ${buyerPersonas.targetAudience}.`);
  }

  return parts.join(" ");
}

/**
 * Generate actionable recommendations based on research
 */
function generateRecommendations(
  property: PropertyDetails | null,
  demographics: DemographicInsights,
  potentialBuyers: PersonSearchResult[],
  buyerPersonas: { personas: string[]; marketingInsights: string[] }
): string[] {
  const recommendations: string[] = [];

  if (!property) {
    recommendations.push("Verify the address and try again with more specific details.");
    return recommendations;
  }

  // Price-based recommendations
  if (property.marketValue && property.assessedValue) {
    const ratio = property.marketValue / property.assessedValue;
    if (ratio > 1.2) {
      recommendations.push(
        "Property may be overvalued compared to assessed value. Consider competitive pricing."
      );
    } else if (ratio < 0.9) {
      recommendations.push(
        "Property appears undervalued. Good investment potential."
      );
    }
  }

  // Buyer persona recommendations
  if (buyerPersonas.personas.includes("first-time buyer")) {
    recommendations.push(
      "Consider highlighting FHA loan eligibility and first-time buyer programs."
    );
  }

  if (buyerPersonas.personas.includes("investor")) {
    recommendations.push(
      "Prepare rental income projections and ROI analysis for investor buyers."
    );
  }

  if (buyerPersonas.personas.includes("family")) {
    recommendations.push(
      "Emphasize nearby schools, parks, and family-friendly amenities."
    );
  }

  // Potential buyer recommendations
  if (potentialBuyers.length > 0) {
    recommendations.push(
      `Identified ${potentialBuyers.length} potential buyer leads to pursue.`
    );
  }

  // Default recommendations
  if (recommendations.length === 0) {
    recommendations.push(
      "Ensure professional photography and virtual tour are available."
    );
    recommendations.push(
      "Consider staging to appeal to the target demographic."
    );
  }

  return recommendations;
}

/**
 * Quick property lookup without full research
 */
export async function quickPropertyLookup(
  address: string
): Promise<PropertyDetails | null> {
  const results = await searchProperty(address);
  const successful = results.find((r) => r.success);
  return successful?.property || null;
}

/**
 * Get buyer insights for a specific property
 */
export async function getBuyerInsights(
  property: PropertyDetails
): Promise<{
  demographics: DemographicInsights;
  personas: string[];
  potentialBuyers: PersonSearchResult[];
}> {
  const [demographics, buyerPersonas, potentialBuyers] = await Promise.all([
    getDemographicInsights(
      `${property.city}, ${property.state}`,
      property.zipCode
    ),
    researchBuyerPersonas({
      address: property.address,
      price: property.marketValue,
      bedrooms: property.bedrooms,
      sqft: property.sqft,
      propertyType: property.propertyType,
    }),
    searchPotentialBuyers(
      `${property.city}, ${property.state}`,
      property.propertyType || "residential",
      property.marketValue ? `$${property.marketValue}` : "market rate"
    ),
  ]);

  return {
    demographics,
    personas: buyerPersonas.personas,
    potentialBuyers,
  };
}
