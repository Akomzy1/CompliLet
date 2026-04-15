import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { SCENE, START, TOTAL_FRAMES } from "./brand";
import { Intro } from "./scenes/Intro";
import { Problem } from "./scenes/Problem";
import { Solution } from "./scenes/Solution";
import { Screening } from "./scenes/Screening";
import { Compliance } from "./scenes/Compliance";
import { RentReview } from "./scenes/RentReview";
import { Features } from "./scenes/Features";
import { CTA } from "./scenes/CTA";

export const CompliLetDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#0F2B46" }}>
      <Sequence from={START.INTRO} durationInFrames={SCENE.INTRO}>
        <Intro />
      </Sequence>

      <Sequence from={START.PROBLEM} durationInFrames={SCENE.PROBLEM}>
        <Problem />
      </Sequence>

      <Sequence from={START.SOLUTION} durationInFrames={SCENE.SOLUTION}>
        <Solution />
      </Sequence>

      <Sequence from={START.SCREENING} durationInFrames={SCENE.SCREENING}>
        <Screening />
      </Sequence>

      <Sequence from={START.COMPLIANCE} durationInFrames={SCENE.COMPLIANCE}>
        <Compliance />
      </Sequence>

      <Sequence from={START.RENT_REVIEW} durationInFrames={SCENE.RENT_REVIEW}>
        <RentReview />
      </Sequence>

      <Sequence from={START.FEATURES} durationInFrames={SCENE.FEATURES}>
        <Features />
      </Sequence>

      <Sequence from={START.CTA} durationInFrames={SCENE.CTA}>
        <CTA />
      </Sequence>
    </AbsoluteFill>
  );
};

// Short version — just the WhatsApp screening + CTA (for social ads)
export const CompliLetShort: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#0F2B46" }}>
      <Sequence from={0} durationInFrames={SCENE.INTRO}>
        <Intro />
      </Sequence>
      <Sequence from={SCENE.INTRO} durationInFrames={SCENE.SCREENING}>
        <Screening />
      </Sequence>
      <Sequence from={SCENE.INTRO + SCENE.SCREENING} durationInFrames={SCENE.CTA}>
        <CTA />
      </Sequence>
    </AbsoluteFill>
  );
};

export const SHORT_TOTAL = SCENE.INTRO + SCENE.SCREENING + SCENE.CTA;
