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
  Thermometer,
  Wind,
  Car,
  Waves,
  Flame,
  LandPlot,
  FileText,
  History,
  Receipt,
  Building,
  Fence,
  Zap,
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
    error,
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

  // Show error state if property search failed
  if (error && !property) {
    return (
      <div className="space-y-6">
        {/* Error Card */}
        <Card className="overflow-hidden border-destructive/50">
          <div className="bg-gradient-to-r from-destructive/10 via-destructive/5 to-destructive/10 p-1">
            <div className="bg-card rounded-t-lg">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <MapPin className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-destructive">Property Not Found</CardTitle>
                    <CardDescription>
                      Unable to retrieve property information
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed mb-4">{error}</p>
              </CardContent>
            </div>
          </div>
        </Card>

        {/* Recommendations Card */}
        {recommendations && recommendations.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Suggestions</CardTitle>
                  <CardDescription>Try these steps to resolve the issue</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <div className="border-t border-border p-6">
              <Button onClick={onNewSearch} className="w-full sm:w-auto">
                Try Another Search
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }

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

      {/* Property Details - Basic Info */}
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
          <CardContent className="space-y-6">
            {/* Basic Info Grid */}
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
                icon={<FileText className="w-4 h-4" />}
                label="Parcel ID"
                value={property.parcelId}
              />
              <PropertyDetail
                icon={<Users className="w-4 h-4" />}
                label="Owner"
                value={property.owner}
              />
              {property.basicInfo?.subdivision && (
                <PropertyDetail
                  icon={<Fence className="w-4 h-4" />}
                  label="Subdivision"
                  value={property.basicInfo.subdivision}
                />
              )}
              {property.basicInfo?.jurisdiction && (
                <PropertyDetail
                  icon={<Building className="w-4 h-4" />}
                  label="Jurisdiction"
                  value={property.basicInfo.jurisdiction}
                />
              )}
            </div>

            {/* Building Details Section */}
            {(property.building || property.yearBuilt || property.sqft) && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Building Details
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  <PropertyDetail
                    icon={<Calendar className="w-4 h-4" />}
                    label="Year Built"
                    value={property.yearBuilt?.toString() || property.building?.yearBuilt?.toString()}
                  />
                  <PropertyDetail
                    icon={<Bed className="w-4 h-4" />}
                    label="Bedrooms"
                    value={property.bedrooms?.toString() || property.building?.bedrooms?.toString()}
                  />
                  <PropertyDetail
                    icon={<Bath className="w-4 h-4" />}
                    label="Bathrooms"
                    value={property.bathrooms?.toString() || property.building?.bathrooms?.toString()}
                  />
                  <PropertyDetail
                    icon={<Ruler className="w-4 h-4" />}
                    label="Living Area"
                    value={property.sqft?.toLocaleString() || property.building?.livingAreaSqFt?.toLocaleString()}
                  />
                  {property.building?.totalAreaSqFt && (
                    <PropertyDetail
                      icon={<Ruler className="w-4 h-4" />}
                      label="Total Under Roof"
                      value={`${property.building.totalAreaSqFt.toLocaleString()} sqft`}
                    />
                  )}
                  {property.building?.stories && (
                    <PropertyDetail
                      icon={<Building2 className="w-4 h-4" />}
                      label="Stories"
                      value={property.building.stories.toString()}
                    />
                  )}
                  {property.building?.constructionType && (
                    <PropertyDetail
                      icon={<Building className="w-4 h-4" />}
                      label="Construction"
                      value={property.building.constructionType}
                    />
                  )}
                  {property.building?.foundation && (
                    <PropertyDetail
                      icon={<LandPlot className="w-4 h-4" />}
                      label="Foundation"
                      value={property.building.foundation}
                    />
                  )}
                  {property.building?.roofCover && (
                    <PropertyDetail
                      icon={<Home className="w-4 h-4" />}
                      label="Roof"
                      value={property.building.roofCover}
                    />
                  )}
                  {property.building?.flooring && (
                    <PropertyDetail
                      icon={<LandPlot className="w-4 h-4" />}
                      label="Flooring"
                      value={property.building.flooring}
                    />
                  )}
                  {property.building?.heating && (
                    <PropertyDetail
                      icon={<Thermometer className="w-4 h-4" />}
                      label="Heating"
                      value={property.building.heating}
                    />
                  )}
                  {property.building?.cooling && (
                    <PropertyDetail
                      icon={<Wind className="w-4 h-4" />}
                      label="Cooling"
                      value={property.building.cooling}
                    />
                  )}
                  {property.building?.electricUtility !== undefined && (
                    <PropertyDetail
                      icon={<Zap className="w-4 h-4" />}
                      label="Electric"
                      value={property.building.electricUtility ? "Yes" : "No"}
                    />
                  )}
                  {property.building?.garage && (
                    <PropertyDetail
                      icon={<Car className="w-4 h-4" />}
                      label="Garage"
                      value={property.building.garage.spaces
                        ? `${property.building.garage.spaces} spaces`
                        : property.building.garage.type || "Yes"}
                    />
                  )}
                  {property.building?.pool?.hasPool && (
                    <PropertyDetail
                      icon={<Waves className="w-4 h-4" />}
                      label="Pool"
                      value={property.building.pool.type || "Yes"}
                    />
                  )}
                  {property.building?.hasFireplace !== undefined && (
                    <PropertyDetail
                      icon={<Flame className="w-4 h-4" />}
                      label="Fireplace"
                      value={property.building.hasFireplace ? "Yes" : "No"}
                    />
                  )}
                </div>

                {/* Appliances */}
                {property.building?.appliances && property.building.appliances.length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-xs font-medium text-muted-foreground mb-2">Appliances</h5>
                    <div className="flex flex-wrap gap-2">
                      {property.building.appliances.map((appliance, i) => (
                        <Badge key={i} variant="secondary">{appliance}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Interior Features */}
                {property.building?.interiorFeatures && property.building.interiorFeatures.length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-xs font-medium text-muted-foreground mb-2">Interior Features</h5>
                    <div className="flex flex-wrap gap-2">
                      {property.building.interiorFeatures.map((feature, i) => (
                        <Badge key={i} variant="outline">{feature}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Land Details Section */}
            {property.land && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                  <LandPlot className="w-4 h-4" />
                  Land Details
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {property.land.lotSizeAcres && (
                    <PropertyDetail
                      icon={<LandPlot className="w-4 h-4" />}
                      label="Lot Size"
                      value={`${property.land.lotSizeAcres} acres`}
                    />
                  )}
                  {property.land.lotSizeSqFt && (
                    <PropertyDetail
                      icon={<Ruler className="w-4 h-4" />}
                      label="Lot Size (Sq Ft)"
                      value={property.land.lotSizeSqFt.toLocaleString()}
                    />
                  )}
                  {property.land.landUse && (
                    <PropertyDetail
                      icon={<FileText className="w-4 h-4" />}
                      label="Land Use"
                      value={property.land.landUse}
                    />
                  )}
                  {property.land.roadSurfaceType && (
                    <PropertyDetail
                      icon={<MapPin className="w-4 h-4" />}
                      label="Road Surface"
                      value={property.land.roadSurfaceType}
                    />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Valuations Card */}
      {property?.valuations && property.valuations.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Property Valuations</CardTitle>
                <CardDescription>Tax assessments and market values</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary Values */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <PropertyDetail
                icon={<TrendingUp className="w-4 h-4" />}
                label="Market Value"
                value={property.marketValue ? `$${property.marketValue.toLocaleString()}` : undefined}
              />
              <PropertyDetail
                icon={<DollarSign className="w-4 h-4" />}
                label="Assessed Value"
                value={property.assessedValue ? `$${property.assessedValue.toLocaleString()}` : undefined}
              />
              <PropertyDetail
                icon={<Receipt className="w-4 h-4" />}
                label="Annual Taxes"
                value={property.taxAmount ? `$${property.taxAmount.toLocaleString()}` : undefined}
              />
              {property.listing?.pricePerSqFt && (
                <PropertyDetail
                  icon={<Ruler className="w-4 h-4" />}
                  label="Price/Sq Ft"
                  value={`$${property.listing.pricePerSqFt}/sqft`}
                />
              )}
            </div>

            {/* Valuations Table */}
            {property.valuations.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Year</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">Land</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">Building</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">Just/Market</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">Taxes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.valuations.slice(0, 5).map((val, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2 px-2 font-medium">{val.year}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">
                          {val.just?.land ? `$${val.just.land.toLocaleString()}` : "-"}
                        </td>
                        <td className="py-2 px-2 text-right text-muted-foreground">
                          {val.just?.building ? `$${val.just.building.toLocaleString()}` : "-"}
                        </td>
                        <td className="py-2 px-2 text-right font-medium">
                          {val.just?.total ? `$${val.just.total.toLocaleString()}` : "-"}
                        </td>
                        <td className="py-2 px-2 text-right text-muted-foreground">
                          {val.adValoremTaxes ? `$${val.adValoremTaxes.toLocaleString()}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sales History Card */}
      {property?.salesHistory && property.salesHistory.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-accent/10">
                <History className="w-5 h-5 text-accent" />
              </div>
              <div>
                <CardTitle>Sales History</CardTitle>
                <CardDescription>Previous property transactions</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Date</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Price</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Buyer</th>
                  </tr>
                </thead>
                <tbody>
                  {property.salesHistory.map((sale, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 px-2">{sale.date}</td>
                      <td className="py-2 px-2 text-right font-medium">
                        {sale.price ? `$${sale.price.toLocaleString()}` : "-"}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{sale.deedType || "-"}</td>
                      <td className="py-2 px-2 text-muted-foreground truncate max-w-[200px]">
                        {sale.grantee || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Community & HOA Card */}
      {property?.community && (property.community.subdivisionName || property.community.hasHoa !== undefined) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-success/10">
                <Fence className="w-5 h-5 text-success" />
              </div>
              <div>
                <CardTitle>Community & HOA</CardTitle>
                <CardDescription>Neighborhood information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {property.community.subdivisionName && (
                <PropertyDetail
                  icon={<Fence className="w-4 h-4" />}
                  label="Subdivision"
                  value={property.community.subdivisionName}
                />
              )}
              <PropertyDetail
                icon={<Building className="w-4 h-4" />}
                label="Has HOA"
                value={property.community.hasHoa ? "Yes" : "No"}
              />
              {property.community.hoaFee !== undefined && property.community.hoaFee > 0 && (
                <PropertyDetail
                  icon={<DollarSign className="w-4 h-4" />}
                  label="HOA Fee"
                  value={`$${property.community.hoaFee}${property.community.hoaFeeFrequency ? `/${property.community.hoaFeeFrequency}` : ""}`}
                />
              )}
              {property.community.petFee !== undefined && (
                <PropertyDetail
                  icon={<DollarSign className="w-4 h-4" />}
                  label="Pet Fee"
                  value={`$${property.community.petFee}${property.community.petFeeFrequency ? `/${property.community.petFeeFrequency}` : ""}`}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extra Features Card */}
      {property?.extras?.features && property.extras.features.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <CheckCircle2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Property Features</CardTitle>
                <CardDescription>Highlights and amenities</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {property.extras.features.map((feature, i) => (
                <Badge key={i} variant="default">{feature}</Badge>
              ))}
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
