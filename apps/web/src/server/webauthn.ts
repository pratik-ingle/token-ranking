import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { hmacHex, safeEqual } from "./crypto";
import { env } from "./env";
import { ApiError } from "./http";

/**
 * In-flight WebAuthn ceremonies are kept in a short-lived, HMAC-signed,
 * httpOnly cookie instead of a database table.
 */
const CHALLENGE_COOKIE = "tr_webauthn";
const TTL_MS = 5 * 60_000;

interface Ceremony {
  kind: "register" | "login" | "add-passkey";
  challenge: string;
  username?: string;
  webauthnUserId?: string;
  exp: number;
}

async function setCeremony(c: Omit<Ceremony, "exp">): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ ...c, exp: Date.now() + TTL_MS })).toString("base64url");
  const sig = hmacHex("cookie", payload);
  (await cookies()).set(CHALLENGE_COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.appOrigin.startsWith("https://"),
    path: "/api/auth",
    maxAge: TTL_MS / 1000,
  });
}

async function takeCeremony(kind: Ceremony["kind"]): Promise<Ceremony> {
  const jar = await cookies();
  const raw = jar.get(CHALLENGE_COOKIE)?.value;
  jar.set(CHALLENGE_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  if (!raw) throw new ApiError(400, "no_challenge", "The passkey request expired. Please try again.");
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, hmacHex("cookie", payload))) {
    throw new ApiError(400, "bad_challenge", "Invalid passkey challenge.");
  }
  const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Ceremony;
  if (c.kind !== kind || c.exp < Date.now()) throw new ApiError(400, "no_challenge", "The passkey request expired. Please try again.");
  return c;
}

export async function startPasskeyRegistration(params: {
  kind: "register" | "add-passkey";
  username: string;
  webauthnUserId: string;
  excludeCredentialIds?: { id: string; transports?: string[] }[];
}) {
  const options = await generateRegistrationOptions({
    rpName: env.rpName,
    rpID: env.rpId,
    userName: params.username,
    userDisplayName: params.username,
    userID: Buffer.from(params.webauthnUserId, "base64url"),
    attestationType: "none",
    excludeCredentials: params.excludeCredentialIds ?? [],
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await setCeremony({ kind: params.kind, challenge: options.challenge, username: params.username, webauthnUserId: params.webauthnUserId });
  return options;
}

export async function finishPasskeyRegistration(kind: "register" | "add-passkey", response: RegistrationResponseJSON) {
  const ceremony = await takeCeremony(kind);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: env.appOrigin,
    expectedRPID: env.rpId,
    requireUserVerification: false,
  }).catch(() => {
    throw new ApiError(400, "passkey_failed", "Passkey verification failed.");
  });
  if (!verification.verified) throw new ApiError(400, "passkey_failed", "Passkey verification failed.");
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  return {
    username: ceremony.username!,
    webauthnUserId: ceremony.webauthnUserId!,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports?.join(",") ?? null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    },
  };
}

export async function startPasskeyLogin() {
  const options = await generateAuthenticationOptions({ rpID: env.rpId, userVerification: "preferred" });
  await setCeremony({ kind: "login", challenge: options.challenge });
  return options;
}

export async function finishPasskeyLogin(
  response: AuthenticationResponseJSON,
  lookup: (credentialId: string) => Promise<{ publicKey: string; counter: number; transports: string | null } | null>,
) {
  const ceremony = await takeCeremony("login");
  const stored = await lookup(response.id);
  if (!stored) throw new ApiError(400, "unknown_passkey", "This passkey is not registered with TokenRank.");
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: env.appOrigin,
    expectedRPID: env.rpId,
    credential: {
      id: response.id,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
      counter: stored.counter,
      transports: stored.transports ? stored.transports.split(",") : undefined,
    },
    requireUserVerification: false,
  }).catch(() => {
    throw new ApiError(400, "passkey_failed", "Passkey verification failed.");
  });
  if (!verification.verified) throw new ApiError(400, "passkey_failed", "Passkey verification failed.");
  return { credentialId: response.id, newCounter: verification.authenticationInfo.newCounter };
}
