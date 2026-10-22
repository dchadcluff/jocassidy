export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 301 Permanent Redirect for www.jocassidy.com -> jocassidy.com
    if (url.hostname === "www.jocassidy.com") {
      url.hostname = "jocassidy.com";
      return Response.redirect(url.toString(), 301);
    }

    // 2. 301 Permanent Redirect for legacy .html extensions to pretty URLs
    if (url.pathname === "/books.html") {
      url.pathname = "/books";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/play.html") {
      url.pathname = "/play";
      return Response.redirect(url.toString(), 301);
    }

    // 3. Serve all other static assets through Cloudflare Assets binding
    return env.ASSETS.fetch(request);
  }
};
