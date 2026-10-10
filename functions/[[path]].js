export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length > 0) return next();

  const response = await next();
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;

  const city = request.cf?.city;
  if (city) {
    const slug = city.toLowerCase().replace(/\s+/g, '-');
    try {
      const r = await fetch(`${url.origin}/${slug}/`);
      if (r.ok) return Response.redirect(`${url.origin}/${slug}/`, 302);
    } catch {}
  }
  return response;
}
