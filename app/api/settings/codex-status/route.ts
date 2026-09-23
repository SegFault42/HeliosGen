import { checkCodexLogin, checkImageCli } from "@/lib/codexStatus.mjs";
import { lastSuccessfulCodexImage } from "@/lib/guest/db";
import { GUEST_USER_ID } from "@/lib/guestMode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [imageCli, chatgptLogin] = await Promise.all([
    checkImageCli(request.signal), checkCodexLogin(request.signal),
  ]);
  return Response.json({ imageCli, chatgptLogin, imageGeneration: "not_verified",
    lastSuccessAt: lastSuccessfulCodexImage(GUEST_USER_ID) });
}
