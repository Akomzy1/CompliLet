import React from "react";
import { Composition } from "remotion";
import { CompliLetDemo, CompliLetShort, SHORT_TOTAL } from "./Root";
import { FPS, TOTAL_FRAMES } from "./brand";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Full product demo — ~50 seconds */}
      <Composition
        id="CompliLetDemo"
        component={CompliLetDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* Short cut — ~19 seconds, for social ads */}
      <Composition
        id="CompliLetShort"
        component={CompliLetShort}
        durationInFrames={SHORT_TOTAL}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      {/* Square format — for Instagram */}
      <Composition
        id="CompliLetSquare"
        component={CompliLetShort}
        durationInFrames={SHORT_TOTAL}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={{}}
      />
    </>
  );
};
