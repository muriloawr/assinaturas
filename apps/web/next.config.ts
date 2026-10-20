import type { NextConfig } from "next";

// Um único .env na raiz do repositório para api e painel.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  // Sem .env: usa as variáveis do ambiente (produção).
}

const config: NextConfig = {
  poweredByHeader: false,
};

export default config;
