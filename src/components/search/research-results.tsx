"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ResearchResult } from "@/lib/agent";

interface ResearchResultsProps {
  result: ResearchResult;
  onSave?: () => void;
  onNewSearch?: () => void;
}

export function ResearchResults({
  result,
  onSave,
  onNewSearch,
}: ResearchResultsProps) {
  const { property, demographics, potentialBuyers, buyerPersonas, summary, recommendations } =
    result;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Research Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-700">{summary}</p>
        </CardContent>
      </Card>

      {/* Property Details */}
      {property && (
        <Card>
          <CardHeader>
            <CardTitle>Property Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <DetailItem label="Address" value={property.address} />
              <DetailItem
                label="City"
                value={`${property.city}, ${property.state} ${property.zipCode}`}
              />
              <DetailItem label="Property Type" value={property.propertyType} />
              <DetailItem label="Year Built" value={property.yearBuilt?.toString()} />
              <DetailItem
                label="Bedrooms"
                value={property.bedrooms?.toString()}
              />
              <DetailItem
                label="Bathrooms"
                value={property.bathrooms?.toString()}
              />
              <DetailItem
                label="Sq Ft"
                value={property.sqft?.toLocaleString()}
              />
              <DetailItem label="Lot Size" value={property.lotSize} />
              <DetailItem label="Zoning" value={property.zoning} />
              <DetailItem
                label="Assessed Value"
                value={
                  property.assessedValue
                    ? `$${property.assessedValue.toLocaleString()}`
                    : undefined
                }
              />
              <DetailItem
                label="Market Value"
                value={
                  property.marketValue
                    ? `$${property.marketValue.toLocaleString()}`
                    : undefined
                }
              />
              <DetailItem
                label="Annual Taxes"
                value={
                  property.taxAmount
                    ? `$${property.taxAmount.toLocaleString()}`
                    : undefined
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demographics */}
      {demographics && Object.keys(demographics).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Area Demographics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem label="Median Income" value={demographics.averageIncome} />
              <DetailItem
                label="Predominant Age"
                value={demographics.predominantAge}
              />
              <DetailItem
                label="Education Level"
                value={demographics.educationLevel}
              />
            </div>
            {demographics.commonOccupations &&
              demographics.commonOccupations.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">
                    Common Occupations
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {demographics.commonOccupations.map((occupation, i) => (
                      <span
                        key={i}
                        className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                      >
                        {occupation}
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {/* Buyer Personas */}
      {buyerPersonas && buyerPersonas.personas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Target Buyer Profiles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-500 mb-2">
                Target Audience
              </h4>
              <p className="text-gray-700">{buyerPersonas.targetAudience}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-500 mb-2">
                Buyer Personas
              </h4>
              <div className="flex flex-wrap gap-2">
                {buyerPersonas.personas.map((persona, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm capitalize"
                  >
                    {persona}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Potential Buyers */}
      {potentialBuyers && potentialBuyers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Potential Buyer Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {potentialBuyers.slice(0, 5).map((buyer, i) => (
                <div
                  key={i}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">{buyer.name}</h4>
                      {buyer.title && (
                        <p className="text-sm text-gray-600">{buyer.title}</p>
                      )}
                      {buyer.company && (
                        <p className="text-sm text-gray-500">{buyer.company}</p>
                      )}
                    </div>
                    {buyer.linkedinUrl && (
                      <a
                        href={buyer.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        View Profile
                      </a>
                    )}
                  </div>
                  {buyer.summary && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                      {buyer.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start">
                  <svg
                    className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-gray-700">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={onNewSearch}>
              New Search
            </Button>
            <Button onClick={onSave}>Save Research</Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
}
