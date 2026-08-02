// 舊網址 battle-archive.pages.dev 一律轉到正式網域，路徑與參數原樣保留
// 只轉列出的主機，不轉 preview 部署（<hash>.battle-archive.pages.dev），保留預覽測試能力
// GET/HEAD 用 301；其他方法用 308，避免瀏覽器把 POST 改成 GET
const REDIRECT_HOSTS = ["battle-archive.pages.dev"];
const CANONICAL_HOST = "battle-archive.skyfaring.net";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (REDIRECT_HOSTS.includes(url.hostname)) {
    url.hostname = CANONICAL_HOST;
    const status = ["GET", "HEAD"].includes(context.request.method) ? 301 : 308;
    return Response.redirect(url.toString(), status);
  }
  return context.next();
}
