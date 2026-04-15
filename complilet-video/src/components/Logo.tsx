import React from "react";
import { Img, staticFile } from "remotion";

interface LogoProps {
  /** Height in px. Width scales automatically to preserve aspect ratio. */
  height?: number;
}

export const Logo: React.FC<LogoProps> = ({ height = 120 }) => {
  return (
    <Img
      src={staticFile("logo.png")}
      style={{
        height,
        width: "auto",
        objectFit: "contain",
      }}
    />
  );
};
