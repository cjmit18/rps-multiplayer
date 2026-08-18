export interface AuthUser {
  id: string;
  username: string;
}

interface StoredUser extends AuthUser {
  password_hash: string;
  password_salt: string;
}

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return new Uint8Array();
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

// Compares every byte without early exit so timing doesn't leak how many bytes matched.
function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

// PBKDF2 with a per-user salt and high iteration count slows down offline brute-forcing of stolen hashes.
async function hashPassword(password: string, salt: string): Promise<string> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100_000, hash: "SHA-256" },
    passwordKey,
    256,
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

// Signs `userId.expiresAt` so the cookie is tamper-evident without needing server-side session storage.
async function signSession(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function getCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  const cookie = cookies.find((part) => part.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : undefined;
}

export function validateCredentials(username: string, password: string): string | undefined {
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return "Username must be 3-24 letters, numbers, or underscores";
  if (password.length < 8 || password.length > 128) return "Password must be 8-128 characters";
  return undefined;
}

export async function registerUser(db: D1Database, username: string, password: string): Promise<AuthUser> {
  const id = crypto.randomUUID();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passwordSalt = toBase64Url(saltBytes);
  const passwordHash = await hashPassword(password, passwordSalt);
  await db.prepare(
    "INSERT INTO users (id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)",
  ).bind(id, username, passwordHash, passwordSalt).run();
  return { id, username };
}

// Retries on the (extremely unlikely) chance a random guest username collides with an existing one.
export async function createGuestUser(db: D1Database): Promise<AuthUser> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const username = `guest_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    try {
      return await registerUser(db, username, `${crypto.randomUUID()}${crypto.randomUUID()}`);
    } catch (error) {
      if (!String(error).toLowerCase().includes("unique") || attempt === 2) throw error;
    }
  }
  throw new Error("Unable to create a guest account");
}

// Guest accounts and their leaderboard rows older than maxAgeMs are purged so D1 doesn't grow forever.
export async function deleteStaleGuestAccounts(db: D1Database, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  // Matches SQLite's CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS") so the string comparison below is valid.
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString().slice(0, 19).replace("T", " ");
  await db.prepare(
    "DELETE FROM leaderboard WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'guest\\_%' ESCAPE '\\' AND created_at < ?)",
  ).bind(cutoff).run();
  const result = await db.prepare(
    "DELETE FROM users WHERE username LIKE 'guest\\_%' ESCAPE '\\' AND created_at < ?",
  ).bind(cutoff).run();
  return result.meta.changes ?? 0;
}

export async function verifyUser(db: D1Database, username: string, password: string): Promise<AuthUser | undefined> {
  const user = await db.prepare(
    "SELECT id, username, password_hash, password_salt FROM users WHERE username = ?",
  ).bind(username).first<StoredUser>();
  if (!user) return undefined;
  const passwordHash = await hashPassword(password, user.password_salt);
  return constantTimeEqual(hexToBytes(passwordHash), hexToBytes(user.password_hash))
    ? { id: user.id, username: user.username }
    : undefined;
}

export async function createSessionCookie(userId: string, secret: string): Promise<string> {
  const token = await signSession(`${userId}.${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}`, secret);
  // HttpOnly blocks JS access (XSS), Secure requires HTTPS, SameSite=Strict blocks cross-site sends (CSRF).
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function getSessionUser(db: D1Database, request: Request, secret: string): Promise<AuthUser | undefined> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return undefined;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return undefined;
  const payload = token.slice(0, separator);
  const payloadParts = payload.split(".");
  const userId = payloadParts[0];
  const expiresAt = Number(payloadParts[1]);
  if (!userId || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
  let signature: Uint8Array;
  try {
    signature = fromBase64Url(token.slice(separator + 1));
  } catch {
    return undefined;
  }

  // Re-derive the expected signature rather than trusting the one on the cookie, then compare safely.
  const expectedToken = await signSession(payload, secret);
  const expectedSignature = fromBase64Url(expectedToken.slice(expectedToken.lastIndexOf(".") + 1));
  if (!constantTimeEqual(signature, expectedSignature)) return undefined;
  return (await db.prepare("SELECT id, username FROM users WHERE id = ?").bind(userId).first<AuthUser>()) ?? undefined;
}

export function jsonWithCookie(data: unknown, cookie: string, init?: ResponseInit): Response {
  const response = Response.json(data, init);
  response.headers.set("Set-Cookie", cookie);
  return response;
}