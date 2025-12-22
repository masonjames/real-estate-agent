"use client";

import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-200 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardHeader({
  className = "",
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div className={`px-6 py-4 border-b border-gray-100 ${className}`} {...props}>
      {children}
    </div>
  );
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

export function CardTitle({
  className = "",
  children,
  ...props
}: CardTitleProps) {
  return (
    <h3 className={`text-lg font-semibold text-gray-900 ${className}`} {...props}>
      {children}
    </h3>
  );
}

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardContent({
  className = "",
  children,
  ...props
}: CardContentProps) {
  return (
    <div className={`px-6 py-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardFooter({
  className = "",
  children,
  ...props
}: CardFooterProps) {
  return (
    <div
      className={`px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
