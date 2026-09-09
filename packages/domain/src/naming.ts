import { z } from 'zod';

/**
 * displayName = customName ?? detectedName
 *
 * The custom name is presentation only. It is stored beside the detected name
 * and never replaces the stable id, so re-detecting hardware can update the
 * detected name without losing the user's label (and vice versa).
 */
export const NameableSchema = z.object({
  detectedName: z.string().min(1),
  customName: z.string().min(1).max(120).nullable().optional(),
});
export type Nameable = z.infer<typeof NameableSchema>;

export function displayName(nameable: Nameable): string {
  return nameable.customName ?? nameable.detectedName;
}
