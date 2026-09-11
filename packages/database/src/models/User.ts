import { Schema, model, type Model, type Types } from 'mongoose';

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_PLANS = ['free', 'starter', 'pro', 'agency'] as const;
export type UserPlan = (typeof USER_PLANS)[number];

export interface UserDocument {
  _id: Types.ObjectId;
  name: string;
  email: string;
  /** Hash only. Authentication is implemented in a later step; plaintext is never stored. */
  passwordHash: string;
  role: UserRole;
  credits: number;
  plan: UserPlan;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
      // Excluded from query results unless explicitly selected.
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'user',
      required: true,
    },
    credits: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    plan: {
      type: String,
      enum: USER_PLANS,
      default: 'free',
      required: true,
    },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export const User: Model<UserDocument> = model<UserDocument>('User', userSchema);
