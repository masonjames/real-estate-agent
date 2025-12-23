"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Search,
  Building2,
  MapPin,
  Users,
  TrendingUp,
  Lightbulb,
  CheckCircle2,
  Loader2,
} from "lucide-react";

interface ResearchLoadingProps {
  address: string;
}

interface LoadingStep {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  duration: number; // milliseconds
}

const LOADING_STEPS: LoadingStep[] = [
  {
    id: "connect",
    icon: <Search className="w-5 h-5" />,
    title: "Connecting to Property Records",
    description: "Accessing Manatee County Property Appraiser database...",
    duration: 2000,
  },
  {
    id: "search",
    icon: <MapPin className="w-5 h-5" />,
    title: "Searching Property Records",
    description: "Looking up property details and parcel information...",
    duration: 4000,
  },
  {
    id: "extract",
    icon: <Building2 className="w-5 h-5" />,
    title: "Extracting Property Data",
    description: "Gathering valuations, sales history, and building details...",
    duration: 5000,
  },
  {
    id: "demographics",
    icon: <Users className="w-5 h-5" />,
    title: "Analyzing Demographics",
    description: "Researching area demographics and market trends...",
    duration: 3000,
  },
  {
    id: "buyers",
    icon: <TrendingUp className="w-5 h-5" />,
    title: "Finding Potential Buyers",
    description: "Identifying buyer profiles and lead matches...",
    duration: 4000,
  },
  {
    id: "insights",
    icon: <Lightbulb className="w-5 h-5" />,
    title: "Generating Insights",
    description: "Creating personalized recommendations...",
    duration: 2000,
  },
];

export function ResearchLoading({ address }: ResearchLoadingProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const advanceStep = () => {
      if (currentStepIndex < LOADING_STEPS.length - 1) {
        // Mark current step as completed
        setCompletedSteps((prev) => {
          const newSet = new Set(prev);
          newSet.add(LOADING_STEPS[currentStepIndex].id);
          return newSet;
        });

        // Move to next step
        setCurrentStepIndex((prev) => prev + 1);

        // Schedule next advancement
        timeoutId = setTimeout(
          advanceStep,
          LOADING_STEPS[currentStepIndex + 1].duration
        );
      }
    };

    // Start the first step advancement
    timeoutId = setTimeout(advanceStep, LOADING_STEPS[0].duration);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [currentStepIndex]);

  const currentStep = LOADING_STEPS[currentStepIndex];

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-primary/10 via-accent/5 to-success/10 p-1">
        <div className="bg-card rounded-t-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
              <div>
                <CardTitle>Researching Property</CardTitle>
                <CardDescription className="font-medium text-foreground">
                  {address}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current Step Highlight */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary animate-pulse">
                  {currentStep.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">
                    {currentStep.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {currentStep.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Progress Steps */}
            <div className="space-y-3">
              {LOADING_STEPS.map((step, index) => {
                const isCompleted = completedSteps.has(step.id);
                const isCurrent = index === currentStepIndex;
                const isPending = index > currentStepIndex;

                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                      isCompleted
                        ? "bg-success/10 text-success"
                        : isCurrent
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg ${
                        isCompleted
                          ? "bg-success/20"
                          : isCurrent
                            ? "bg-primary/20"
                            : "bg-muted/50"
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : isCurrent ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-current opacity-50" />
                      )}
                    </div>
                    <span
                      className={`text-sm font-medium ${
                        isPending ? "opacity-50" : ""
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Fun Facts / Tips */}
            <div className="border-t border-border pt-6">
              <p className="text-xs text-muted-foreground text-center">
                This typically takes 15-30 seconds. We&apos;re gathering comprehensive
                property data from multiple sources to give you the most accurate
                insights.
              </p>
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
