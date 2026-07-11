import { z } from "zod";
import zxcvbn from "zxcvbn";

/** Minimum acceptable zxcvbn strength score (0-4). 3 = "safely unguessable". */
const MIN_PASSWORD_SCORE = 3;

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .superRefine((password, ctx) => {
    // Cap zxcvbn input length — the algorithm is superlinear on long strings.
    const { score } = zxcvbn(password.slice(0, 100));
    if (score < MIN_PASSWORD_SCORE) {
      ctx.addIssue({
        code: "custom",
        message: "Password is too weak or guessable",
      });
    }
  });

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("A valid email is required")
  .max(254, "Email is too long");

export const credentialsSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

// Login must NOT run the strength check (legacy/weak passwords still log in),
// and only requires a non-empty password of bounded length.
export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "Password is required").max(128),
  })
  .strict();

export type Credentials = z.infer<typeof credentialsSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
