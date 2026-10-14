import type { Metadata } from "next";
import { RecoverCompleteButton } from "@/components/recover-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Recover account", referrer: "no-referrer" };

export default async function RecoverTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Almost there</CardTitle>
          <CardDescription>
            This link works once. After signing in, add a new passkey or set a password in Settings → Security.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecoverCompleteButton token={token} />
        </CardContent>
      </Card>
    </div>
  );
}
