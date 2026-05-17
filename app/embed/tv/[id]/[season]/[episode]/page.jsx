// app/embed/tv/[id]/[season]/[episode]/page.jsx
import VidzenPlayer from '../../../../../components/VidzenPlayer';

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
  return (
    <main style={{ background: '#000', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      <div style={{ width: '100%', maxWidth: '100vw' }}>
        <VidzenPlayer type="tv" id={id} season={season} episode={episode} />
      </div>
    </main>
  );
}
