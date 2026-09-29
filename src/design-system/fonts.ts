import { Archivo, IBM_Plex_Mono } from "next/font/google";

/** Archivo is variable in width (62–125%) and weight; titles use `font-stretch: 125%`. */
export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});

/** IBM Plex Mono for labels, data and the LCD strip. */
export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const fontVariables = `${archivo.variable} ${plexMono.variable}`;
