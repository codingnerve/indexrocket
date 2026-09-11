import { Schema, model, type Model, type Types } from 'mongoose';

export interface ProjectDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  domain: string;
  /** IndexNow key. Treated as a secret and never selected by default. */
  indexNowKey?: string | null;
  /** Where the key file is published. Defaults to https://<host>/<key>.txt. */
  indexNowKeyLocation?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<ProjectDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    domain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    indexNowKey: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      // Treated as a secret: excluded from query results unless asked for.
      select: false,
    },
    indexNowKeyLocation: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: null,
    },
  },
  { timestamps: true },
);

// Covers both "projects of a user" and "a user's projects for a domain" lookups.
// Deliberately not unique: one user may run several projects on the same domain.
projectSchema.index({ userId: 1, domain: 1 });

export const Project: Model<ProjectDocument> = model<ProjectDocument>('Project', projectSchema);
