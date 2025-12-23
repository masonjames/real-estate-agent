"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Header } from "@/components/layout/header";
import { PropertySearchForm } from "@/components/search/property-search-form";
import { ResearchResults } from "@/components/search/research-results";
import { ResearchLoading } from "@/components/search/research-loading";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { ResearchResult } from "@/lib/agent";
import {
  Search,
  Users,
  Clock,
  Lightbulb,
  MapPin,
  TrendingUp,
} from "lucide-react";

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
  const [currentSearchAddress, setCurrentSearchAddress] = useState<string>("");
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
    // Validate address is not empty or just whitespace
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      alert("Please enter a valid address");
      return;
    }

    // Log the address being searched for debugging
    console.log("Starting search for address:", trimmedAddress);

    setCurrentSearchAddress(trimmedAddress);
    setIsSearching(true);
    setSearchResult(null);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: trimmedAddress }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Search failed");
      }

      const data = await response.json();
      setSearchResult(data.result);
      loadRecentSearches();
    } catch (error) {
      console.error("Search error:", error);
      alert(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
      setCurrentSearchAddress("");
    }
  };

  const handleNewSearch = () => {
    setSearchResult(null);
  };

  const handleSave = () => {
    alert("Research saved to your history!");
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Loading...</p>
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
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Welcome back, {session.user.name?.split(" ")[0] || "there"}!
          </h1>
          <p className="text-muted-foreground mt-2">
            Research properties and find potential buyers with AI-powered
            insights.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {isSearching && currentSearchAddress ? (
              <ResearchLoading address={currentSearchAddress} />
            ) : searchResult ? (
              <ResearchResults
                result={searchResult}
                onSave={handleSave}
                onNewSearch={handleNewSearch}
              />
            ) : (
              <PropertySearchForm
                onSearch={handleSearch}
                isLoading={isSearching}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  <CardTitle>Your Stats</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-primary/10 rounded-xl">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Search className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {recentSearches.length}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Searches
                    </div>
                  </div>
                  <div className="text-center p-4 bg-success/10 rounded-xl">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-success" />
                    </div>
                    <div className="text-2xl font-bold text-success">
                      {recentSearches.length * 3}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Leads Found
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Searches */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <CardTitle>Recent Searches</CardTitle>
                    <CardDescription>
                      Click to search again
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingHistory ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : recentSearches.length > 0 ? (
                  <div className="space-y-2">
                    {recentSearches.map((search) => (
                      <button
                        key={search.id}
                        className="w-full p-3 bg-muted/50 rounded-lg hover:bg-muted text-left transition-colors group"
                        onClick={() => handleSearch(search.address)}
                      >
                        <div className="flex items-start gap-3">
                          <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-foreground text-sm truncate group-hover:text-primary transition-colors">
                              {search.address}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {search.city}, {search.state} &middot;{" "}
                              {new Date(search.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Search className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">
                      No searches yet. Start by entering an address above.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tips */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-accent" />
                  <CardTitle>Pro Tips</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <Badge variant="accent" className="mt-0.5 shrink-0">
                      1
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Include ZIP code for more accurate results
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Badge variant="accent" className="mt-0.5 shrink-0">
                      2
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Best results for Manatee County, FL properties
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Badge variant="accent" className="mt-0.5 shrink-0">
                      3
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Save searches to build your lead database
                    </span>
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
