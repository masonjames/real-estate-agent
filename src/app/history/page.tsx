"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, MapPin, Users, Clock } from "lucide-react";

interface PropertySearch {
  id: number;
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  propertyData: Record<string, unknown> | null;
  demographicData: Record<string, unknown> | null;
  buyerMatches: Record<string, unknown> | null;
  createdAt: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [searches, setSearches] = useState<PropertySearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSearch, setSelectedSearch] = useState<PropertySearch | null>(
    null
  );

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.push("/auth");
    }
  }, [session, isPending, router]);

  useEffect(() => {
    if (session?.user) {
      loadSearches();
    }
  }, [session]);

  const loadSearches = async () => {
    try {
      const response = await fetch("/api/research");
      if (response.ok) {
        const data = await response.json();
        setSearches(data.searches || []);
      }
    } catch (error) {
      console.error("Failed to load searches:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isPending || isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Loading history...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Search History</h1>
            <p className="text-muted-foreground mt-2">
              View and manage your property research history.
            </p>
          </div>
          <Button onClick={() => router.push("/dashboard")}>
            New Search
          </Button>
        </div>

        {searches.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-muted/50 rounded-full flex items-center justify-center">
                <FileText className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No searches yet
              </h3>
              <p className="text-muted-foreground mb-6">
                Start researching properties to build your history.
              </p>
              <Button onClick={() => router.push("/dashboard")}>
                Start Searching
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Search List */}
            <div className="lg:col-span-1 space-y-4">
              {searches.map((search) => (
                <Card
                  key={search.id}
                  className={`cursor-pointer transition-all ${
                    selectedSearch?.id === search.id
                      ? "ring-2 ring-primary border-primary/50"
                      : "hover:bg-muted/50 hover:border-border/80"
                  }`}
                  onClick={() => setSelectedSearch(search)}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                        <MapPin className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground mb-1 truncate">
                          {search.address}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {search.city}, {search.state} {search.zipCode}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground/70 mt-2">
                          <Clock className="w-3 h-3" />
                          {new Date(search.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Selected Search Details */}
            <div className="lg:col-span-2">
              {selectedSearch ? (
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <MapPin className="w-5 h-5 text-primary" />
                      </div>
                      <CardTitle>{selectedSearch.address}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* Property Data */}
                      {selectedSearch.propertyData && (
                        <div>
                          <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" />
                            Property Details
                          </h4>
                          <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 rounded-lg p-4">
                            {Object.entries(selectedSearch.propertyData)
                              .filter(
                                ([key]) =>
                                  !["rawData"].includes(key) &&
                                  selectedSearch.propertyData?.[key]
                              )
                              .map(([key, value]) => (
                                <div key={key}>
                                  <span className="text-muted-foreground capitalize">
                                    {key.replace(/([A-Z])/g, " $1").trim()}:
                                  </span>{" "}
                                  <span className="text-foreground font-medium">
                                    {typeof value === "number"
                                      ? key.toLowerCase().includes("value") ||
                                        key.toLowerCase().includes("price") ||
                                        key.toLowerCase().includes("tax")
                                        ? `$${value.toLocaleString()}`
                                        : value.toLocaleString()
                                      : String(value)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* Demographics */}
                      {selectedSearch.demographicData &&
                        Object.keys(selectedSearch.demographicData).length >
                          0 && (
                          <div>
                            <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
                              <Users className="w-4 h-4 text-accent" />
                              Area Demographics
                            </h4>
                            <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 rounded-lg p-4">
                              {Object.entries(selectedSearch.demographicData)
                                .filter(
                                  ([, value]) =>
                                    value &&
                                    (typeof value !== "object" ||
                                      (Array.isArray(value) && value.length > 0))
                                )
                                .map(([key, value]) => (
                                  <div key={key}>
                                    <span className="text-muted-foreground capitalize">
                                      {key.replace(/([A-Z])/g, " $1").trim()}:
                                    </span>{" "}
                                    <span className="text-foreground font-medium">
                                      {Array.isArray(value)
                                        ? value.join(", ")
                                        : String(value)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                      {/* Buyer Matches */}
                      {selectedSearch.buyerMatches && (
                        <div>
                          <h4 className="font-medium text-foreground mb-3 flex items-center gap-2">
                            <Users className="w-4 h-4 text-success" />
                            Buyer Insights
                          </h4>
                          {(
                            selectedSearch.buyerMatches as {
                              personas?: { personas?: string[] };
                            }
                          )?.personas?.personas && (
                            <div className="flex flex-wrap gap-2 mb-4">
                              {(
                                selectedSearch.buyerMatches as {
                                  personas: { personas: string[] };
                                }
                              ).personas.personas.map((persona, i) => (
                                <span
                                  key={i}
                                  className="px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm font-medium capitalize"
                                >
                                  {persona}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    Select a search from the list to view details
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
