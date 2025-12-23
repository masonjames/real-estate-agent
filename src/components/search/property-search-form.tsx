"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Search, MapPin, Info } from "lucide-react";

interface PropertySearchFormProps {
  onSearch: (address: string) => Promise<void>;
  isLoading?: boolean;
}

export function PropertySearchForm({
  onSearch,
  isLoading = false,
}: PropertySearchFormProps) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!address.trim()) {
      setError("Please enter an address");
      return;
    }

    try {
      await onSearch(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-primary/5 via-accent/5 to-success/5 p-1">
        <div className="bg-card rounded-t-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Search className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>Property Research</CardTitle>
                <CardDescription>
                  Enter an address to find potential buyers
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="123 Main St, Bradenton, FL 34201"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  error={error || undefined}
                  className="pl-10"
                />
              </div>

              <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Enter a full address including city, state, and ZIP code for
                  best results. Currently optimized for Manatee County, FL.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full gap-2"
                size="lg"
                isLoading={isLoading}
              >
                <Search className="w-5 h-5" />
                Research Property
              </Button>
            </form>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
