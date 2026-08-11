import { handleAccountApi } from "@/server/account-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(request: Request): Promise<Response> {
  return await handleAccountApi(request) ?? Response.json({ error: "接口不存在" }, { status: 404 });
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as OPTIONS };
