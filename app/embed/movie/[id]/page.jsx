// app/embed/movie/[id]/page.jsx
import VidzenPlayer from '../../../components/VidzenPlayer';
import { isBlocked } from '@/lib/blocklist';
import ContentRemovedScreen from '@/components/ContentRemovedScreen';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return {
    title: `Watch Movie — VidZen`,
    description: `Stream movie ${id} on VidZen`,
    other: { 'X-Frame-Options': 'ALLOWALL' },
  };
}

export default async function MovieEmbedPage({ params }) {
  const { id } = await params;

  if (isBlocked({ type: 'movie', id })) {
    return <ContentRemovedScreen />;
  }

  return (
    <main style={{ background: '#000', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      <div style={{ width: '100%', maxWidth: '100vw' }}>
        <VidzenPlayer type="movie" id={id} />
      </div>
    </main>
  );
}
