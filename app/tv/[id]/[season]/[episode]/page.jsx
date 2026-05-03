import WavvyPlayerWrapper from "@/components/WavvyPlayerWrapper";

export default async function TVPage({ params }) {
  const { id, season, episode } = await params;
  return <WavvyPlayerWrapper type="tv" id={id} season={season} episode={episode} server="megacloud" />;
}
