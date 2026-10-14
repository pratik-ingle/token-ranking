import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeviceApprove } from "@/components/device-approve";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Connect a device" };

export default async function DevicePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code = "" } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/device${code ? `?code=${code}` : ""}`)}`);
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Connect the collector</CardTitle>
          <CardDescription>Confirm the code matches the one in your terminal.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeviceApprove initialCode={code.slice(0, 12)} username={user.username} />
        </CardContent>
      </Card>
    </div>
  );
}
