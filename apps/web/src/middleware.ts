import { NextResponse, type NextRequest } from "next/server";

// Acesso provisório ao painel por usuário e senha (Basic Auth), até termos
// login de verdade. Sem PANEL_PASSWORD definido, o painel fica bloqueado.
export function middleware(request: NextRequest) {
  const user = process.env.PANEL_USER ?? "admin";
  const password = process.env.PANEL_PASSWORD;

  if (password) {
    const header = request.headers.get("authorization") ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded && atob(encoded) === `${user}:${password}`) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Autenticação necessária", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Painel de assinaturas", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
