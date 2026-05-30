// app/embed/tv/[id]/[season]/[episode]/page.jsx
import VidzenPlayer from '../../../../../components/VidzenPlayer';
import { isBlocked } from '@/lib/blocklist';
import ContentRemovedScreen from '@/components/ContentRemovedScreen';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id, season, episode } = await params;
  return {
    title: `Watch TV S${season}E${episode} — VidZen`,
    description: `Stream show ${id} season ${season} episode ${episode} on VidZen`,
  };
}

export default async function TvEmbedPage({ params }) {
  const { id, season, episode } = await params;

  if (isBlocked({ type: 'tv', id, season, episode })) {
    return <ContentRemovedScreen />;
  }

  // Detect dynamic host for local vs production wildcard subdomains
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
  const origin = `${protocol}://${host}`;

  // SRPS SSR cache warming (fire-and-forget)
  fetch(`${origin}/api/sources?type=tv&id=${id}&season=${season}&episode=${episode}`).catch(() => {});

  return (
    <main style={{ background: '#000', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      <div style={{ width: '100%', maxWidth: '100vw' }}>
        <VidzenPlayer type="tv" id={id} season={season} episode={episode} />
      </div>
    </main>
  );
}
