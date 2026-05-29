import WavvyPlayerWrapper from "@/components/WavvyPlayerWrapper";
import { isBlocked } from "@/lib/blocklist";
import ContentRemovedScreen from "@/components/ContentRemovedScreen";

export default async function MoviePage({ params }) {
  const { id } = await params;
  if (isBlocked({ type: "movie", id })) {
    return <ContentRemovedScreen />;
  }
  return <WavvyPlayerWrapper type="movie" id={id} server="megacloud" />;
}
