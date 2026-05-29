import WavvyPlayerWrapper from "@/components/WavvyPlayerWrapper";
import { isBlocked } from "@/lib/blocklist";
import ContentRemovedScreen from "@/components/ContentRemovedScreen";

export default async function TVPage({ params }) {
  const { id, season, episode } = await params;
  if (isBlocked({ type: "tv", id, season, episode })) {
    return <ContentRemovedScreen />;
  }
  return <WavvyPlayerWrapper type="tv" id={id} season={season} episode={episode} server="megacloud" />;
}
