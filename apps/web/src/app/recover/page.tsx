import type { Metadata } from "next";
import { RecoverRequestForm } from "@/components/recover-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Recover account" };

export default function RecoverPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Recover your account</CardTitle>
          <CardDescription>
            If you added a recovery email in settings, we&apos;ll send a one-time sign-in link to it. We only store a hash of that
            address, so we can match it but never read it back or show it to anyone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecoverRequestForm />
        </CardContent>
      </Card>
    </div>
  );
}
