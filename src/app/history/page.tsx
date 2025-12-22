"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Search History</h1>
            <p className="text-gray-600 mt-2">
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
              <svg
                className="w-16 h-16 text-gray-300 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No searches yet
              </h3>
              <p className="text-gray-600 mb-6">
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
                  className={`cursor-pointer transition-colors ${
                    selectedSearch?.id === search.id
                      ? "ring-2 ring-blue-500"
                      : "hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedSearch(search)}
                >
                  <CardContent className="py-4">
                    <div className="font-medium text-gray-900 mb-1">
                      {search.address}
                    </div>
                    <div className="text-sm text-gray-500">
                      {search.city}, {search.state} {search.zipCode}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      {new Date(search.createdAt).toLocaleString()}
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
                    <CardTitle>{selectedSearch.address}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* Property Data */}
                      {selectedSearch.propertyData && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">
                            Property Details
                          </h4>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            {Object.entries(selectedSearch.propertyData)
                              .filter(
                                ([key]) =>
                                  !["rawData"].includes(key) &&
                                  selectedSearch.propertyData?.[key]
                              )
                              .map(([key, value]) => (
                                <div key={key}>
                                  <span className="text-gray-500 capitalize">
                                    {key.replace(/([A-Z])/g, " $1").trim()}:
                                  </span>{" "}
                                  <span className="text-gray-900">
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
                            <h4 className="font-medium text-gray-900 mb-3">
                              Area Demographics
                            </h4>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              {Object.entries(selectedSearch.demographicData)
                                .filter(
                                  ([, value]) =>
                                    value &&
                                    (typeof value !== "object" ||
                                      (Array.isArray(value) && value.length > 0))
                                )
                                .map(([key, value]) => (
                                  <div key={key}>
                                    <span className="text-gray-500 capitalize">
                                      {key.replace(/([A-Z])/g, " $1").trim()}:
                                    </span>{" "}
                                    <span className="text-gray-900">
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
                          <h4 className="font-medium text-gray-900 mb-3">
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
                                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm capitalize"
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
                  <CardContent className="py-16 text-center text-gray-500">
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
