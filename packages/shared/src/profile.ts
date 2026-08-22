import { z } from 'zod';
import { RemoteType } from './enums';

const OptionalUrl = z.string().trim().url('Enter a valid URL.').max(500).optional().nullable();
const OptionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const UpdateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  headline: OptionalText(160),
  phone: OptionalText(40),
  locationCity: OptionalText(120),
  locationCountry: OptionalText(120),
  timezone: OptionalText(64),
  yearsExperience: z.number().int().min(0).max(70).optional().nullable(),
  desiredRoles: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  desiredLocations: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  remotePreference: z.nativeEnum(RemoteType).optional(),
  minSalary: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Use a 3-letter ISO currency code.')
    .optional()
    .nullable(),
  skills: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  linkedinUrl: OptionalUrl,
  githubUrl: OptionalUrl,
  portfolioUrl: OptionalUrl,
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export interface UserProfileDto {
  readonly id: string;
  readonly fullName: string;
  readonly headline: string | null;
  readonly phone: string | null;
  readonly locationCity: string | null;
  readonly locationCountry: string | null;
  readonly timezone: string | null;
  readonly yearsExperience: number | null;
  readonly desiredRoles: string[];
  readonly desiredLocations: string[];
  readonly remotePreference: RemoteType;
  readonly minSalary: number | null;
  readonly salaryCurrency: string | null;
  readonly skills: string[];
  readonly linkedinUrl: string | null;
  readonly githubUrl: string | null;
  readonly portfolioUrl: string | null;
  readonly updatedAt: string;
}
