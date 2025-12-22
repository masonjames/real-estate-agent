"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle>Property Research</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Property Address"
            type="text"
            placeholder="123 Main St, Bradenton, FL 34201"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            error={error || undefined}
          />

          <div className="text-sm text-gray-500">
            Enter a full address including city, state, and ZIP code for best
            results. Currently optimized for Manatee County, FL.
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            isLoading={isLoading}
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            Research Property
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
