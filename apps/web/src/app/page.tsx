import { WorldSection } from "@/components/world/WorldSection";
import { Console } from "@/components/home/Console";
import { Statement } from "@/components/home/Statement";
import { Trust } from "@/components/home/Trust";
import { Chooser } from "@/components/home/Chooser";

/*
  tasteskill deal (plan line 2): kind software/tech · palette graphite-safety-orange · type sora ·
  radius soft · buttons tonal · nav nav-centre (nav-cards re-dealt: no photographs) · footer footer-dark ·
  close close-word · rhythm dark-band · mark dots · big scene dot-becomes-the-full-stop (the page's
  scroll beat) · hero: the user's own brief overrides the dealt collage with a 3D agent-network
  world (tech: "a 3D hero, poster first"), which is the product's subject, not a mood.
*/
export default function Home() {
  return (
    <>
      <WorldSection />
      <Console />
      <Chooser />
      <Statement />
      <Trust />
    </>
  );
}
