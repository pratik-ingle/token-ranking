import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/safe-next";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Join" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNext(next, "/onboarding"));
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Join TokenRank</CardTitle>
          <CardDescription>Pick a username. No email, no real name, no photo. Your avatar is generated from your username.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm next={next} />
        </CardContent>
      </Card>
    </div>
  );
}
