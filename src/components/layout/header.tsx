"use client";

import Link from "next/link";
import { useSession, signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function Header() {
  const { data: session, isPending } = useSession();

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link href="/" className="flex items-center">
              <svg
                className="w-8 h-8 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              <span className="ml-2 text-xl font-bold text-gray-900">
                PropertyMatch
              </span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center space-x-8">
            {session?.user && (
              <>
                <Link
                  href="/dashboard"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Dashboard
                </Link>
                <Link
                  href="/search"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Search
                </Link>
                <Link
                  href="/history"
                  className="text-gray-600 hover:text-gray-900"
                >
                  History
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center space-x-4">
            {isPending ? (
              <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
            ) : session?.user ? (
              <div className="flex items-center space-x-4">
                <div className="flex items-center">
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || "User"}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-blue-600 font-medium text-sm">
                        {session.user.name?.charAt(0) ||
                          session.user.email?.charAt(0) ||
                          "U"}
                      </span>
                    </div>
                  )}
                  <span className="ml-2 text-sm font-medium text-gray-700 hidden md:block">
                    {session.user.name || session.user.email}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/"; } } })}
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link href="/auth">
                  <Button variant="ghost" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/auth">
                  <Button size="sm">Get Started</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
