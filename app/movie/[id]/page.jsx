import WavvyPlayerWrapper from "@/components/WavvyPlayerWrapper";

export default async function MoviePage({ params }) {
  const { id } = await params;
  return <WavvyPlayerWrapper type="movie" id={id} server="megacloud" />;
}
