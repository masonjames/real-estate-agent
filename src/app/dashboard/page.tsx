"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Header } from "@/components/layout/header";
import { PropertySearchForm } from "@/components/search/property-search-form";
import { ResearchResults } from "@/components/search/research-results";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { ResearchResult } from "@/lib/agent";

interface SavedSearch {
  id: number;
  address: string;
  city: string | null;
  state: string | null;
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<ResearchResult | null>(null);
  const [recentSearches, setRecentSearches] = useState<SavedSearch[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.push("/auth");
    }
  }, [session, isPending, router]);

  useEffect(() => {
    if (session?.user) {
      loadRecentSearches();
    }
  }, [session]);

  const loadRecentSearches = async () => {
    try {
      const response = await fetch("/api/research");
      if (response.ok) {
        const data = await response.json();
        setRecentSearches(data.searches?.slice(0, 5) || []);
      }
    } catch (error) {
      console.error("Failed to load history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSearch = async (address: string) => {
    setIsSearching(true);
    setSearchResult(null);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Search failed");
      }

      const data = await response.json();
      setSearchResult(data.result);
      loadRecentSearches(); // Refresh history
    } catch (error) {
      console.error("Search error:", error);
      alert(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleNewSearch = () => {
    setSearchResult(null);
  };

  const handleSave = () => {
    // Already saved during search, just show confirmation
    alert("Research saved to your history!");
  };

  if (isPending) {
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome back, {session.user.name?.split(" ")[0] || "there"}!
          </h1>
          <p className="text-gray-600 mt-2">
            Research properties and find potential buyers with AI-powered
            insights.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {!searchResult ? (
              <PropertySearchForm
                onSearch={handleSearch}
                isLoading={isSearching}
              />
            ) : (
              <ResearchResults
                result={searchResult}
                onSave={handleSave}
                onNewSearch={handleNewSearch}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle>Your Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {recentSearches.length}
                    </div>
                    <div className="text-sm text-gray-600">Searches</div>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {recentSearches.length * 3}
                    </div>
                    <div className="text-sm text-gray-600">Leads Found</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Searches */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Searches</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingHistory ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-12 bg-gray-100 rounded animate-pulse"
                      />
                    ))}
                  </div>
                ) : recentSearches.length > 0 ? (
                  <div className="space-y-3">
                    {recentSearches.map((search) => (
                      <div
                        key={search.id}
                        className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                        onClick={() => handleSearch(search.address)}
                      >
                        <div className="font-medium text-gray-900 text-sm truncate">
                          {search.address}
                        </div>
                        <div className="text-xs text-gray-500">
                          {search.city}, {search.state} &bull;{" "}
                          {new Date(search.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm text-center py-4">
                    No searches yet. Start by entering an address above.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Tips */}
            <Card>
              <CardHeader>
                <CardTitle>Pro Tips</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm text-gray-600">
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    Include ZIP code for more accurate results
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    Best results for Manatee County, FL properties
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    Save searches to build your lead database
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
