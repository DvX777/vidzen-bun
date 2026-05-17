import './globals.css'
import Script from 'next/script'

export const metadata = {
  title: 'VidZen — Next-Gen Streaming API',
  description: 'The most powerful streaming embed. Lightning-fast failover, parallel source racing, and a fully responsive player. 115K+ movies, 79K+ episodes.',
  keywords: ['streaming', 'embed', 'movies', 'tv shows', 'vidzen', 'api'],
  openGraph: {
    title: 'VidZen — Next-Gen Streaming API',
    description: 'Embed any movie or TV show with a single URL. Lightning-fast, multi-provider, fully embeddable.',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>▶</text></svg>" />
      </head>
      <body suppressHydrationWarning>
        {children}
        {/* SiteGuard — DevTools deterrent. Loaded early before page becomes interactive. */}
        <Script src="/siteguard.js" strategy="beforeInteractive" />
      </body>
    </html>
  )
}
