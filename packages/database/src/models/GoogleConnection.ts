import { Schema, model, type Model, type Types } from 'mongoose';

export const GOOGLE_CONNECTION_STATUSES = ['connected', 'expired', 'revoked', 'error'] as const;
export type GoogleConnectionStatusValue = (typeof GOOGLE_CONNECTION_STATUSES)[number];

/**
 * One Google OAuth connection per IndexRocket user.
 *
 * Both tokens are stored encrypted (AES-256-GCM) and are marked `select: false`
 * so an ordinary query can never accidentally load them. They are never returned
 * through the API under any circumstances.
 */
export interface GoogleConnectionDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Google's stable account id, when the granted scopes expose one. */
  googleAccountId?: string | null;
  /** AES-256-GCM ciphertext. Never plaintext, never returned by the API. */
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  accessTokenExpiresAt?: Date | null;
  scopes: string[];
  status: GoogleConnectionStatusValue;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const googleConnectionSchema = new Schema<GoogleConnectionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    googleAccountId: { type: String, trim: true, maxlength: 128, default: null },
    accessTokenEncrypted: { type: String, default: null, select: false },
    refreshTokenEncrypted: { type: String, default: null, select: false },
    accessTokenExpiresAt: { type: Date, default: null },
    scopes: { type: [String], default: [] },
    status: {
      type: String,
      enum: GOOGLE_CONNECTION_STATUSES,
      default: 'connected',
      required: true,
    },
    lastError: { type: String, maxlength: 500, default: null },
  },
  { timestamps: true },
);

// One connection per user: reconnecting replaces the existing record.
googleConnectionSchema.index({ userId: 1 }, { unique: true });

export const GoogleConnection: Model<GoogleConnectionDocument> = model<GoogleConnectionDocument>(
  'GoogleConnection',
  googleConnectionSchema,
);
