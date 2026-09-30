// A minimal software WebAuthn authenticator (ES256, "none" attestation) for integration tests:
// it answers the options Better Auth generates the way a browser + platform authenticator would,
// so registration and sign-in run through the real endpoints and @simplewebauthn/server.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

// --- Minimal CBOR encoder (only what a COSE key and an attestation object need) ---------------

function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
}

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue>;

function cbor(value: CborValue): Buffer {
  if (typeof value === "number") {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([cborHead(2, value.length), value]);
  const parts = [cborHead(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}

// --- Helpers ------------------------------------------------------------------------------------

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    private readonly rpID: string,
    private readonly origin: string,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  /** COSE_Key (EC2, P-256, ES256), as stored by the passkey plugin after registration. */
  cosePublicKey(): Buffer {
    const jwk = this.publicKey.export({ format: "jwk" });
    return cbor(
      new Map<CborValue, CborValue>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
  }

  private authenticatorData(flags: number, attested?: Buffer): Buffer {
    const counter = Buffer.alloc(4); // 0, like most synced passkeys
    const extra = attested ?? Buffer.alloc(0);
    return Buffer.concat([sha256(this.rpID), Buffer.from([flags]), counter, extra]);
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** navigator.credentials.create(), serialized like @simplewebauthn/browser does. */
  register(options: { challenge: string }, { origin = this.origin } = {}) {
    const credentialIdLength = Buffer.from([0, this.credentialId.length]);
    const attested = Buffer.concat([
      Buffer.alloc(16), // AAGUID: all zeros, like platforms that hide it
      credentialIdLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
    const authData = this.authenticatorData(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA,
      attested,
    );
    const attestationObject = cbor(
      new Map<CborValue, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** navigator.credentials.get(), serialized like @simplewebauthn/browser does. */
  authenticate(options: { challenge: string }, { origin = this.origin } = {}) {
    const authData = this.authenticatorData(FLAG_USER_PRESENT | FLAG_USER_VERIFIED);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), {
      key: this.privateKey,
      dsaEncoding: "der",
    });
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Row as the plugin would store it, to plant a passkey for a user that cannot register one. */
  passkeyRow(userId: string) {
    return {
      id: `pk-${this.id}`,
      userId,
      credentialID: this.id,
      publicKey: this.cosePublicKey().toString("base64"),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
    };
  }
}
