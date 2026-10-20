import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "precisa ter 32 bytes em base64"),
  ADMIN_API_TOKEN: z.string().min(16),
  API_PORT: z.coerce.number().default(3333),
  API_PUBLIC_URL: z.string().url().default("http://localhost:3333"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
