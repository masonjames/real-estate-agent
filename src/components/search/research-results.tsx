"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadCard, LeadGrid, LeadEmptyState, type LeadData } from "./lead-card";
import { SkeletonLeadCard } from "@/components/ui/skeleton";
import type { ResearchResult } from "@/lib/agent";
import {
  Home,
  MapPin,
  DollarSign,
  Calendar,
  Bed,
  Bath,
  Ruler,
  Users,
  Target,
  Lightbulb,
  CheckCircle2,
  Building2,
  TrendingUp,
} from "lucide-react";

interface ResearchResultsProps {
  result: ResearchResult;
  onSave?: () => void;
  onNewSearch?: () => void;
  isLoading?: boolean;
}

export function ResearchResults({
  result,
  onSave,
  onNewSearch,
  isLoading = false,
}: ResearchResultsProps) {
  const {
    property,
    demographics,
    potentialBuyers,
    buyerPersonas,
    summary,
    recommendations,
  } = result;

  // Convert potentialBuyers to LeadData format
  const leads: LeadData[] = React.useMemo(() => {
    return (potentialBuyers || []).map((buyer) => ({
      name: buyer.name,
      title: buyer.title,
      company: buyer.company,
      location: buyer.location,
      linkedinUrl: buyer.linkedinUrl,
      summary: buyer.summary,
      highlights: buyer.highlights,
      imageUrl: buyer.imageUrl || null,
      matchScore: buyer.matchScore || 60,
      matchCriteria: buyer.matchCriteria || ["Active Market Interest"],
    }));
  }, [potentialBuyers]);

  return (
    <div className="space-y-8">
      {/* Summary Card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 via-accent/5 to-success/10 p-1">
          <div className="bg-card rounded-t-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Lightbulb className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Research Summary</CardTitle>
                  <CardDescription>
                    AI-generated insights for your property
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">{summary}</p>
            </CardContent>
          </div>
        </div>
      </Card>

      {/* Property Details */}
      {property && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-success/10">
                <Home className="w-5 h-5 text-success" />
              </div>
              <div>
                <CardTitle>Property Details</CardTitle>
                <CardDescription>{property.address}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <PropertyDetail
                icon={<MapPin className="w-4 h-4" />}
                label="Location"
                value={`${property.city}, ${property.state} ${property.zipCode}`}
              />
              <PropertyDetail
                icon={<Building2 className="w-4 h-4" />}
                label="Property Type"
                value={property.propertyType}
              />
              <PropertyDetail
                icon={<Calendar className="w-4 h-4" />}
                label="Year Built"
                value={property.yearBuilt?.toString()}
              />
              <PropertyDetail
                icon={<Bed className="w-4 h-4" />}
                label="Bedrooms"
                value={property.bedrooms?.toString()}
              />
              <PropertyDetail
                icon={<Bath className="w-4 h-4" />}
                label="Bathrooms"
                value={property.bathrooms?.toString()}
              />
              <PropertyDetail
                icon={<Ruler className="w-4 h-4" />}
                label="Sq Ft"
                value={property.sqft?.toLocaleString()}
              />
              <PropertyDetail
                icon={<DollarSign className="w-4 h-4" />}
                label="Assessed Value"
                value={
                  property.assessedValue
                    ? `$${property.assessedValue.toLocaleString()}`
                    : undefined
                }
              />
              <PropertyDetail
                icon={<TrendingUp className="w-4 h-4" />}
                label="Market Value"
                value={
                  property.marketValue
                    ? `$${property.marketValue.toLocaleString()}`
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
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-accent/10">
                <Users className="w-5 h-5 text-accent" />
              </div>
              <div>
                <CardTitle>Area Demographics</CardTitle>
                <CardDescription>
                  Population and economic insights
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
              <DemographicStat
                label="Median Income"
                value={demographics.averageIncome}
              />
              <DemographicStat
                label="Predominant Age"
                value={demographics.predominantAge}
              />
              <DemographicStat
                label="Education Level"
                value={demographics.educationLevel}
              />
            </div>
            {demographics.commonOccupations &&
              demographics.commonOccupations.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">
                    Common Occupations
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {demographics.commonOccupations.map((occupation, i) => (
                      <Badge key={i} variant="secondary">
                        {occupation}
                      </Badge>
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
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Target Buyer Profiles</CardTitle>
                <CardDescription>
                  Ideal buyers based on property characteristics
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Target Audience
              </h4>
              <p className="text-foreground">{buyerPersonas.targetAudience}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3">
                Buyer Personas
              </h4>
              <div className="flex flex-wrap gap-2">
                {buyerPersonas.personas.map((persona, i) => (
                  <Badge key={i} variant="default" className="capitalize">
                    {persona}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Potential Buyer Leads */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-success/10">
              <Users className="w-5 h-5 text-success" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Potential Buyer Leads
              </h2>
              <p className="text-sm text-muted-foreground">
                {leads.length} matches found
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <LeadGrid>
            {[1, 2, 3, 4].map((i) => (
              <SkeletonLeadCard key={i} />
            ))}
          </LeadGrid>
        ) : leads.length > 0 ? (
          <LeadGrid>
            {leads.map((lead, i) => (
              <LeadCard
                key={i}
                lead={lead}
                onSave={(l) => console.log("Save lead:", l)}
                onContact={(l) => console.log("Contact lead:", l)}
              />
            ))}
          </LeadGrid>
        ) : (
          <LeadEmptyState />
        )}
      </div>

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <CardTitle>Recommendations</CardTitle>
                <CardDescription>Next steps for your property</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <div className="border-t border-border p-6 flex flex-col sm:flex-row justify-between gap-4">
            <Button variant="outline" onClick={onNewSearch}>
              New Search
            </Button>
            <Button onClick={onSave}>Save Research</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function PropertyDetail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | undefined;
}) {
  if (!value) return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
      <div className="text-muted-foreground mt-0.5">{icon}</div>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </dt>
        <dd className="text-sm font-medium text-foreground mt-0.5 truncate">
          {value}
        </dd>
      </div>
    </div>
  );
}

function DemographicStat({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  if (!value) return null;

  return (
    <div className="text-center p-4 rounded-lg bg-muted/50">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </dt>
      <dd className="text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}
