"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { useEffect } from "react";
import { Header } from "@/components/layout/header";
import { AuthForm } from "@/components/auth/auth-form";

export default function AuthPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (session?.user && !isPending) {
      router.push("/dashboard");
    }
  }, [session, isPending, router]);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <AuthForm onSuccess={() => router.push("/dashboard")} />
      </main>
    </div>
  );
}
