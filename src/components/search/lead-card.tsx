"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge, MatchBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Linkedin,
  Mail,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Briefcase,
  Building2,
} from "lucide-react";

export interface LeadData {
  name: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  email?: string;
  summary?: string;
  highlights?: string[];
  imageUrl?: string | null;
  matchScore?: number;
  matchCriteria?: string[];
}

interface LeadCardProps {
  lead: LeadData;
  onSave?: (lead: LeadData) => void;
  onContact?: (lead: LeadData) => void;
  isSaved?: boolean;
  className?: string;
}

function MatchScoreIndicator({ score }: { score: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-primary";
    if (score >= 40) return "text-accent";
    return "text-muted-foreground";
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-muted/30"
        />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={cn("transition-all duration-500", getScoreColor(score))}
        />
      </svg>
      <span
        className={cn(
          "absolute text-xs font-bold",
          getScoreColor(score)
        )}
      >
        {Math.round(percentage)}
      </span>
    </div>
  );
}

export function LeadCard({
  lead,
  onSave,
  onContact,
  isSaved = false,
  className,
}: LeadCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [saved, setSaved] = React.useState(isSaved);

  const handleSave = () => {
    setSaved(!saved);
    onSave?.(lead);
  };

  const handleContact = () => {
    onContact?.(lead);
  };

  return (
    <div
      className={cn(
        "group rounded-xl border border-border bg-card overflow-hidden transition-all duration-200",
        "hover:shadow-lg hover:border-primary/20",
        className
      )}
    >
      {/* Main Content */}
      <div className="p-6">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-4">
          {/* Left: Avatar and Info */}
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <UserAvatar
              name={lead.name}
              imageUrl={lead.imageUrl}
              size="lg"
              className="shrink-0 ring-2 ring-background shadow-md"
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-lg text-card-foreground truncate">
                {lead.name}
              </h3>
              {(lead.title || lead.company) && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  {lead.title && (
                    <>
                      <Briefcase className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{lead.title}</span>
                    </>
                  )}
                  {lead.title && lead.company && (
                    <span className="text-muted-foreground/50">@</span>
                  )}
                  {lead.company && (
                    <>
                      {!lead.title && <Building2 className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{lead.company}</span>
                    </>
                  )}
                </p>
              )}
              {lead.location && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{lead.location}</span>
                </p>
              )}
            </div>
          </div>

          {/* Right: Match Score */}
          {lead.matchScore !== undefined && (
            <div className="shrink-0">
              <MatchScoreIndicator score={lead.matchScore} />
            </div>
          )}
        </div>

        {/* Match Criteria Badges */}
        {lead.matchCriteria && lead.matchCriteria.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Match Criteria
            </p>
            <div className="flex flex-wrap gap-1.5">
              {lead.matchCriteria.map((criteria, index) => (
                <MatchBadge key={index} criteria={criteria} />
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {lead.summary && (
          <div className="mt-4">
            <p
              className={cn(
                "text-sm text-muted-foreground leading-relaxed",
                !isExpanded && "line-clamp-2"
              )}
            >
              {lead.summary}
            </p>
          </div>
        )}

        {/* Highlights (Expandable) */}
        {lead.highlights && lead.highlights.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Hide details
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  Show {lead.highlights.length} highlights
                </>
              )}
            </button>
            {isExpanded && (
              <ul className="mt-2 space-y-1.5">
                {lead.highlights.map((highlight, index) => (
                  <li
                    key={index}
                    className="text-sm text-muted-foreground pl-4 border-l-2 border-primary/20"
                  >
                    {highlight}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-border bg-muted/30 px-6 py-3 flex items-center justify-between">
        {/* LinkedIn Link */}
        {lead.linkedinUrl ? (
          <a
            href={lead.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Linkedin className="w-4 h-4" />
            <span>View Profile</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <div />
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant={saved ? "default" : "outline"}
            size="sm"
            onClick={handleSave}
            className="gap-1.5"
          >
            {saved ? (
              <>
                <BookmarkCheck className="w-4 h-4" />
                <span className="hidden sm:inline">Saved</span>
              </>
            ) : (
              <>
                <Bookmark className="w-4 h-4" />
                <span className="hidden sm:inline">Save</span>
              </>
            )}
          </Button>
          {lead.email && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleContact}
              className="gap-1.5"
            >
              <Mail className="w-4 h-4" />
              <span className="hidden sm:inline">Contact</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Grid wrapper for lead cards
interface LeadGridProps {
  children: React.ReactNode;
  className?: string;
}

export function LeadGrid({ children, className }: LeadGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4 sm:gap-6",
        "grid-cols-1 lg:grid-cols-2",
        className
      )}
    >
      {children}
    </div>
  );
}

// Empty state component
export function LeadEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Briefcase className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No leads found
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Try adjusting your search criteria or property details to find potential
        buyers.
      </p>
    </div>
  );
}
